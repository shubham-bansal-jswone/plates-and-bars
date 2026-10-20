/**
 * Lab reports (#1070) are off until the owner turns them on. Build-time flag: EXPO_PUBLIC_LAB_REPORTS=1 (set per release, see
 * infra/RUNBOOK.md). While it is off there is no entry point, no stored hold is read, and `labHold` is always false everywhere.
 */
export function labReportsEnabled(raw: string | undefined = process.env.EXPO_PUBLIC_LAB_REPORTS): boolean {
  return raw === '1';
}
