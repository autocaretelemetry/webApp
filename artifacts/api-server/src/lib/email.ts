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

export function reminderJobFailureEmail(args: {
  streakLength: number;
  errorMessage: string | null;
  runUrl: string;
}): Omit<EmailMessage, "to"> {
  const { streakLength, errorMessage, runUrl } = args;
  const errText = errorMessage?.trim() || "(no error message recorded)";
  return {
    subject: `AutoCare reminder job failing (${streakLength} runs in a row)`,
    text: `Heads up — the AutoCare service-reminder job has failed ${streakLength} times in a row. Owners may stop receiving service reminders until this is resolved.\n\nLatest error:\n${errText}\n\nReview recent runs: ${runUrl}\n\nYou will not receive another alert for this streak; a follow-up will be sent if it recovers and then fails again.\n\n— AutoCare`,
    html: wrap(
      `<h2 style="margin:0 0 16px;">Reminder job failing</h2><p>The AutoCare service-reminder job has failed <strong>${streakLength}</strong> times in a row. Owners may stop receiving service reminders until this is resolved.</p><p style="margin:16px 0 4px;color:#6b7280;font-size:13px;">Latest error</p><pre style="background:#f3f4f6;border-left:3px solid #d1d5db;padding:12px 16px;margin:0 0 16px;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">${escape(errText)}</pre><p><a href="${escape(runUrl)}" style="color:#b45309;font-weight:600;">Review recent reminder runs →</a></p><p style="color:#9ca3af;font-size:12px;margin-top:24px;">You will not receive another alert for this streak; a follow-up will be sent only if the job recovers and then fails again.</p>`,
    ),
  };
}

export function payoutStuckDigestEmail(args: {
  payouts: ReadonlyArray<{
    sellerName: string;
    sellerKind: string;
    netAmount: number;
    status: string;
    lastError: string | null;
    createdAt: Date;
  }>;
  thresholdMs: number;
  listUrl: string;
}): Omit<EmailMessage, "to"> {
  const { payouts, thresholdMs, listUrl } = args;
  const hours = Math.max(1, Math.floor(thresholdMs / (60 * 60 * 1000)));
  const fmtReason = (p: { status: string; lastError: string | null }): string => {
    if (p.status === "needs_account") return "no payout account on file";
    if (p.status === "failed")
      return `disbursement failed — ${(p.lastError ?? "unknown error").slice(0, 160)}`;
    return "still pending disbursement";
  };
  const fmtAge = (createdAt: Date): string => {
    const h = Math.floor((Date.now() - createdAt.getTime()) / (60 * 60 * 1000));
    if (h < 48) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  };
  const lines = payouts.map(
    (p) =>
      `• [${p.status}] ${p.sellerName} (${p.sellerKind}) — GHS ${p.netAmount.toFixed(2)} — stuck ${fmtAge(p.createdAt)} — ${fmtReason(p)}`,
  );
  const rows = payouts
    .map(
      (p) =>
        `<tr><td style="padding:8px 12px;border-top:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#92400e;">${escape(p.status)}</td><td style="padding:8px 12px;border-top:1px solid #e5e7eb;">${escape(p.sellerName)} <span style="color:#6b7280;">(${escape(p.sellerKind)})</span></td><td style="padding:8px 12px;border-top:1px solid #e5e7eb;white-space:nowrap;">GHS ${p.netAmount.toFixed(2)}</td><td style="padding:8px 12px;border-top:1px solid #e5e7eb;white-space:nowrap;color:#6b7280;">${escape(fmtAge(p.createdAt))}</td><td style="padding:8px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${escape(fmtReason(p))}</td></tr>`,
    )
    .join("");
  return {
    subject: `AutoCare: ${payouts.length} seller payout${payouts.length === 1 ? "" : "s"} stuck > ${hours}h`,
    text: `Heads up — ${payouts.length} seller payout${payouts.length === 1 ? " has" : "s have"} been stuck for more than ${hours} hours. Review and settle them so funds don't sit unpaid.\n\n${lines.join("\n")}\n\nReview the queue: ${listUrl}\n\nYou will not receive another email about these specific payouts today; if they remain stuck tomorrow you will be alerted again.\n\n— AutoCare`,
    html: wrap(
      `<h2 style="margin:0 0 16px;">Seller payouts stuck</h2><p><strong>${payouts.length}</strong> payout${payouts.length === 1 ? " has" : "s have"} been stuck for more than <strong>${hours} hours</strong>. Review and settle them so funds don't sit unpaid.</p><table style="width:100%;border-collapse:collapse;margin:16px 0;"><thead><tr><th style="text-align:left;padding:8px 12px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Status</th><th style="text-align:left;padding:8px 12px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Seller</th><th style="text-align:left;padding:8px 12px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Net</th><th style="text-align:left;padding:8px 12px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Age</th><th style="text-align:left;padding:8px 12px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Reason</th></tr></thead><tbody>${rows}</tbody></table><p><a href="${escape(listUrl)}" style="color:#b45309;font-weight:600;">Open the payouts queue →</a></p><p style="color:#9ca3af;font-size:12px;margin-top:24px;">You will not receive another email about these specific payouts today; if they remain stuck tomorrow you will be alerted again.</p>`,
    ),
  };
}

