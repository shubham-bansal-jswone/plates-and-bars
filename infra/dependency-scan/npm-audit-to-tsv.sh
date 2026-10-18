#!/usr/bin/env bash
# Reads `npm audit --json` on stdin and prints one line per high or critical advisory:
#   scope <TAB> advisory id <TAB> package <TAB> severity <TAB> fix (npm fixAvailable: "none", "npm audit fix" or name@version)
# Only advisory entries are reported (the `via` objects), not the packages that merely depend on a vulnerable one.
# Usage: npm audit --package-lock-only --json | infra/dependency-scan/npm-audit-to-tsv.sh apps/mobile
set -euo pipefail
scope="${1:?usage: npm-audit-to-tsv.sh <scope>}"
jq -rn --arg scope "$scope" ' input |
  if (.vulnerabilities | type) != "object" then error("not an npm audit report") else . end
  | [ .vulnerabilities[] | (.fixAvailable
        | if . == true then "npm audit fix" elif type == "object" then (.name + "@" + .version) else "none" end) as $fix
      | .via[] | select(type == "object") | select(.severity == "high" or .severity == "critical")
      | [$scope, ((.url // "") | split("/") | last | if . == "" then (.source | tostring) else . end), .name, .severity, $fix] ]
  | unique | .[] | @tsv' < /dev/stdin
