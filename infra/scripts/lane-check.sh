#!/usr/bin/env bash
# Warns (never fails) when a PR touches files owned by more than one lane in
# the "Lanes" table of docs/AGENTS.md. Contract PRs (packages/api + docs/adr)
# are one lane there, so they pass. Files outside every lane are ignored.
# Usage: lane-check.sh [base-rev]   (run from the repo root, head = HEAD)
#   CI passes HEAD^1: HEAD is the tested merge commit and its first parent is
#   the current base tip. Defaults to HEAD^1. If the rev does not resolve the
#   check is skipped with a notice (it only warns, so this never blocks).
set -euo pipefail
base="${1:-HEAD^1}"
if ! git rev-parse --verify --quiet "$base^{commit}" > /dev/null; then
  echo "::notice::base '$base' does not resolve; lane check skipped"
  exit 0
fi
agents=docs/AGENTS.md

# lane rows: "| Agent | Owns | Never touches |"; emit "<agent>\t<path>" per backticked path in Owns
map="$(awk -F'|' '
  /^## Lanes/ {in_t=1; next}
  /^## / && in_t {in_t=0}
  in_t && NF>=4 && $2 !~ /Agent|---/ {
    agent=$2; gsub(/^ +| +$/, "", agent)
    s=$3
    while (match(s, /`[^`]+`/)) {
      p=substr(s, RSTART+1, RLENGTH-2); sub(/\/$/, "", p)
      print agent "\t" p
      s=substr(s, RSTART+RLENGTH)
    }
  }' "$agents")"
[ -n "$map" ] || { echo "::error::could not parse lanes table in $agents"; exit 1; }

classify() {
  local f agent path
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    while IFS=$'\t' read -r agent path; do
      if [ "$f" = "$path" ] || [ "${f#"$path"/}" != "$f" ]; then
        printf '%s\t%s\n' "$agent" "$f"
        break
      fi
    done <<< "$map"
  done
}
hits="$(git diff --name-only "$base" HEAD | classify)"
lanes="$(printf '%s\n' "$hits" | cut -f1 | grep . | sort -u || true)"
n="$(printf '%s\n' "$lanes" | grep -c . || true)"

echo "Lanes touched: $n"
while IFS= read -r a; do
  [ -n "$a" ] || continue
  echo "- $a: $(printf '%s\n' "$hits" | grep -c "^$a	") file(s)"
done <<< "$lanes"
if [ "$n" -gt 1 ]; then
  names="$(printf '%s\n' "$lanes" | paste -sd, - | sed 's/,/, /g')"
  echo "::warning title=Multiple lanes::This PR touches more than one owned folder ($names). Split it unless the issue asks for it (docs/AGENTS.md)."
fi
