#!/usr/bin/env bash
# R2 lifecycle rule for the erasure ledger (#911), the backstop for ledger-upload.sh's own pruning: it expires every object
# under erasure-ledger/ 47 days after it was last written (the 45-day retention, plus one day past the script's own
# "at most 46 days"). Every running VM's upload prunes every prefix, so the rule only matters when no VM runs the upload
# at all (every VM retired or its cron stopped).
#   ./ledger-lifecycle.sh apply   puts the rule on the bucket (idempotent), then checks it
#   ./ledger-lifecycle.sh check   exits non-zero unless the rule exists, is enabled, covers erasure-ledger/ and says 47 days
# Uses the S3 API call PutBucketLifecycleConfiguration / GetBucketLifecycleConfiguration, which R2 supports (checked
# 2026-10-18, developers.cloudflare.com/r2/api/s3/api and /r2/buckets/object-lifecycles). rclone has no lifecycle
# command, so this is curl (--aws-sigv4; tested with curl 8.7.1) and openssl, nothing proprietary.
# PutBucketLifecycleConfiguration REPLACES the bucket's whole configuration, so apply reads the existing one and writes
# it back with every other rule kept verbatim (R2's "Default Multipart Abort Rule" included), replacing only the rule
# with our ID.
# Credentials: bucket configuration is not covered by the Object Read and Write token of BACKUP_S3_* (R2 needs an Admin
# token for it). Pass LIFECYCLE_S3_ACCESS_KEY_ID and LIFECYCLE_S3_SECRET_ACCESS_KEY in the shell for the run (an Admin
# token, deleted afterwards; never in .env); without them BACKUP_S3_* is tried. The secret goes to curl on stdin, never on a
# command line. Prints the HTTP status and the S3 error code, never the response body.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=ledger-lib.sh
. ./ledger-lib.sh

rule_id="plateandbar-erasure-ledger-expiry"
rule_prefix="erasure-ledger/"
rule_days=$((ledger_retention_days + 2))
access_key="${LIFECYCLE_S3_ACCESS_KEY_ID:-$BACKUP_S3_ACCESS_KEY_ID}"
secret_key="${LIFECYCLE_S3_SECRET_ACCESS_KEY:-$BACKUP_S3_SECRET_ACCESS_KEY}"

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail() { echo "ledger-lifecycle FAILED: $*" >&2; exit 1; }

# s3 METHOD [BODY_FILE]: the bucket's ?lifecycle resource. The response body goes to $work/resp; prints the HTTP status.
s3() {
  local args=(-sS -m 30 -o "$work/resp" -w '%{http_code}' --aws-sigv4 "aws:amz:auto:s3" -K - -X "$1")
  if [ "$#" -gt 1 ]; then
    args+=(-H "Content-Type: application/xml" -H "Content-MD5: $(openssl md5 -binary "$2" | base64)" --data-binary "@$2")
  fi
  printf 'user = "%s:%s"\n' "$access_key" "$secret_key" | curl "${args[@]}" "${BACKUP_S3_ENDPOINT%/}/$BACKUP_S3_BUCKET?lifecycle"
}
error_code() { sed -n 's/.*<Code>\([^<]*\)<\/Code>.*/\1/p' "$work/resp" | head -1; }

# Fetches the bucket's configuration into $work/config (one tag per boundary, no whitespace between tags): "present"
# or "none" (no configuration yet). Anything else is a failure.
fetch() {
  local http
  http="$(s3 GET)" || fail "cannot reach $BACKUP_S3_ENDPOINT"
  case "$http" in
    200) tr -d '\r\n' < "$work/resp" | sed 's/>[[:space:]]*</></g' > "$work/config"; echo present ;;
    404) [ "$(error_code)" = NoSuchLifecycleConfiguration ] || fail "reading the lifecycle configuration answered HTTP 404 $(error_code) (wrong bucket name or endpoint?)"
      : > "$work/config"; echo none ;;
    *) fail "reading the lifecycle configuration answered HTTP $http $(error_code) (the token needs R2 Admin Read, see RUNBOOK.md section 3a)" ;;
  esac
}
# our rule, on its own line
our_rule() { sed 's/<\/Rule>/&\n/g' "$work/config" | grep -F "<ID>$rule_id</ID>" || true; }
rule_ok() {
  local r
  r="$(our_rule)"
  [ -n "$r" ] \
    && printf '%s' "$r" | grep -Fq '<Status>Enabled</Status>' \
    && printf '%s' "$r" | grep -Fq "<Prefix>$rule_prefix</Prefix>" \
    && printf '%s' "$r" | grep -Fq "<Expiration><Days>$rule_days</Days></Expiration>"
}
# every rule that is not ours, verbatim, one per line (rules without an <ID> are kept too)
other_rules() {
  sed 's/<\/Rule>/&\n/g' "$work/config" | sed -n 's/^.*\(<Rule>.*<\/Rule>\)$/\1/p' | grep -vF "<ID>$rule_id</ID>" || true
}

check() {
  local state
  state="$(fetch)"
  [ "$state" = present ] || fail "the bucket has no lifecycle configuration: run ./ledger-lifecycle.sh apply (RUNBOOK.md section 3a)"
  rule_ok || fail "rule $rule_id is missing, disabled, or not 'expire $rule_prefix after $rule_days days': run ./ledger-lifecycle.sh apply"
  echo "lifecycle rule ok: $rule_prefix expires after $rule_days days in $BACKUP_S3_BUCKET"
}

case "${1:-}" in
  check) [ "$#" -eq 1 ] || fail "usage: ledger-lifecycle.sh apply | check"
    check ;;
  apply) [ "$#" -eq 1 ] || fail "usage: ledger-lifecycle.sh apply | check"
    state="$(fetch)"
    if [ "$state" = present ] && rule_ok; then
      echo "lifecycle rule already applied: nothing to do"
      exit 0
    fi
    # the whole configuration is replaced by the PUT: every other rule goes back as it was, ours is replaced by ID
    printf '%s%s%s' "<LifecycleConfiguration>" "$(other_rules | tr -d '\n')" "<Rule><ID>$rule_id</ID><Filter><Prefix>$rule_prefix</Prefix></Filter><Status>Enabled</Status><Expiration><Days>$rule_days</Days></Expiration></Rule></LifecycleConfiguration>" > "$work/rule.xml"
    http="$(s3 PUT "$work/rule.xml")" || fail "cannot reach $BACKUP_S3_ENDPOINT"
    [ "$http" = 200 ] || fail "putting the lifecycle rule answered HTTP $http $(error_code)"
    echo "lifecycle rule put: $rule_prefix expires after $rule_days days"
    check ;;
  *) fail "usage: ledger-lifecycle.sh apply | check" ;;
esac
