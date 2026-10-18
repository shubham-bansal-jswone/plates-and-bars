#!/usr/bin/env bash
# Tests the dependency scan's parsers, waiver filter and summary (report.sh) on fixtures; no network, no npm, no OSV.
# Run from anywhere: infra/dependency-scan/test-dependency-scan.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
tab=$'\t'
eq() { [ "$2" = "$3" ] || fail "$1: expected [$3] got [$2]"; }

# npm audit: only high and critical advisory objects; dependants (string via) and moderate ones are ignored
got="$("$here/npm-audit-to-tsv.sh" apps/mobile <<'JSON'
{"vulnerabilities":{
 "braces":{"name":"braces","severity":"high","via":[{"source":1,"name":"braces","severity":"high","url":"https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"}]},
 "micromatch":{"name":"micromatch","severity":"high","via":["braces"]},
 "uuid":{"name":"uuid","severity":"moderate","via":[{"source":2,"name":"uuid","severity":"moderate","url":"https://github.com/advisories/GHSA-w5hq-g745-h8pq"}]},
 "x":{"name":"x","severity":"critical","via":[{"source":3,"name":"x","severity":"critical","url":"https://github.com/advisories/GHSA-aaaa-bbbb-cccc"},{"source":3,"name":"x","severity":"critical","url":"https://github.com/advisories/GHSA-aaaa-bbbb-cccc"}]}}}
JSON
)"
eq "npm parse" "$got" "apps/mobile${tab}GHSA-aaaa-bbbb-cccc${tab}x${tab}critical
apps/mobile${tab}GHSA-vfj7-8cjw-p6xm${tab}braces${tab}high"
"$here/npm-audit-to-tsv.sh" tools <<<'{"vulnerabilities":{}}' > "$tmp/empty"; [ ! -s "$tmp/empty" ] || fail "clean report printed lines"
if "$here/npm-audit-to-tsv.sh" tools <<<'{"error":{"code":"ENOLOCK"}}' > /dev/null 2>&1; then fail "npm error report accepted as clean"; fi

# OSV: groups scored 7+, 9+ and unscored are kept with their aliases; 5.x is dropped
got="$("$here/osv-to-tsv.sh" backend <<'JSON'
{"results":[{"packages":[{"package":{"name":"g:a","version":"1.0"},"groups":[
 {"ids":["GHSA-1"],"aliases":["CVE-1","GHSA-1"],"max_severity":"9.8"},
 {"ids":["GHSA-2"],"aliases":["GHSA-2"],"max_severity":"7.5"},
 {"ids":["GHSA-3"],"aliases":["GHSA-3"],"max_severity":"5.6"},
 {"ids":["GHSA-4"],"aliases":["GHSA-4"],"max_severity":""}]}]}]}
JSON
)"
eq "osv parse" "$got" "backend${tab}CVE-1,GHSA-1${tab}g:a@1.0${tab}critical
backend${tab}GHSA-2${tab}g:a@1.0${tab}high
backend${tab}GHSA-4${tab}g:a@1.0${tab}unknown"
"$here/osv-to-tsv.sh" backend <<<'{"results":[]}' > "$tmp/empty"; [ ! -s "$tmp/empty" ] || fail "clean osv printed lines"
if "$here/osv-to-tsv.sh" backend <<<'{"error":"x"}' > /dev/null 2>&1; then fail "osv error accepted as clean"; fi

# report.sh
w() { printf '%s\n' "$@" > "$tmp/waivers.tsv"; }
f() { printf '%s\n' "$@" > "$tmp/findings.tsv"; }
run() { "$here/report.sh" "$tmp/waivers.tsv" "$tmp/findings.tsv" "$1" "$tmp/out"; }
W1="# comment
GHSA-a${tab}apps/mobile${tab}#79${tab}2026-11-18${tab}no fix"

w "$W1"; f "apps/mobile${tab}GHSA-a${tab}braces${tab}high"
eq "waived finding" "$(run 2026-10-18)" "findings=0
problems=0"
grep -q "No findings and no waiver problems" "$tmp/out/report.md" || fail "clean report text"

f "apps/mobile${tab}GHSA-a${tab}braces${tab}high" "apps/mobile${tab}GHSA-b${tab}other${tab}critical"
eq "unwaived finding" "$(run 2026-10-18)" "findings=1
problems=0"
grep -q '| apps/mobile | GHSA-b | other | critical |' "$tmp/report.md" 2>/dev/null || grep -q '| apps/mobile | GHSA-b | other | critical |' "$tmp/out/report.md" || fail "finding row"
grep -q GHSA-a "$tmp/out/report.md" && fail "waived finding listed"

# a waiver covers only its scope, and an alias in a comma list matches
f "apps/site${tab}GHSA-a${tab}braces${tab}high"
eq "other scope not waived" "$(run 2026-10-18)" "findings=1
problems=1"
f "apps/mobile${tab}CVE-9,GHSA-a${tab}braces${tab}high"
eq "alias match" "$(run 2026-10-18)" "findings=0
problems=0"

# stale waiver: matches nothing
: > "$tmp/findings.tsv"
eq "stale waiver" "$(run 2026-10-18)" "findings=0
problems=1"
grep -q "matches no finding" "$tmp/out/report.md" || fail "stale text"

# re-check date: still fine on the day, a problem the day after
f "apps/mobile${tab}GHSA-a${tab}braces${tab}high"
eq "recheck day" "$(run 2026-11-18)" "findings=0
problems=0"
eq "recheck passed" "$(run 2026-11-19)" "findings=0
problems=1"
grep -q "re-check date 2026-11-18 has passed" "$tmp/out/report.md" || fail "expired text"

# malformed waivers and dates exit 2
for bad in "GHSA-a${tab}apps/mobile${tab}79${tab}2026-11-18${tab}r" "GHSA-a${tab}apps/mobile${tab}#79${tab}soon${tab}r" \
  "GHSA-a${tab}apps/mobile${tab}#79${tab}2026-11-18" "GHSA-a${tab}apps/mobile${tab}#79${tab}2026-11-18${tab}r${tab}x"; do
  w "$bad"; rc=0; run 2026-10-18 > /dev/null 2>&1 || rc=$?; eq "malformed waiver rc" "$rc" 2
done
w "$W1"; rc=0; run tomorrow > /dev/null 2>&1 || rc=$?; eq "bad date rc" "$rc" 2

# the committed waiver file parses and every entry is for a real scope with an issue link
"$here/report.sh" "$here/waivers.tsv" /dev/null 2026-10-18 "$tmp/out" > /dev/null || fail "waivers.tsv does not parse"
echo "dependency-scan tests passed"
