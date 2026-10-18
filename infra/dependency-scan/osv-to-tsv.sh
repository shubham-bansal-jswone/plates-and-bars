#!/usr/bin/env bash
# Reads `osv-scanner --format json` on stdin and prints one line per vulnerability group scored high (CVSS >= 7.0),
# critical (>= 9.0) or without a score ("unknown", reported rather than guessed low):
#   scope <TAB> ids (comma separated: the group ids and their aliases) <TAB> package@version <TAB> severity
# Usage: osv-scanner scan source --lockfile gradle.lockfile --format json | infra/dependency-scan/osv-to-tsv.sh backend
set -euo pipefail
scope="${1:?usage: osv-to-tsv.sh <scope>}"
jq -rn --arg scope "$scope" ' input |
  if (.results | type) != "array" then error("not an osv-scanner report") else . end
  | [ .results[].packages[] | .package as $p | .groups[]
      | (.max_severity // "") as $s
      | (if $s == "" then "unknown" elif ($s | tonumber) >= 9 then "critical" elif ($s | tonumber) >= 7 then "high" else "low" end) as $sev
      | select($sev != "low")
      | [$scope, ((.aliases + .ids) | unique | join(",")), ($p.name + "@" + $p.version), $sev] ]
  | unique | .[] | @tsv' < /dev/stdin
