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

export function appPublicUrl(path: string): string {
  const domains = process.env["REPLIT_DOMAINS"];
  const host = domains ? domains.split(",")[0] : "localhost:5000";
  const proto = domains ? "https" : "http";
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${proto}://${host}${p}`;
}
