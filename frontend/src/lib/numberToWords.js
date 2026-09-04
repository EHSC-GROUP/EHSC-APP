// Client-side mirror of backend/src/lib/numberToWords.js, used only for the
// live preview before submission — the server always recomputes and stores
// the authoritative amountInWords. Kept as one algorithm, ported once,
// rather than two independently-diverging implementations.

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return `${TENS[t]}${o ? " " + ONES[o] : ""}`;
}

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let out = "";
  if (h) out += `${ONES[h]} Hundred${rest ? " " : ""}`;
  if (rest) out += twoDigits(rest);
  return out;
}

function integerToWords(n) {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const hundred = n;

  const parts = [];
  if (crore) parts.push(`${integerToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));
  return parts.join(" ");
}

export function numberToWords(amount) {
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);

  if (paise > 0) {
    return `${integerToWords(rupees)} Rupees and ${integerToWords(paise)} Paise Only`;
  }
  return `${integerToWords(rupees)} Rupees Only`;
}
