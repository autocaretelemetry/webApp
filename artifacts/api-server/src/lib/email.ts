import sgMail from "@sendgrid/mail";
import { logger } from "./logger";

const FROM_ADDRESS =
  process.env["EMAIL_FROM"] ?? "AutoCare <no-reply@autocare.test>";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const key = process.env["SENDGRID_API_KEY"];
  if (!key) return false;
  sgMail.setApiKey(key);
  configured = true;
  return true;
}

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Best-effort transactional email send. When `SENDGRID_API_KEY` is not set
 * (dev / preview), the message is logged instead of failing — callers should
 * never block their main flow on a delivery error.
 */
export async function sendEmail(
  msg: EmailMessage,
): Promise<{ ok: boolean; reason?: string }> {
  if (!msg.to) return { ok: false, reason: "no_recipient" };
  if (!ensureConfigured()) {
    logger.info(
      { to: msg.to, subject: msg.subject },
      "SENDGRID_API_KEY not set; logging email instead of sending",
    );
    return { ok: false, reason: "not_configured" };
  }
  try {
    await sgMail.send({
      to: msg.to,
      from: FROM_ADDRESS,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { ok: true };
  } catch (err) {
    logger.warn({ err, to: msg.to }, "sendgrid email send failed");
    return { ok: false, reason: "send_failed" };
  }
}

function wrap(body: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;">${body}<p style="color:#9ca3af;font-size:12px;margin-top:32px;">AutoCare — connected automotive service</p></body></html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function notePara(note: string | null | undefined): { text: string; html: string } {
  if (!note || !note.trim()) return { text: "", html: "" };
  const clean = note.trim();
  return {
    text: `\n\nReviewer note: ${clean}`,
    html: `<p style="background:#f3f4f6;border-left:3px solid #d1d5db;padding:12px 16px;margin:16px 0;"><strong>Reviewer note:</strong><br/>${escape(clean)}</p>`,
  };
}

export function signupVerificationEmail(
  name: string,
  code: string,
  expiresMinutes: number,
): Omit<EmailMessage, "to"> {
  return {
    subject: `Your AutoCare verification code: ${code}`,
    text: `Hi ${name},\n\nEnter this code on the signup page to confirm your email address:\n\n    ${code}\n\nThe code expires in ${expiresMinutes} minutes. If you didn't apply for an AutoCare account, you can ignore this message.\n\n— The AutoCare team`,
    html: wrap(
      `<h2 style="margin:0 0 16px;">Confirm your email</h2><p>Hi ${escape(name)},</p><p>Enter this code on the signup page to confirm your email address:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:24px 0;padding:16px;background:#f3f4f6;border-radius:8px;text-align:center;">${escape(code)}</p><p style="color:#6b7280;font-size:13px;">The code expires in ${expiresMinutes} minutes. If you didn't apply for an AutoCare account, you can ignore this message.</p>`,
    ),
  };
}

export function applicationApprovedEmail(
  name: string,
  note: string | null | undefined,
): Omit<EmailMessage, "to"> {
  const n = notePara(note);
  return {
    subject: "Your AutoCare application is approved",
    text: `Hi ${name},\n\nGood news — your AutoCare application has been approved. Sign in to continue and submit your KYC documents to unlock the platform.${n.text}\n\n— The AutoCare team`,
    html: wrap(
      `<h2 style="margin:0 0 16px;">You're approved</h2><p>Hi ${escape(name)},</p><p>Good news — your AutoCare application has been <strong>approved</strong>. Sign in to continue and submit your KYC documents to unlock the platform.</p>${n.html}`,
    ),
  };
}

export function applicationRejectedEmail(
  name: string,
  note: string | null | undefined,
): Omit<EmailMessage, "to"> {
  const n = notePara(note);
  return {
    subject: "Update on your AutoCare application",
    text: `Hi ${name},\n\nThank you for applying to AutoCare. After review, we are unable to approve your application at this time.${n.text}\n\nYou are welcome to reach out or apply again with updated information.\n\n— The AutoCare team`,
    html: wrap(
      `<h2 style="margin:0 0 16px;">Application update</h2><p>Hi ${escape(name)},</p><p>Thank you for applying to AutoCare. After review, we are <strong>unable to approve</strong> your application at this time.</p>${n.html}<p>You are welcome to reach out or apply again with updated information.</p>`,
    ),
  };
}

export function kycVerifiedEmail(
  name: string,
  note: string | null | undefined,
): Omit<EmailMessage, "to"> {
  const n = notePara(note);
  return {
    subject: "Your AutoCare KYC is verified",
    text: `Hi ${name},\n\nYour KYC documents have been verified. You now have full access to AutoCare — sign in to get started.${n.text}\n\n— The AutoCare team`,
    html: wrap(
      `<h2 style="margin:0 0 16px;">KYC verified</h2><p>Hi ${escape(name)},</p><p>Your KYC documents have been <strong>verified</strong>. You now have full access to AutoCare — sign in to get started.</p>${n.html}`,
    ),
  };
}

export function kycRejectedEmail(
  name: string,
  note: string | null | undefined,
): Omit<EmailMessage, "to"> {
  const n = notePara(note);
  return {
    subject: "Your AutoCare KYC needs attention",
    text: `Hi ${name},\n\nWe reviewed your KYC submission and need you to resubmit. Sign in and visit the KYC page to upload corrected documents.${n.text}\n\n— The AutoCare team`,
    html: wrap(
      `<h2 style="margin:0 0 16px;">KYC needs attention</h2><p>Hi ${escape(name)},</p><p>We reviewed your KYC submission and need you to <strong>resubmit</strong>. Sign in and visit the KYC page to upload corrected documents.</p>${n.html}`,
    ),
  };
}
