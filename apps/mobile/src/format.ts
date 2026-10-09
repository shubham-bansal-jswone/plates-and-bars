// Mirrors prototype `fmt`: rounded, en-IN digit grouping.
export const fmt = (n: number): string => Math.round(n).toLocaleString('en-IN');

/** Mirrors prototype `shortDate`: "8 Oct". */
export const shortDate = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
