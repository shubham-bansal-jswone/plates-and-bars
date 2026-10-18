#!/usr/bin/env bash
# Offline checks of the inert monitoring stacks (#828): compose config with .env.example, required secrets have no default,
# every image is pinned by version AND digest, every service has a memory limit, only Caddy publishes ports, the privacy
# settings are present, and the Caddy log filters (including the Kuma push-token cut) are in place. No stack is started and
# no network is used. `caddy validate` and the arm64 check need Docker pulls and run in .github/workflows/monitoring-config.yml.
# Usage: infra/monitoring/test-config.sh   (from anywhere; needs docker compose)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
fail() { echo "FAIL: $*" >&2; exit 1; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

for project in glitchtip uptime-kuma; do
  cd "$here/$project"
  cfg="$tmp/$project.yml"
  docker compose --env-file .env.example config > "$cfg"

  # pinned: version tag and sha256 digest on every image
  images="$(docker compose --env-file .env.example config --images)"
  [ -n "$images" ] || fail "$project: no images"
  while IFS= read -r image; do
    printf '%s\n' "$image" | grep -Eq '^[a-z0-9./_-]+:[0-9]+(\.[0-9]+)+(-[a-z]+)?@sha256:[0-9a-f]{64}$' \
      || fail "$project: image not pinned by version and digest: $image"
  done <<< "$images"

  # every service has a memory limit; only caddy publishes ports
  services="$(docker compose --env-file .env.example config --services)"
  for s in $services; do
    docker compose --env-file .env.example config --format json | python3 -I -c '
import json, sys
svc = json.load(sys.stdin)["services"][sys.argv[1]]
assert int(svc.get("mem_limit", 0)) > 0, "no mem_limit"
published = bool(svc.get("ports"))
assert published == (sys.argv[1] == "caddy"), "ports published: %s" % published
' "$s" || fail "$project/$s: needs mem_limit, and only caddy may publish ports"
  done

  # .env.example: hosts only get example.com placeholders, and compose reads no secret literal
  grep -Eq '^[A-Z_]+_HOST=[a-z]+\.example\.com$' .env.example || fail "$project: .env.example host placeholder"
  if grep -Eqi 'password: +[^$ "]|secret_key: +[^$ "]' docker-compose.yml; then fail "$project: secret literal in docker-compose.yml"; fi
done

# required secrets and hosts have no default (one missing at a time)
required() { # required <project> <var>...
  local project="$1"; shift
  cd "$here/$project"
  for v in "$@"; do
    sed "/^$v=/d" .env.example > "$tmp/one-missing.env"
    if env -i PATH="$PATH" docker compose --env-file "$tmp/one-missing.env" config --quiet 2> "$tmp/err.txt"; then
      fail "$project: compose config passed without $v; it must be required"
    fi
    grep -q "required variable $v" "$tmp/err.txt" || fail "$project: error for missing $v does not name it"
  done
}
required glitchtip GLITCHTIP_HOST SECRET_KEY POSTGRES_PASSWORD EMAIL_HOST DEFAULT_FROM_EMAIL
required uptime-kuma KUMA_HOST

# GlitchTip privacy settings from infra/OBSERVABILITY.md
g="$tmp/glitchtip.yml"
for line in '      ENABLE_USER_REGISTRATION: "false"' '      ENABLE_ORGANIZATION_CREATION: "false"' \
            '      GLITCHTIP_RETENTION_DAYS: "30"' '      VALKEY_URL: ""'; do
  grep -qxF "$line" "$g" || fail "glitchtip: missing $line"
done
grep -q 'GLITCHTIP_PII_SCRUB_DEFAULT:.*"enabled": true' "$g" || fail "glitchtip: server-side scrubbing is not enabled"
grep -q 'max_locks_per_transaction=512' "$g" || fail "glitchtip: postgres lock budget"
if grep -Eq 'valkey|redis' "$g"; then fail "glitchtip: valkey/redis must stay off"; fi

# Caddy: the shared log filters, the IP header drop, and the Kuma push-token cut
"$root/infra/scripts/check-caddy-access-log.sh" \
  "api=$root/infra/caddy/Caddyfile.glitchtip" "stack=$root/infra/caddy/Caddyfile.glitchtip" >/dev/null \
  || fail "Caddyfile.glitchtip lost a log filter"
grep -q 'header_up -X-Forwarded-For' "$root/infra/caddy/Caddyfile.glitchtip" || fail "Caddyfile.glitchtip must drop X-Forwarded-For"
kuma="$root/infra/caddy/Caddyfile.kuma"
# shellcheck disable=SC2016  # the single quotes are a literal pattern
[ "$(grep -c 'request>uri regexp "^(/api/push/)\[^?\]\*|\\?\.\*\$" "\$1"' "$kuma")" = 2 ] \
  || fail "Caddyfile.kuma: both logs (access and error) must cut the push token and the query"
# the pattern really does what it says (Go and Python regexps agree on this syntax)
python3 -I - <<'PY' || fail "push-token regexp"
import re
p = r"^(/api/push/)[^?]*|\?.*$"
cases = {"/api/push/SECRET?status=up&msg=OK&ping=": "/api/push/", "/api/push/SECRET": "/api/push/",
         "/api/v1/x?email=a@b.c": "/api/v1/x", "/": "/"}
for uri, want in cases.items():
    got = re.sub(p, r"\1", uri)
    assert got == want and "SECRET" not in got, (uri, got)
PY
for f in "$root/infra/caddy/Caddyfile.glitchtip" "$kuma"; do
  if grep -Eq 'log_credentials|level DEBUG' "$f"; then fail "$f: log must not enable log_credentials"; fi
  for need in 'roll_keep_for 336h' 'include http.log.error' 'output file /data/'; do
    grep -q "$need" "$f" || fail "$f: lacks $need"
  done
done
echo "monitoring config checks passed"
