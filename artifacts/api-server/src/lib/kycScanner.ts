import type { File } from "@google-cloud/storage";

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
 * engine recognises as a virus. We include it so the scanner is verifiable
 * end-to-end without needing a live malware sample, and so the wiring keeps
 * working if/when we swap the implementation for ClamAV.
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
 * Scan a freshly uploaded KYC document. The default implementation runs two
 * checks that catch the two most common abuse paths against an image-only
 * upload surface:
 *
 *   1. **EICAR signature** — the universal AV test string. Anything carrying
 *      it (and, by extension, anything a swap-in ClamAV/VirusTotal scanner
 *      would detect) is treated as infected so the wiring is verifiable.
 *   2. **Magic-byte vs declared MIME** — defeats "rename payload.exe to
 *      photo.png and lie about the content type" attacks. GCS only knows
 *      the content-type the uploader advertised; this is where we look at
 *      the actual file header.
 *
 * The signature is intentionally trivial to extend: replace the body of
 * `scanKycDocument` with a call to `clamscan`, VirusTotal, or Cloudmersive
 * when those are wired up — callers only care about the `ScanResult` shape.
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

  // EICAR can appear anywhere in the file — a real AV would also pattern-
  // match. Cheap substring search is sufficient for the harmless test
  // signature.
  if (body.includes(EICAR_SIGNATURE)) {
    return {
      status: "infected",
      details: "EICAR test signature detected.",
    };
  }

  const declared = declaredContentType.toLowerCase();
  const spec = IMAGE_MAGIC.find((m) => m.mime === declared);
  if (!spec) {
    // The KYC route only forwards already-allowlisted content types, so
    // hitting this branch means the metadata changed between validate-url
    // and the scan — treat as infected to be safe.
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

  return { status: "clean", details: "Passed signature + magic-byte checks." };
}
