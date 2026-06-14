export function money(n: number, unit = '€'): string {
  return unit + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtSigned(n: number, unit = '€'): string {
  const abs = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (n >= 0 ? '+' : '\u2212') + unit + abs;
}
