import path from "path";
import { fileURLToPath } from "url";

// EHS Consultants letterhead (top of page) and address footer (bottom of
// page), shared by every generated PDF so they all look like company
// stationery.
const LETTERHEAD = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../assets/letterhead.jpeg");
const LETTERHEAD_WIDTH = 270; // banner is ~4.3:1, so about 63pt tall
export const FOOTER_LINES = [
  "63 Manbhavan Nagar, near PNB, Goyal Nagar Branch (Bengali Square), Indore (M.P.) 452016",
  "Ph. +91 7999539958, Email - info@ehsconsultantsgroup.org",
];

// Places the letterhead flush with the `left` margin at the top of the
// current page, leaves the cursor just below it, and returns that y.
export function drawLetterhead(doc, { left, right, top = 24 }) {
  const img = doc.openImage(LETTERHEAD);
  const height = (img.height / img.width) * LETTERHEAD_WIDTH;
  doc.image(img, left, top, { width: LETTERHEAD_WIDTH });
  doc.y = top + height + 10;
  doc.x = left;
  return doc.y;
}

// Pins the address footer to the bottom of the current page. The bottom
// margin is zeroed while drawing so pdfkit doesn't spill onto a new page.
export function drawFooter(doc, { left, right }) {
  const { bottom } = doc.page.margins;
  doc.page.margins.bottom = 0;
  const top = doc.page.height - 44;
  doc.moveTo(left, top).lineTo(right, top).lineWidth(0.5).stroke();
  doc.font("Helvetica").fontSize(8.5);
  FOOTER_LINES.forEach((line, i) => {
    doc.text(line, left, top + 6 + i * 11, { width: right - left, align: "center", lineBreak: false });
  });
  doc.page.margins.bottom = bottom;
}
