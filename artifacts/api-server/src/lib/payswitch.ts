import { randomBytes } from "node:crypto";
import { logger } from "./logger";

const TEST_BASE = "https://test.theteller.net";
const LIVE_BASE = "https://checkout.theteller.net";

export function payswitchEnv(): "test" | "live" {
  const v = (process.env["PAYSWITCH_ENV"] ?? "test").toLowerCase();
  return v === "live" || v === "production" ? "live" : "test";
}

export function payswitchConfigured(): boolean {
  return Boolean(
    process.env["PAYSWITCH_MERCHANT_ID"] &&
      process.env["PAYSWITCH_API_USER"] &&
      process.env["PAYSWITCH_API_KEY"],
  );
}

function requireCreds(): {
  merchantId: string;
  apiUser: string;
  apiKey: string;
} {
  const merchantId = process.env["PAYSWITCH_MERCHANT_ID"];
  const apiUser = process.env["PAYSWITCH_API_USER"];
  const apiKey = process.env["PAYSWITCH_API_KEY"];
  if (!merchantId || !apiUser || !apiKey) {
    throw new Error("PaySwitch credentials not configured");
  }
  return { merchantId, apiUser, apiKey };
}

/**
 * TheTeller requires a 12-digit numeric transaction id, unique per call.
 * We compose: 9 digits from the high-resolution time + 3 random digits, then
 * trim to the trailing 12 characters so we never exceed the length.
 */
export function generateTxnId(): string {
  const t = Date.now().toString();
  const r = randomBytes(3).readUIntBE(0, 3).toString().padStart(8, "0");
  return (t + r).slice(-12);
}

/**
 * TheTeller `amount` is a 12-digit zero-padded integer in pesewas
 * (1 GHS = 100 pesewas). We accept pesewas as a plain integer.
 */
export function formatAmountPesewas(pesewas: number): string {
  if (!Number.isFinite(pesewas) || pesewas < 1) {
    throw new Error("Amount must be a positive integer in pesewas");
  }
  return Math.round(pesewas).toString().padStart(12, "0");
}

export interface InitiateInput {
  amountPesewas: number;
  transactionId: string;
  description: string;
  email: string;
  redirectUrl: string;
  customerName?: string;
}

export interface InitiateResult {
  ok: true;
  checkoutUrl: string;
  raw: unknown;
}

export interface InitiateError {
  ok: false;
  status: number;
  reason: string;
  raw: unknown;
}

/**
 * Call TheTeller `/checkout/initiate`. Returns the URL the browser must be
 * redirected to in order to complete payment.
 */
export async function initiateCheckout(
  input: InitiateInput,
): Promise<InitiateResult | InitiateError> {
  const { merchantId, apiUser, apiKey } = requireCreds();
  const base = payswitchEnv() === "live" ? LIVE_BASE : TEST_BASE;
  const auth = Buffer.from(`${apiUser}:${apiKey}`).toString("base64");
  const body = {
    merchant_id: merchantId,
    transaction_id: input.transactionId,
    desc: input.description.slice(0, 100),
    amount: formatAmountPesewas(input.amountPesewas),
    redirect_url: input.redirectUrl,
    email: input.email,
    ...(input.customerName ? { customer_name: input.customerName } : {}),
  };
  let resp: Response;
  try {
    resp = await fetch(`${base}/checkout/initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logger.error({ err }, "payswitch initiate fetch failed");
    return {
      ok: false,
      status: 0,
      reason: "Could not reach payment provider",
      raw: { error: String(err) },
    };
  }
  const text = await resp.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // leave json null
  }
  if (!resp.ok) {
    logger.warn({ status: resp.status, body: text }, "payswitch initiate non-2xx");
    return {
      ok: false,
      status: resp.status,
      reason: `Payment provider returned ${resp.status}`,
      raw: json ?? text,
    };
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  const url =
    (typeof obj["checkout_url"] === "string" && obj["checkout_url"]) ||
    (typeof obj["url"] === "string" && (obj["url"] as string)) ||
    null;
  if (!url) {
    logger.warn({ body: json }, "payswitch initiate response missing checkout_url");
    return {
      ok: false,
      status: 502,
      reason: "Provider did not return a checkout URL",
      raw: json,
    };
  }
  return { ok: true, checkoutUrl: url, raw: json };
}

/**
 * Build the publicly-reachable origin for redirect URLs. Falls back to the
 * Replit dev domain when running on the workspace; in published deployments
 * `REPLIT_DOMAINS` is the comma-separated list of bound domains.
 */
export function publicOrigin(): string {
  const explicit = process.env["PUBLIC_BASE_URL"];
  if (explicit) return explicit.replace(/\/$/, "");
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }
  const dev = process.env["REPLIT_DEV_DOMAIN"];
  if (dev) return `https://${dev}`;
  return "http://localhost:5000";
}
