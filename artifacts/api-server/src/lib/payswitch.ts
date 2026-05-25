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

export interface StatusCheckResult {
  /**
   * True only when the provider responded AND reports a settled, successful
   * charge (code "000" + status "approved"/"successful"). False for both
   * verified-not-paid AND for "we couldn't reach the provider" — callers
   * must inspect `reachable` to tell them apart.
   */
  ok: boolean;
  /**
   * Whether we successfully heard back from the provider at all. False when
   * the network call threw or the provider returned a non-2xx HTTP response;
   * in that case the txn must be left pending, NOT marked failed.
   */
  reachable: boolean;
  /** Provider status code (e.g. "000" on success). */
  code: string;
  /** Lowercased provider status ("approved" / "successful" / "pending" / "failed" / ...). */
  status: string;
  reason: string;
  /** Verified amount in pesewas as reported by the provider, if present. */
  amountPesewas: number | null;
  raw: unknown;
}

/**
 * Server-to-server transaction status check. The browser-side callback is
 * untrusted (any authenticated caller could forge a `code=000&status=successful`
 * query string against the public callback URL), so before we settle a sale
 * we re-fetch the canonical status from PaySwitch with our merchant
 * credentials. TheTeller endpoint:
 *   GET /v1.1/users/transactions/{transaction_id}/status
 * Returns `{ status: "approved", code: "000", ... }` for a real settlement.
 * Authenticated with the same Basic credentials used for /checkout/initiate,
 * plus the `Merchant-Id` header.
 */
export async function checkTransactionStatus(
  transactionId: string,
): Promise<StatusCheckResult> {
  const { merchantId, apiUser, apiKey } = requireCreds();
  const base = payswitchEnv() === "live" ? LIVE_BASE : TEST_BASE;
  const auth = Buffer.from(`${apiUser}:${apiKey}`).toString("base64");
  let resp: Response;
  try {
    resp = await fetch(
      `${base}/v1.1/users/transactions/${encodeURIComponent(transactionId)}/status`,
      {
        method: "GET",
        headers: {
          "Cache-Control": "no-cache",
          Accept: "application/json",
          "Merchant-Id": merchantId,
          Authorization: `Basic ${auth}`,
        },
      },
    );
  } catch (err) {
    logger.error({ err, transactionId }, "payswitch status fetch failed");
    return {
      ok: false,
      reachable: false,
      code: "",
      status: "network_error",
      reason: String(err),
      amountPesewas: null,
      raw: null,
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
    logger.warn(
      { status: resp.status, body: text, transactionId },
      "payswitch status non-2xx",
    );
    return {
      ok: false,
      reachable: false,
      code: "",
      status: `http_${resp.status}`,
      reason: `Provider returned ${resp.status}`,
      amountPesewas: null,
      raw: json ?? text,
    };
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  const code = typeof obj["code"] === "string" ? (obj["code"] as string) : "";
  const rawStatus =
    typeof obj["status"] === "string" ? (obj["status"] as string).toLowerCase() : "";
  const reason =
    (typeof obj["reason"] === "string" && (obj["reason"] as string)) ||
    (typeof obj["message"] === "string" && (obj["message"] as string)) ||
    "";
  const amountRaw = obj["amount"];
  let amountPesewas: number | null = null;
  if (typeof amountRaw === "number" && Number.isFinite(amountRaw)) {
    amountPesewas = Math.round(amountRaw);
  } else if (typeof amountRaw === "string" && amountRaw.trim() !== "") {
    const n = Number(amountRaw);
    if (Number.isFinite(n)) amountPesewas = Math.round(n);
  }
  // TheTeller marks a settled charge with code "000" and status one of
  // "approved" | "successful". Anything else is non-success.
  const success =
    code === "000" && (rawStatus === "approved" || rawStatus === "successful");
  return {
    ok: success,
    reachable: true,
    code,
    status: rawStatus,
    reason,
    amountPesewas,
    raw: json,
  };
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
