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
assert "network_mode" not in svc, "network_mode %s" % svc["network_mode"]
if sys.argv[1] == "glitchtip":  # all-in-one runs web, worker and scheduler: 1 GiB at least (review of #881)
    assert int(svc["mem_limit"]) >= 1 << 30, "glitchtip mem_limit under 1g"
' "$s" || fail "$project/$s: needs mem_limit, no network_mode, and only caddy may publish ports"
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
    # unset, and set but empty: `${VAR?}` (no colon) would accept the empty value
    for how in "/^$v=/d" "s/^$v=.*/$v=/"; do
      sed "$how" .env.example > "$tmp/one-missing.env"
      if env -i PATH="$PATH" docker compose --env-file "$tmp/one-missing.env" config --quiet 2> "$tmp/err.txt"; then
        fail "$project: compose config passed with $v unset or empty; it must be required (\${$v:?...})"
      fi
      grep -q "required variable $v" "$tmp/err.txt" || fail "$project: error for missing $v does not name it"
    done
  done
}
required glitchtip GLITCHTIP_HOST SECRET_KEY POSTGRES_PASSWORD EMAIL_HOST DEFAULT_FROM_EMAIL
required uptime-kuma KUMA_HOST

# GlitchTip privacy settings from infra/OBSERVABILITY.md
g="$tmp/glitchtip.yml"
for line in '      SERVER_ROLE: all_in_one' '      VTASKS_INGEST_CONCURRENCY: "2"' '      GRANIAN_WORKERS_MAX_RSS: "512"' '      ENABLE_USER_REGISTRATION: "false"' '      ENABLE_ORGANIZATION_CREATION: "false"' \
            '      GLITCHTIP_RETENTION_DAYS: "30"' '      VALKEY_URL: ""'; do
  grep -qxF "$line" "$g" || fail "glitchtip: missing $line"
done
grep -q 'GLITCHTIP_PII_SCRUB_DEFAULT:.*"enabled": true' "$g" || fail "glitchtip: server-side scrubbing is not enabled"
grep -q 'max_locks_per_transaction=512' "$g" || fail "glitchtip: postgres lock budget"
# ENABLE_OPEN_USER_REGISTRATION takes precedence over ENABLE_ORGANIZATION_CREATION in 6.2.6 and would reopen creation
if grep -q 'ENABLE_OPEN_USER_REGISTRATION' "$g"; then fail "glitchtip: ENABLE_OPEN_USER_REGISTRATION must not be set"; fi
if grep -Eq 'valkey|redis' "$g"; then fail "glitchtip: valkey/redis must stay off"; fi

# Caddy. Each file has three logs, the access log, the global error log and the global default log (Host not in the per-host log map), and each must carry every privacy filter on
# its own (a filter in one must not satisfy the other), so the blocks are cut out and checked one by one.
cglitch="$root/infra/caddy/Caddyfile.glitchtip"
kuma="$root/infra/caddy/Caddyfile.kuma"
python3 -I - "$cglitch" "$kuma" <<'PY' || fail "Caddy log blocks, headers or client-IP drops (see the message above)"
import re, sys

def block(text, opener):
    """The braces-balanced block that starts at `opener`."""
    i = text.index(opener)
    j = text.index("{", i)
    depth = 0
    for k in range(j, len(text)):
        depth += {"{": 1, "}": -1}.get(text[k], 0)
        if depth == 0:
            return text[i:k + 1]
    raise SystemExit("unbalanced braces after " + opener)

def active(path):
    lines = (l for l in open(path).read().split("\n") if not l.lstrip().startswith("#"))
    return re.sub(r"\{\$[^}]*\}", "PLACEHOLDER", "\n".join(lines))  # {$VAR:default} is not a block

problems = []
for path, access, uri in (
    (sys.argv[1], "log glitchtip_access", r'request>uri regexp "\?.*$" ""'),
    (sys.argv[2], "log kuma_access", r'request>uri regexp "(?i)(/api/push/)[^?]*|\?.*$" "$1"'),
):
    text = active(path)
    for name, opener in (("access log", access), ("error log", "log errors"), ("default log", "log default")):
        b = block(text, opener)
        flat = re.sub(r"\s+", " ", b)
        for what, needle in (
            ("JSON via the filter encoder", "format filter { wrap json"),
            ("remote_ip masked to /24 and /48", "request>remote_ip ip_mask { ipv4 24 ipv6 48 }"),
            ("client_ip masked to /24 and /48", "request>client_ip ip_mask { ipv4 24 ipv6 48 }"),
            ("the URI cut " + uri, uri),
            ("request headers deleted", "request>headers delete"),
            ("response headers deleted", "resp_headers delete"),
        ):
            if needle not in flat:
                problems.append("%s: %s lacks %s" % (path, name, what))
        if "log_credentials" in b or "level DEBUG" in b:
            problems.append("%s: %s must not enable log_credentials or DEBUG" % (path, name))
    if "include http.log.error http.handlers.reverse_proxy" not in re.sub(r"\s+", " ", block(text, "log errors")) \
            or "output stderr" not in block(text, "log errors"):
        problems.append(path + ": error log must include http.log.error and http.handlers.reverse_proxy and write to stderr")
    if "output stderr" not in block(text, "log default"):
        problems.append(path + ": default log must write to stderr")
    ab = block(text, access)
    for need in ("output file /data/", "roll_size 10MiB", "roll_interval 24h", "roll_keep 15", "roll_keep_for 336h"):
        if need not in ab:
            problems.append("%s: access log lacks %s" % (path, need))
    hb = block(text, "\theader {")
    for need in ('Strict-Transport-Security "max-age=31536000"', "X-Content-Type-Options nosniff",
                 "X-Frame-Options DENY", "Referrer-Policy no-referrer", "-Server"):
        if need not in hb:
            problems.append("%s: header block lacks %s" % (path, need))

# GlitchTip stores the client IP it finds in these headers: all must be dropped before the upstream
rp = block(active(sys.argv[1]), "\treverse_proxy ")
for h in ("X-Forwarded-For", "X-Real-IP", "Forwarded", "Client-IP", "True-Client-IP", "X-Cluster-Client-IP", "CF-Connecting-IP"):
    if "header_up -%s\n" % h not in rp + "\n":
        problems.append("%s: reverse_proxy must drop %s" % (sys.argv[1], h))

# The push-token cut, tried on the URL forms Kuma accepts. Same pattern, tested with Go's regexp package in review
# (Python's re agrees on this syntax).
p = r"(?i)(/api/push/)[^?]*|\?.*$"
for uri, want in {"/api/push/SECRET?status=up&msg=OK&ping=": "/api/push/", "/api/push/SECRET": "/api/push/",
                  "/api/push/SECRET/": "/api/push/", "/api/push/SECRET?a?b": "/api/push/", "/API/PUSH/SECRET": "/API/PUSH/",
                  "//api/push/SECRET": "//api/push/", "https://h/api/push/SECRET?x=1": "https://h/api/push/",
                  "/api/v1/x?email=a@b.c": "/api/v1/x", "/": "/"}.items():
    got = re.sub(p, r"\1", uri)
    if got != want or "SECRET" in got:
        problems.append("push-token regexp: %s -> %s, want %s" % (uri, got, want))
if problems:
    print("\n".join(problems), file=sys.stderr)
    sys.exit(1)
PY
"$root/infra/scripts/check-caddy-access-log.sh" "glitchtip=$cglitch" >/dev/null \
  || fail "Caddyfile.glitchtip lost a log filter"
echo "monitoring config checks passed"
