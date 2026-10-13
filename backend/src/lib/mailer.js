import nodemailer from "nodemailer";

// Sends email through an Outlook / Microsoft 365 mailbox over SMTP. Nothing is
// sent until these are set (on Cloud Run: as environment variables):
//   SMTP_USER   the mailbox that sends, e.g. noreply@ehsconsultantsgroup.org
//   SMTP_PASS   its password (or an app password)
//   SMTP_HOST   optional, default smtp.office365.com
//   SMTP_PORT   optional, default 587 (STARTTLS)
//   MAIL_FROM   optional, default "EHS HR App <SMTP_USER>"
// MAIL_DRY_RUN=1 builds the message without sending (used for testing).
export function mailConfigured() {
  return !!(process.env.MAIL_DRY_RUN || (process.env.SMTP_USER && process.env.SMTP_PASS));
}

let transport;
function getTransport() {
  if (transport) return transport;
  transport = process.env.MAIL_DRY_RUN
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.office365.com",
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        requireTLS: true,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
  return transport;
}

export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) return { sent: false, reason: "Email is not set up yet (SMTP_USER / SMTP_PASS)" };
  try {
    const info = await getTransport().sendMail({
      from: process.env.MAIL_FROM || `EHS HR App <${process.env.SMTP_USER || "no-reply@localhost"}>`,
      to, subject, text, html,
    });
    return { sent: true, id: info.messageId, preview: process.env.MAIL_DRY_RUN ? info.message : undefined };
  } catch (err) {
    console.error("Email failed:", err.message);
    return { sent: false, reason: err.message };
  }
}