export function paymentStuckAlertEmail(args: {
  stuckCount: number;
  unreachable: number;
  staleAfterMs: number;
  reasons: string[];
  listUrl: string;
}): Omit<EmailMessage, "to"> {
  const { stuckCount, unreachable, staleAfterMs, reasons, listUrl } = args;
  const mins = Math.max(1, Math.floor(staleAfterMs / (60 * 1000)));
  const reasonLines = reasons.map((r) => `• ${r}`).join("\n");
  const reasonItems = reasons
    .map(
      (r) =>
        `<li style="margin:4px 0;">${escape(r)}</li>`,
    )
    .join("");
  return {
    subject: `AutoCare: ${stuckCount} payment${stuckCount === 1 ? "" : "s"} stuck in 'pending'`,
    text: `Heads up — payment settlement looks unhealthy. The reconciler just swept payment_transactions and tripped an alert.\n\n${reasonLines}\n\n${stuckCount} charge${stuckCount === 1 ? " has" : "s have"} been stuck in 'pending' for more than ${mins} minutes; ${unreachable} verification${unreachable === 1 ? "" : "s"} could not reach PaySwitch on this sweep. This often means a PaySwitch outage is stranding customer payments.\n\nReview the queue: ${listUrl}\n\nYou will not receive another email about this today; if payments are still stuck tomorrow you will be alerted again.\n\n— AutoCare`,
    html: wrap(
      `<h2 style="margin:0 0 16px;">Payments stuck in 'pending'</h2><p>Payment settlement looks unhealthy. The reconciler just swept <code>payment_transactions</code> and tripped an alert.</p><ul style="margin:16px 0;padding-left:20px;color:#1f2937;">${reasonItems}</ul><p><strong>${stuckCount}</strong> charge${stuckCount === 1 ? " has" : "s have"} been stuck in <code>pending</code> for more than <strong>${mins} minutes</strong>; <strong>${unreachable}</strong> verification${unreachable === 1 ? "" : "s"} could not reach PaySwitch on this sweep. This often means a PaySwitch outage is stranding customer payments.</p><p><a href="${escape(listUrl)}" style="color:#b45309;font-weight:600;">Open the payments queue →</a></p><p style="color:#9ca3af;font-size:12px;margin-top:24px;">You will not receive another email about this today; if payments are still stuck tomorrow you will be alerted again.</p>`,
    ),
  };
}

export function paymentGivenUpEmail(args: {
  saleLabel: string;
  amount: number;
  retryUrl: string;
}): Omit<EmailMessage, "to"> {
  const { saleLabel, amount, retryUrl } = args;
  const amountStr = `GHS ${amount.toFixed(2)}`;
  return {
    subject: `Your AutoCare ${saleLabel} payment was cancelled`,
    text: `Hi,\n\nWe cancelled a payment of ${amountStr} for your ${saleLabel} that was stuck and never completed. No money was taken. You can safely retry the payment whenever you're ready.\n\nRetry your payment: ${retryUrl}\n\n— The AutoCare team`,
    html: wrap(
      `<h2 style="margin:0 0 16px;">Payment cancelled</h2><p>We cancelled a payment of <strong>${escape(amountStr)}</strong> for your <strong>${escape(saleLabel)}</strong> that was stuck and never completed. No money was taken — you can safely retry the payment whenever you're ready.</p><p><a href="${escape(retryUrl)}" style="color:#b45309;font-weight:600;">Retry your payment →</a></p>`,
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
