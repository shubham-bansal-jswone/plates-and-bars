// Check-digit test for the numbers under a grocery barcode.
// TODO(#944): move to packages/core when the core PR for #944 (barcode digits, offToUserFood) merges, and import it from there.

const gtinOk = (digits: string): boolean => {
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
};

/** UPC-E (8 digits: number system 0 or 1, six digits, check digit) to the 12-digit UPC-A it stands for, or null. */
function upcEToUpcA(d: string): string | null {
  if (d[0] !== '0' && d[0] !== '1') return null;
  const [e1, e2, e3, e4, e5, e6] = d.slice(1, 7);
  const last = Number(e6);
  const body =
    last <= 2 ? `${e1}${e2}${e6}00` + `00${e3}${e4}${e5}`
    : last === 3 ? `${e1}${e2}${e3}00` + `000${e4}${e5}`
    : last === 4 ? `${e1}${e2}${e3}${e4}0` + `0000${e5}`
    : `${e1}${e2}${e3}${e4}${e5}` + `0000${e6}`;
  return `${d[0]}${body}${d[7]}`;
}

/**
 * The digits of an EAN-8, UPC-E (8 digits), UPC-A (12) or EAN-13 with a correct check digit, or null.
 * Spaces and hyphens are ignored (as printed on some packs); anything else that is not a digit fails.
 */
export function barcodeDigits(raw: string): string | null {
  const d = raw.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 12 || d.length === 13) return gtinOk(d) ? d : null;
  if (d.length === 8) {
    if (gtinOk(d)) return d; // EAN-8
    const a = upcEToUpcA(d);
    return a !== null && gtinOk(a) ? d : null;
  }
  return null;
}
