#!/usr/bin/env bash
# Applies the waivers to the scan findings and writes the report.
# Usage: report.sh <waivers.tsv> <findings.tsv> <today YYYY-MM-DD> <outdir>
#   waivers.tsv: id, scope, issue (#N), recheck date, reason; tab separated; blank lines and lines starting with # ignored
#   findings.tsv: scope, ids (comma separated), package, severity (from npm-audit-to-tsv.sh and osv-to-tsv.sh)
# Writes <outdir>/report.md and prints `findings=N` (findings no waiver covers) and `problems=M` (waivers that match
# nothing, and waivers past their re-check date). Exits 2 on a malformed waiver file or date.
set -euo pipefail
waivers="${1:?waivers file}"; findings="${2:?findings file}"; today="${3:?date}"; out="${4:?outdir}"
re_date='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
[[ "$today" =~ $re_date ]] || { echo "bad date: $today" >&2; exit 2; }
mkdir -p "$out"
tab=$'\t'
wid=(); wscope=(); wissue=(); wdate=(); wused=()
while IFS="$tab" read -r id scope issue recheck reason extra; do
  [ -z "$id" ] && continue
  [[ "$id" == \#* ]] && continue
  [ -z "${extra:-}" ] || { echo "waiver $id: too many fields" >&2; exit 2; }
  [[ "$issue" =~ ^#[0-9]+$ ]] || { echo "waiver $id: issue must look like #79" >&2; exit 2; }
  [[ "$recheck" =~ $re_date ]] || { echo "waiver $id: recheck must be YYYY-MM-DD" >&2; exit 2; }
  [ -n "$scope" ] && [ -n "${reason:-}" ] || { echo "waiver $id: scope and reason are required" >&2; exit 2; }
  wid+=("$id"); wscope+=("$scope"); wissue+=("$issue"); wdate+=("$recheck"); wused+=(0)
done < "$waivers"

unwaived="$out/unwaived.tsv"; : > "$unwaived"
while IFS="$tab" read -r scope ids pkg sev; do
  [ -z "$scope" ] && continue
  covered=0
  for i in "${!wid[@]}"; do
    [ "${wscope[$i]}" = "$scope" ] || continue
    case ",$ids," in *",${wid[$i]},"*) wused[i]=$((wused[i] + 1)); covered=1 ;; esac
  done
  [ "$covered" -eq 1 ] || printf '%s\t%s\t%s\t%s\n' "$scope" "$ids" "$pkg" "$sev" >> "$unwaived"
done < "$findings"

problems=()
for i in "${!wid[@]}"; do
  [ "${wused[$i]}" -gt 0 ] || problems+=("${wid[$i]} (${wscope[$i]}, ${wissue[$i]}) matches no finding: remove it from infra/dependency-scan/waivers.tsv and tick it off in ${wissue[$i]}")
  [[ "${wdate[$i]}" > "$today" || "${wdate[$i]}" == "$today" ]] || problems+=("${wid[$i]} (${wscope[$i]}, ${wissue[$i]}) re-check date ${wdate[$i]} has passed: check for a fix, then remove the waiver or move the date")
done

n_find="$(wc -l < "$unwaived" | tr -d ' ')"
{
  echo "Weekly dependency scan, $today. High and critical advisories; waivers are listed in infra/dependency-scan/waivers.tsv."
  echo
  if [ "$n_find" -gt 0 ]; then
    echo "### Findings without a waiver ($n_find)"
    echo
    echo "| Scope | Advisory | Package | Severity |"
    echo "| --- | --- | --- | --- |"
    while IFS="$tab" read -r scope ids pkg sev; do echo "| $scope | ${ids//,/, } | $pkg | $sev |"; done < "$unwaived"
    echo
  fi
  if [ "${#problems[@]}" -gt 0 ]; then
    echo "### Waiver problems (${#problems[@]})"
    echo
    for p in "${problems[@]}"; do echo "- $p"; done
    echo
  fi
  [ "$n_find" -gt 0 ] || [ "${#problems[@]}" -gt 0 ] || echo "No findings and no waiver problems."
} > "$out/report.md"
echo "findings=$n_find"
echo "problems=${#problems[@]}"
