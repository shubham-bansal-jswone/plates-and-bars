// Mirrors prototype `fmt`: rounded, en-IN digit grouping.
export const fmt = (n: number): string => Math.round(n).toLocaleString('en-IN');

/** Mirrors prototype `shortDate`: "8 Oct". */
export const shortDate = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** "8 Oct 2024": `shortDate` with the year, for ranges that can span years. */
export const dateWithYear = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** "Monday" (the prototype's `toLocaleDateString('en-IN', { weekday: 'long' })`). */
export const weekdayLong = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'long' });
};

/** Mirrors prototype `dayName`: "Mon". */
export const dayName = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short' });
};
