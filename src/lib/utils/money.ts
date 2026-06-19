// Currency symbols (≤3 chars: €, $, CHF, kr, C$, Kč…) sit in front of the number;
// word units like "chips" / "big blinds" read better after it ("50 chips").
function placeUnit(unit: string, formatted: string): string {
  return unit.length <= 3 ? unit + formatted : formatted + ' ' + unit;
}

export function money(n: number, unit = '€'): string {
  return placeUnit(unit, Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
}

export function fmtSigned(n: number, unit = '€'): string {
  const abs = Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const sign = n >= 0 ? '+' : '−';
  return sign + placeUnit(unit, abs);
}
