// Mirrors prototype `fmt`: rounded, en-IN digit grouping.
export const fmt = (n: number): string => Math.round(n).toLocaleString('en-IN');
