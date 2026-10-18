#!/usr/bin/env bash
# Runs ledger-lifecycle.sh (#911) against a stub `curl` that keeps the bucket's lifecycle configuration in a file:
# apply puts one enabled rule, "expire erasure-ledger/ after 47 days"; a second apply puts nothing; a wrong or disabled
# rule of ours is replaced; every other rule survives the PUT (R2's default rule included, also one without an ID); check fails unless the rule exists, is enabled,
# covers erasure-ledger/ and says 47 days; the secret is on stdin, never on a command line; a denied token or a failed
# put fails with the HTTP status and no response body. No network or bucket needed.
# Run from anywhere: infra/staging/test-ledger-lifecycle.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin" "$tmp/stack"
cp "$here/ledger-lib.sh" "$here/ledger-lifecycle.sh" "$tmp/stack/"
cp "$here/.env.example" "$tmp/stack/.env"
export STUB_CONFIG="$tmp/config.xml" STUB_LOG="$tmp/curl.log" STUB_STDIN="$tmp/stdin.log" STUB_BODY="$tmp/put-body.xml"
: > "$STUB_LOG"

cat > "$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
method=GET out="" body="" md5=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    -X) method="${args[$((i + 1))]}" ;;
    -o) out="${args[$((i + 1))]}" ;;
    --data-binary) body="${args[$((i + 1))]#@}" ;;
    Content-MD5:*) md5="${args[$i]#Content-MD5: }" ;;
  esac
done
cat >> "$STUB_STDIN" # the -K - config: the credentials
echo >> "$STUB_STDIN"
if [ "$method" = PUT ]; then
  [ "$md5" = "$(openssl md5 -binary "$body" | base64)" ] || { echo '<Error><Code>BadDigest</Code></Error>' > "$out"; echo 400; exit 0; }
  if [ -n "${STUB_PUT_HTTP:-}" ]; then echo '<Error><Code>InternalError</Code><Message>secret-row-content</Message></Error>' > "$out"; echo "$STUB_PUT_HTTP"; exit 0; fi
  cp "$body" "$STUB_CONFIG"; cp "$body" "$STUB_BODY"; : > "$out"; echo 200; exit 0
fi
if [ -n "${STUB_GET_HTTP:-}" ]; then echo "<Error><Code>${STUB_GET_CODE:-AccessDenied}</Code><Message>secret-row-content</Message></Error>" > "$out"; echo "$STUB_GET_HTTP"; exit 0; fi
if [ -e "$STUB_CONFIG" ]; then cp "$STUB_CONFIG" "$out"; echo 200; else echo '<Error><Code>NoSuchLifecycleConfiguration</Code></Error>' > "$out"; echo 404; fi
STUB
chmod +x "$tmp/bin/curl"
export PATH="$tmp/bin:$PATH"

fail() { echo "FAIL: $*" >&2; cat "$tmp/out" >&2 2> /dev/null || true; exit 1; }
life() { "$tmp/stack/ledger-lifecycle.sh" "$@" > "$tmp/out" 2>&1; }
puts() { grep -c ' -X PUT ' "$STUB_LOG" || true; }
reset() { rm -f "$STUB_CONFIG" "$STUB_BODY"; : > "$STUB_LOG"; : > "$STUB_STDIN"; }
# a configuration holding one rule of ours with the given status, prefix and days, as R2 might return it (indented)
config() {
  cat > "$STUB_CONFIG" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<LifecycleConfiguration>
  <Rule>
    <ID>plateandbar-erasure-ledger-expiry</ID>
    <Status>$1</Status>
    <Filter>
      <Prefix>$2</Prefix>
    </Filter>
    <Expiration>
      <Days>$3</Days>
    </Expiration>
  </Rule>
</LifecycleConfiguration>
XML
}

