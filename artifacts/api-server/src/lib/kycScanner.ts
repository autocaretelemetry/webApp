import type { File } from "@google-cloud/storage";
import { Readable } from "node:stream";
import NodeClam from "clamscan";
import { logger } from "./logger";

/**
 * Malware scan result for a single KYC document. The scanner is invoked
 * synchronously from `POST /me/kyc`; an `infected` result triggers an
 * immediate quarantine + 400 to the applicant, and an `error` result is
 * surfaced as a soft failure (the document is NOT persisted because the
 * reviewer UI refuses anything other than `clean`).
 */
export type ScanResult =
  | { status: "clean"; details: string }
  | { status: "infected"; details: string }
  | { status: "error"; details: string };

/**
 * EICAR test signature — the standardised harmless string every real AV
 * engine recognises as a virus. We keep a literal check in the fallback
 * path so the wiring stays verifiable even when ClamAV isn't configured,
 * and so unit tests can prove the route ever rejects anything.
 */
const EICAR_SIGNATURE =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** First-bytes magic numbers for the MIME types we accept on KYC uploads. */
const IMAGE_MAGIC: Array<{ mime: string; matches: (b: Buffer) => boolean }> = [
  {
    mime: "image/jpeg",
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: "image/webp",
    matches: (b) =>
      b.length >= 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
];

async function readAll(file: File): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    file
      .createReadStream()
      .on("data", (c: Buffer) => chunks.push(c))
      .on("end", () => resolve())
      .on("error", reject);
  });
  return Buffer.concat(chunks);
}

/**
 * Magic-byte / declared-MIME consistency check. Defeats the obvious
 * "rename payload.exe to photo.png and lie about the content type" attack
 * — GCS only knows what the uploader advertised, this is where we look at
 * the real header bytes. Used both as the local fallback when ClamAV is
 * unavailable AND as a pre-check before every ClamAV scan, since neither
 * engine alone covers the other's blind spot.
 */
function magicByteCheck(body: Buffer, declaredContentType: string): ScanResult {
  if (body.includes(EICAR_SIGNATURE)) {
    return { status: "infected", details: "EICAR test signature detected." };
  }
  const declared = declaredContentType.toLowerCase();
  const spec = IMAGE_MAGIC.find((m) => m.mime === declared);
  if (!spec) {
    return {
      status: "infected",
      details: `Declared content type ${declared} is not an allowed image type.`,
    };
  }
  if (!spec.matches(body)) {
    return {
      status: "infected",
      details: `File bytes do not match declared content type ${declared}.`,
    };
  }
  return { status: "clean", details: "Passed magic-byte check." };
}

/**
 * Lazy-initialised ClamAV client. The handshake (TCP / UNIX socket ping to
 * clamd) is expensive enough that we cache the instance for the process
 * lifetime. We never throw out of init — a failed init returns `null` and
 * the scanner reverts to fail-closed behaviour if a clamd was configured
 * (env present + unreachable = error), or to the local heuristic if no
 * clamd was configured at all.
 */
type ClamSettings = {
  host?: string;
  port?: number;
  socket?: string;
  timeoutMs: number;
  tls: boolean;
};

function readClamConfig(): ClamSettings | null {
  const host = process.env["CLAMAV_HOST"];
  const port = process.env["CLAMAV_PORT"];
  const socket = process.env["CLAMAV_SOCKET"];
  if (!host && !socket) return null;
  const parsedPort = port ? Number.parseInt(port, 10) : 3310;
  return {
    host: host || undefined,
    port: Number.isFinite(parsedPort) ? parsedPort : 3310,
    socket: socket || undefined,
    timeoutMs: Number.parseInt(process.env["CLAMAV_TIMEOUT_MS"] ?? "60000", 10),
    tls: process.env["CLAMAV_TLS"] === "true",
  };
}

/**
 * Three possible scanner states. We deliberately separate
 * `not_configured` (operator hasn't wired up ClamAV — heuristic-only
 * is acceptable) from `configured_unavailable` (operator DID wire it
 * up but the daemon is unreachable — must fail closed). Conflating
 * the two would silently downgrade production to heuristic-only the
 * moment clamd hiccups.
 */
type ScannerState =
  | { kind: "not_configured" }
  | { kind: "ready"; clam: NodeClam }
  | { kind: "unavailable"; error: Error };

let scannerPromise: Promise<ScannerState> | null = null;
let warnedNoClam = false;

