// Currency symbols (≤3 chars: €, $, CHF, kr, C$, Kč…) sit in front of the number;
// word units like "chips" / "big blinds" read better after it ("50 chips").
function placeUnit(unit: string, formatted: string): string {
  return unit.length <= 3 ? unit + formatted : formatted + ' ' + unit;
}

// Collapse −0 and sub-cent rounding residue to 0 so we never render "-0".
function snap(n: number): number {
  return Math.abs(n) < 0.005 ? 0 : n;
}

export function money(n: number, unit = '€'): string {
  return placeUnit(unit, snap(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
}

export function fmtSigned(n: number, unit = '€'): string {
  const v = snap(n);
  const abs = Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const sign = v >= 0 ? '+' : '−';
  return sign + placeUnit(unit, abs);
}
