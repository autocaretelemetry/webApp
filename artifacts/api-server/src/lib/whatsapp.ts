import { logger } from "./logger";

const META_GRAPH_VERSION = "v20.0";

function envOk() {
  return Boolean(
    process.env["WHATSAPP_ACCESS_TOKEN"] &&
      process.env["WHATSAPP_PHONE_NUMBER_ID"],
  );
}

function normalizePhone(raw: string): string {
  // Meta expects E.164 digits only (no '+', no spaces).
  return raw.replace(/[^\d]/g, "");
}

export async function sendWhatsAppText(
  toPhoneE164: string,
  body: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!envOk()) {
    logger.info(
      { to: toPhoneE164 },
      "WhatsApp credentials not configured; skipping send",
    );
    return { ok: false, reason: "not_configured" };
  }
  const to = normalizePhone(toPhoneE164);
  if (!to) return { ok: false, reason: "invalid_phone" };

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${process.env["WHATSAPP_PHONE_NUMBER_ID"]}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env["WHATSAPP_ACCESS_TOKEN"]}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: true, body },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn(
        { status: res.status, response: text, to },
        "WhatsApp send failed",
      );
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err, to }, "WhatsApp send threw");
    return { ok: false, reason: "exception" };
  }
}

function noteLine(note: string | null | undefined): string {
  if (!note || !note.trim()) return "";
  return `\n\nReviewer note: ${note.trim()}`;
}

export function signupVerificationWhatsApp(
  name: string,
  code: string,
  expiresMinutes: number,
): string {
  return `Hi ${name}, your AutoCare verification code is ${code}. It expires in ${expiresMinutes} minutes. Enter it on the signup page to confirm this WhatsApp number. If you didn't apply for an AutoCare account, you can ignore this message.`;
}

export function applicationApprovedWhatsApp(
  name: string,
  note: string | null | undefined,
): string {
  return `Hi ${name}, good news — your AutoCare application has been approved. Sign in to submit your KYC documents and unlock the platform.${noteLine(note)}\n\n— AutoCare`;
}

export function applicationRejectedWhatsApp(
  name: string,
  note: string | null | undefined,
): string {
  return `Hi ${name}, thank you for applying to AutoCare. After review we are unable to approve your application at this time.${noteLine(note)}\n\nYou are welcome to reach out or apply again with updated information.\n\n— AutoCare`;
}

export function kycVerifiedWhatsApp(
  name: string,
  note: string | null | undefined,
): string {
  return `Hi ${name}, your AutoCare KYC documents have been verified. You now have full access — sign in to get started.${noteLine(note)}\n\n— AutoCare`;
}

export function kycRejectedWhatsApp(
  name: string,
  note: string | null | undefined,
): string {
  return `Hi ${name}, we reviewed your AutoCare KYC submission and need you to resubmit. Sign in and visit the KYC page to upload corrected documents.${noteLine(note)}\n\n— AutoCare`;
}

export function appPublicUrl(path: string): string {
  const domains = process.env["REPLIT_DOMAINS"];
  const host = domains ? domains.split(",")[0] : "localhost:5000";
  const proto = domains ? "https" : "http";
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${proto}://${host}${p}`;
}
