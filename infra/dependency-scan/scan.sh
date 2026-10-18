#!/usr/bin/env bash
# Weekly dependency scan (#930). Run from the repo root. Writes $OUT/report.md and prints findings=N / problems=M
# (see report.sh). A tool that fails or prints something unparsable fails the script: a scan that did not run
# is never reported as clean.
#   npm: `npm audit --package-lock-only` per package at high or critical. Shipped packages (api, mobile, site, core) use
#        --omit=dev; tools only run at build time, so its whole tree is checked.
#   Gradle: runtimeClasspath locked by lock-runtime.init.gradle, then OSV-Scanner on the lockfile (Gradle has no
#        committed lockfile and npm audit does not read Maven).
# Env: OUT (default dependency-scan-out), OSV_SCANNER (default osv-scanner), TODAY (default: today, UTC).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(pwd)"
OUT="${OUT:-dependency-scan-out}"; OSV_SCANNER="${OSV_SCANNER:-osv-scanner}"; TODAY="${TODAY:-$(date -u +%F)}"
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
findings="$OUT/findings.tsv"; : > "$findings"

audit() { # <dir> <npm flags...>
  local dir="$1"; shift
  # npm audit exits 1 when it finds anything; the report on stdout is what counts
  (cd "$root/$dir" && npm audit --package-lock-only --audit-level=high "$@" --json > "$OUT/audit.json" || true)
  "$here/npm-audit-to-tsv.sh" "$dir" < "$OUT/audit.json" >> "$findings"
}
audit packages/api --omit=dev
audit packages/core --omit=dev
audit apps/mobile --omit=dev
audit apps/site --omit=dev
audit tools

(cd "$root/backend" && ./gradlew -I "$here/lock-runtime.init.gradle" dependencies --configuration runtimeClasspath --write-locks --no-daemon -q > /dev/null)
[ -s "$root/backend/gradle.lockfile" ] || { echo "gradle.lockfile was not written" >&2; exit 1; }
# osv-scanner exits 1 when it finds vulnerabilities; any other status is a failure to scan
rc=0
"$OSV_SCANNER" scan source --lockfile "$root/backend/gradle.lockfile" --format json > "$OUT/osv.json" 2> "$OUT/osv.err" || rc=$?
[ "$rc" -le 1 ] || { cat "$OUT/osv.err" >&2; exit 1; }
"$here/osv-to-tsv.sh" backend < "$OUT/osv.json" >> "$findings"
rm -f "$root/backend/gradle.lockfile"

"$here/report.sh" "$here/waivers.tsv" "$findings" "$TODAY" "$OUT"