async function getScannerState(): Promise<ScannerState> {
  const cfg = readClamConfig();
  if (!cfg) {
    if (!warnedNoClam) {
      warnedNoClam = true;
      logger.warn(
        "CLAMAV_HOST / CLAMAV_SOCKET not configured — KYC uploads will only get the local magic-byte heuristic. Set CLAMAV_HOST + CLAMAV_PORT (or CLAMAV_SOCKET) to enable real virus scanning.",
      );
    }
    return { kind: "not_configured" };
  }
  if (!scannerPromise) {
    scannerPromise = new NodeClam()
      .init({
        clamdscan: {
          host: cfg.host ?? false,
          port: cfg.port ?? false,
          socket: cfg.socket ?? false,
          timeout: cfg.timeoutMs,
          tls: cfg.tls,
          localFallback: false,
          bypassTest: false,
        },
        preference: "clamdscan",
      })
      .then<ScannerState>((scanner) => {
        logger.info(
          { host: cfg.host, port: cfg.port, socket: cfg.socket },
          "ClamAV scanner ready for KYC uploads",
        );
        return { kind: "ready", clam: scanner };
      })
      .catch<ScannerState>((err: Error) => {
        logger.error({ err }, "Failed to initialise ClamAV scanner");
        // Reset so the next request retries the handshake instead of
        // permanently sticking on a transient init failure — but
        // surface this attempt as `unavailable` so the in-flight scan
        // fails closed.
        scannerPromise = null;
        return { kind: "unavailable", error: err };
      });
  }
  return scannerPromise;
}

function bufferToStream(body: Buffer): Readable {
  // Wrap in a brand new Readable per call — clamscan consumes the stream
  // and we cannot rewind it for a retry otherwise.
  return Readable.from(body);
}

/**
 * Scan a freshly uploaded KYC document. When ClamAV is configured
 * (CLAMAV_HOST + CLAMAV_PORT, or CLAMAV_SOCKET), every document is
 * streamed through clamd and the verdict is mapped to our `ScanResult`
 * shape. When ClamAV is unreachable we fail closed (`error`) — the route
 * surfaces a 503 so the applicant retries instead of slipping through.
 *
 * When ClamAV is NOT configured we fall back to a local heuristic
 * (EICAR string + image magic-byte / declared-MIME consistency). The
 * heuristic still runs even when ClamAV is configured, because clamd by
 * default would not catch "renamed payload.exe with image/png content
 * type" — its job is malware signatures, not container sanity.
 *
 * The contract intentionally matches what a swap-in VirusTotal /
 * Cloudmersive client would return: callers only inspect `status` +
 * `details`, never the underlying engine.
 */
export async function scanKycDocument(
  file: File,
  declaredContentType: string,
): Promise<ScanResult> {
  let body: Buffer;
  try {
    body = await readAll(file);
  } catch (err) {
    return {
      status: "error",
      details: `Could not read object for scanning: ${(err as Error).message}`,
    };
  }

  // Always run the magic-byte / EICAR check first. It's cheap, covers
  // payload-rename attacks that ClamAV wouldn't catch, and gives us a
  // deterministic verdict for the EICAR test fixture even before we know
  // whether ClamAV is wired up.
  const heuristic = magicByteCheck(body, declaredContentType);
  if (heuristic.status === "infected") return heuristic;

  const state = await getScannerState();
  if (state.kind === "not_configured") {
    // No ClamAV wired up. The heuristic verdict (already `clean` at
    // this point) is the best we have. We deliberately do NOT
    // fail-closed here because the operator opted not to wire up a
    // real engine — onboarding has to keep working in dev / on Replit
    // where running clamd in the sandbox is impractical.
    return heuristic;
  }
  if (state.kind === "unavailable") {
    // Operator DID configure ClamAV but the daemon is unreachable.
    // Fail closed — we never silently downgrade a production-configured
    // pipeline to heuristic-only just because clamd hiccuped. The route
    // surfaces this as a 503 so the applicant retries.
    return {
      status: "error",
      details: `ClamAV unavailable: ${state.error.message}`,
    };
  }

  try {
    const { isInfected, viruses } = await state.clam.scanStream(bufferToStream(body));
    if (isInfected) {
      return {
        status: "infected",
        details: `ClamAV flagged: ${(viruses ?? []).join(", ") || "unknown signature"}`,
      };
    }
    return {
      status: "clean",
      details: "Passed ClamAV scan + magic-byte check.",
    };
  } catch (err) {
    // ClamAV was reachable at init but the scan itself failed (daemon
    // dropped mid-request, socket timed out, etc). Fail closed — we
    // never want to flip a doc to `clean` based on a scan we couldn't
    // actually complete.
    return {
      status: "error",
      details: `ClamAV scan failed: ${(err as Error).message}`,
    };
  }
}

/** Test hook: clears the cached clamd handshake so tests can re-init. */
export function __resetScannerForTests(): void {
  scannerPromise = null;
  warnedNoClam = false;
}
