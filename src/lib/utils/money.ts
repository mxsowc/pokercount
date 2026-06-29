// Parse a free-typed money string into a number, handling thousands separators
// and either decimal convention. The rule that disambiguates the two:
//   - If BOTH '.' and ',' appear, the LAST one is the decimal point and the other
//     is grouping:           "1.234,56" → 1234.56,  "1,234.56" → 1234.56
//   - Only ',' → it's grouping ONLY if it looks like grouped triples ("1,000" →
//     1000, "1,000,000" → 1000000); otherwise it's the decimal ("5,55" → 5.55).
//   - Only '.' → a SINGLE dot is the decimal point ("10.000" → 10, "1.250" → 1.25);
//     multiple dots are grouping ("1.000.000" → 1000000).
// This fixes the old parser, which stripped any separator before exactly three
// digits and so silently turned "10.000" into 10000 (a 1000× error).
export function parseAmount(v: unknown): number {
  let s = String(v ?? '').trim().replace(/\s+/g, '');
  if (!s) return NaN;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const grouping = decimal === '.' ? ',' : '.';
    s = s.split(grouping).join('');
    if (decimal === ',') s = s.replace(',', '.');
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.split(',').join('') : s.replace(',', '.');
  } else if (hasDot) {
    if (s.split('.').length - 1 > 1) s = s.split('.').join(''); // multiple dots = grouping
  }
  return Number(s);
}

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