echo "apply: a bucket with no configuration gets one enabled rule, erasure-ledger/ after 47 days, and is checked"
reset
life apply || fail "apply exited non-zero"
[ "$(puts)" = 1 ] || fail "expected one PUT, got $(puts)"
grep -q 'lifecycle rule put: erasure-ledger/ expires after 47 days' "$tmp/out" || fail "apply did not report the rule"
grep -q 'lifecycle rule ok' "$tmp/out" || fail "apply did not verify the rule afterwards"
grep -qF '<ID>plateandbar-erasure-ledger-expiry</ID>' "$STUB_BODY" || fail "no rule id in the body"
grep -qF '<Prefix>erasure-ledger/</Prefix>' "$STUB_BODY" || fail "wrong prefix in the body"
grep -qF '<Status>Enabled</Status>' "$STUB_BODY" || fail "rule not enabled in the body"
grep -qF '<Expiration><Days>47</Days></Expiration>' "$STUB_BODY" || fail "not 47 days in the body"
grep -q -e '--aws-sigv4 aws:amz:auto:s3' "$STUB_LOG" || fail "the request is not signed for s3"
grep -q 'https://example.invalid/plateandbar-backups?lifecycle' "$STUB_LOG" || fail "wrong URL"

echo "apply: idempotent, a second run puts nothing"
: > "$STUB_LOG"
life apply || fail "second apply exited non-zero"
[ "$(puts)" = 0 ] || fail "second apply put again"
grep -q 'already applied' "$tmp/out" || fail "second apply did not say so"

echo "apply: a rule of ours with the wrong days or status is replaced"
for variant in "Enabled erasure-ledger/ 30" "Disabled erasure-ledger/ 47" "Enabled erasure-ledger/staging/ 47"; do
  reset
  # shellcheck disable=SC2086 # three words
  config $variant
  life apply || fail "apply over [$variant] exited non-zero"
  [ "$(puts)" = 1 ] || fail "[$variant] was not replaced"
  life check || fail "[$variant] was not fixed"
done

echo "apply: every other rule survives (R2's default rule, a foreign rule, a rule without an ID), only our rule is replaced"
default_rule='<Rule><ID>Default Multipart Abort Rule</ID><Status>Enabled</Status><AbortIncompleteMultipartUpload><DaysAfterInitiation>7</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule>'
foreign_rule='<Rule><ID>keep-me</ID><Status>Enabled</Status><Filter><Prefix>other/</Prefix></Filter><Expiration><Days>1</Days></Expiration></Rule>'
noid_rule='<Rule><Status>Enabled</Status><Filter><Prefix>no-id/</Prefix></Filter><Expiration><Days>9</Days></Expiration></Rule>'
survivors() {
  for r in "$default_rule" "$foreign_rule" "$noid_rule"; do
    grep -qF "$r" "$STUB_BODY" || fail "a rule was lost in the PUT: $r"
  done
  [ "$(grep -o '<ID>plateandbar-erasure-ledger-expiry</ID>' "$STUB_BODY" | wc -l | tr -d ' ')" = 1 ] || fail "our rule is not in the PUT exactly once"
  grep -qF '<Expiration><Days>47</Days></Expiration>' "$STUB_BODY" || fail "our rule is not 47 days in the PUT"
}
# no rule of ours yet
reset
printf '<LifecycleConfiguration>%s%s%s</LifecycleConfiguration>' "$default_rule" "$foreign_rule" "$noid_rule" > "$STUB_CONFIG"
life apply || fail "apply next to other rules failed"
[ "$(puts)" = 1 ] || fail "expected one PUT next to other rules"
survivors
life check || fail "check after the merge failed"
# a wrong rule of ours, in the middle of the others (indented, as R2 might return it)
reset
config Enabled erasure-ledger/ 30
sed -i.bak "s#<LifecycleConfiguration>#<LifecycleConfiguration>$default_rule#; s#</LifecycleConfiguration>#$foreign_rule$noid_rule</LifecycleConfiguration>#" "$STUB_CONFIG"
life apply || fail "apply over a wrong rule of ours next to other rules failed"
[ "$(puts)" = 1 ] || fail "the wrong rule was not replaced"
survivors
life check || fail "check after the replace failed"
: > "$STUB_LOG"
life apply || fail "second apply failed"
[ "$(puts)" = 0 ] || fail "second apply put again next to other rules"

echo "a 404 that is not NoSuchLifecycleConfiguration (a wrong bucket) fails and puts nothing"
reset
if STUB_GET_HTTP=404 STUB_GET_CODE=NoSuchBucket life apply; then fail "apply on a missing bucket exited 0"; fi
grep -q 'HTTP 404 NoSuchBucket' "$tmp/out" || fail "a missing bucket was not reported"
[ "$(puts)" = 0 ] || fail "apply put on a missing bucket"
if STUB_GET_HTTP=404 STUB_GET_CODE=NoSuchBucket life check; then fail "check on a missing bucket exited 0"; fi
grep -q 'no lifecycle configuration' "$tmp/out" && fail "a missing bucket was reported as no configuration"

