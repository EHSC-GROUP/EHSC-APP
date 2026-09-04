// Single shared implementation of Indian-numbering-system number-to-words,
// used both for reimbursement "amount in words" and payslip net pay. The
// reference app implemented this twice (server + client); we render it once
// on the server and send the string to the client, so there is only one.

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

// Indian grouping: ones/tens/hundreds, then thousand, lakh, crore.
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

export function numberToWords(amount, { currency = "Rupees", subunit = "Paise" } = {}) {
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);

  let words = `${integerToWords(rupees)} ${currency} Only`;
  if (paise > 0) {
    words = `${integerToWords(rupees)} ${currency} and ${integerToWords(paise)} ${subunit} Only`;
  }
  return words;
}
