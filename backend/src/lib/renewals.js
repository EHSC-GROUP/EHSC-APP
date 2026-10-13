import cron from "node-cron";
import { db } from "../config/firebase.js";
import { COLLECTIONS } from "./constants.js";
import { sendMail } from "./mailer.js";
import { fmtDMY } from "./dateUtils.js";

export const RENEWAL_FREQUENCIES = Object.freeze({ MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 });
export const FREQUENCY_LABELS = Object.freeze({ MONTHLY: "Monthly", QUARTERLY: "Quarterly", HALF_YEARLY: "Half-yearly", YEARLY: "Yearly" });
export const alertRecipient = () => process.env.RENEWAL_ALERT_EMAIL || "gayathri@ehsconsultantsgroup.org";

const col = () => db.collection(COLLECTIONS.HR_RENEWALS);
const DAY = 86400000;
const isoToday = () => new Date().toISOString().slice(0, 10);

// Adds whole months to an ISO date, keeping the day of month where it exists
// (31 Jan + 1 month = 28/29 Feb, never a spill into March).
export function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split("-").map(Number);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export const daysUntil = (iso, today = isoToday()) => Math.round((new Date(`${iso}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / DAY);

// The alert window is fixed: the day before and the day itself (plus overdue).
export function statusOf(item, today = isoToday()) {
  const left = daysUntil(item.nextDueDate, today);
  if (left < 0) return "OVERDUE";
  if (left === 0) return "DUE_TODAY";
  if (left === 1) return "DUE_TOMORROW";
  return "OK";
}

// Moves to the next due date after a renewal / payment, catching up if the
// item was well overdue so it never lands on a date already in the past.
export function advanceDueDate(item, today = isoToday()) {
  const step = RENEWAL_FREQUENCIES[item.frequency];
  let next = addMonthsISO(item.nextDueDate, step);
  for (let i = 0; i < 120 && next <= today; i++) next = addMonthsISO(next, step);
  return next;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// One email per run, sent the day BEFORE an item is due, listing every item due
// tomorrow. Each item is emailed only once per due date, so running this daily
// never repeats it. (Items due today or overdue show in the Renewals alerts
// section of the app; "Send reminder now" also emails those.)
export async function runRenewalReminders({ today = isoToday(), force = false } = {}) {
  const snap = await col().get();
  const due = [];
  for (const d of snap.docs) {
    const item = { id: d.id, ...d.data() };
    if (item.active === false) continue;
    const left = daysUntil(item.nextDueDate, today);
    if (!(left === 1 || (force && left <= 1))) continue;
    const stageKey = `${item.nextDueDate}:EMAIL`;
    if (!force && item.lastReminder === stageKey) continue;
    due.push({ item, left, stageKey });
  }
  if (due.length === 0) return { reminded: 0, email: { sent: false, reason: "Nothing is due tomorrow" } };

  due.sort((a, b) => a.item.nextDueDate.localeCompare(b.item.nextDueDate));
  const lines = due.map(({ item, left }) => {
    const when = left < 0 ? `OVERDUE by ${-left} day${-left === 1 ? "" : "s"}` : left === 0 ? "due TODAY" : "due TOMORROW";
    return `${item.name} (${FREQUENCY_LABELS[item.frequency]}) - ${fmtDMY(item.nextDueDate)} - ${when}`;
  });
  const subject = due.every((x) => x.left === 1)
    ? `Renewals due tomorrow: ${due.map((x) => x.item.name).join(", ")}`
    : `Renewals reminder: ${due.length} item${due.length === 1 ? "" : "s"} need attention`;
  const text = `Hello,\n\nThese recurring payments / renewals need attention:\n\n${lines.map((l) => ` - ${l}`).join("\n")}\n\nOpen the HR app > Renewals to mark them renewed.\n\nThis is a system generated email.`;
  const html = `<p>Hello,</p><p>These recurring payments / renewals need attention:</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p>Open the HR app &gt; <b>Renewals</b> to mark them renewed.</p><p style="color:#666">This is a system generated email.</p>`;

  const email = await sendMail({ to: alertRecipient(), subject, text, html });
  // Only mark them as emailed if the email really went out, so a failed or
  // not-yet-configured send is tried again on the next run (still inside the window).
  if (email.sent) {
    const batch = db.batch();
    for (const { item, stageKey } of due) batch.update(col().doc(item.id), { lastReminder: stageKey, lastReminderAt: new Date().toISOString() });
    await batch.commit();
  }
  return { reminded: due.length, email: { sent: email.sent, reason: email.reason, to: alertRecipient(), preview: email.preview } };
}

export function startRenewalReminderJob() {
  cron.schedule("0 9 * * *", () => {
    runRenewalReminders().catch((err) => console.error("Renewal reminders failed:", err));
  });
}