echo "check: passes on the rule, fails on anything else"
reset; config Enabled erasure-ledger/ 47
life check || fail "check failed on a correct rule"
grep -q 'erasure-ledger/ expires after 47 days' "$tmp/out" || fail "check did not say 47 days"
for variant in "Enabled erasure-ledger/ 46" "Enabled erasure-ledger/ 48" "Disabled erasure-ledger/ 47" "Enabled other/ 47" "Enabled erasure-ledger/staging/ 47"; do
  reset
  # shellcheck disable=SC2086
  config $variant
  if life check; then fail "check passed on [$variant]"; fi
done
reset
if life check; then fail "check passed with no configuration"; fi
grep -q 'no lifecycle configuration' "$tmp/out" || fail "a missing configuration was not explained"
# 47 in a different element (an abort-multipart rule) is not the expiry
reset
cat > "$STUB_CONFIG" <<'XML'
<LifecycleConfiguration><Rule><ID>plateandbar-erasure-ledger-expiry</ID><Status>Enabled</Status><Filter><Prefix>erasure-ledger/</Prefix></Filter><Expiration><Days>30</Days></Expiration><AbortIncompleteMultipartUpload><DaysAfterInitiation>47</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule></LifecycleConfiguration>
XML
if life check; then fail "check passed on 47 days in the wrong element"; fi
# 47 days on a storage-class transition is not the expiry either
reset
cat > "$STUB_CONFIG" <<'XML'
<LifecycleConfiguration><Rule><ID>plateandbar-erasure-ledger-expiry</ID><Status>Enabled</Status><Filter><Prefix>erasure-ledger/</Prefix></Filter><Transition><Days>47</Days><StorageClass>STANDARD_IA</StorageClass></Transition><Expiration><Days>90</Days></Expiration></Rule></LifecycleConfiguration>
XML
if life check; then fail "check passed on 47 days in a transition"; fi
# the right rule under another id is not ours
reset
config Enabled erasure-ledger/ 47
sed -i.bak 's/plateandbar-erasure-ledger-expiry/someone-elses/' "$STUB_CONFIG"
if life check; then fail "check passed on a rule with another id"; fi

echo "credentials: on stdin only; the LIFECYCLE_S3_* token wins over BACKUP_S3_*; no response body is printed"
reset
LIFECYCLE_S3_ACCESS_KEY_ID=admin-id LIFECYCLE_S3_SECRET_ACCESS_KEY=admin-s3cret life apply || fail "apply with an admin token failed"
grep -qF 'user = "admin-id:admin-s3cret"' "$STUB_STDIN" || fail "the admin token was not sent on stdin"
! grep -q 'admin-s3cret\|change-me' "$STUB_LOG" || fail "a secret is on a curl command line"
reset
if life check; then fail "check without a configuration passed"; fi
grep -qF 'user = "change-me:change-me"' "$STUB_STDIN" || fail "BACKUP_S3_* was not the fallback"
if STUB_GET_HTTP=403 life check; then fail "denied token: exited 0"; fi
grep -q 'HTTP 403 AccessDenied' "$tmp/out" || fail "a denied token was not explained"
grep -q 'Admin' "$tmp/out" || fail "no hint about the Admin token"
! grep -q 'secret-row-content' "$tmp/out" || fail "a response body was printed"
reset
if STUB_PUT_HTTP=500 life apply; then fail "failed put: exited 0"; fi
grep -q 'HTTP 500 InternalError' "$tmp/out" || fail "a failed put was not reported"
! grep -q 'secret-row-content' "$tmp/out" || fail "a response body was printed"
if STUB_GET_HTTP=403 life apply; then fail "denied token on apply: exited 0"; fi
[ "$(puts)" = 1 ] || fail "apply put after a denied read"

echo "usage: anything else fails"
if life; then fail "no argument: exited 0"; fi
if life delete; then fail "unknown argument: exited 0"; fi
if life check extra; then fail "extra argument: exited 0"; fi

echo "the RUNBOOK has the owner step"
grep -q 'ledger-lifecycle.sh apply' "$here/../RUNBOOK.md" || fail "RUNBOOK.md does not tell the owner to run ledger-lifecycle.sh apply"
echo "ledger lifecycle tests passed"
