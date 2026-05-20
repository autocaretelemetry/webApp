import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq, ilike, inArray, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  serviceCentersTable,
  vendorsTable,
  deliveryAgentsTable,
  organizationsTable,
  organizationMembersTable,
  renterProfilesTable,
  approvalEventsTable,
  type ApprovalEventAction,
  type KycDocument,
} from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "../lib/auth";
import {
  sendEmail,
  applicationApprovedEmail,
  applicationRejectedEmail,
  kycVerifiedEmail,
  kycRejectedEmail,
  type EmailMessage,
} from "../lib/email";
import {
  sendWhatsAppText,
  applicationApprovedWhatsApp,
  applicationRejectedWhatsApp,
  kycVerifiedWhatsApp,
  kycRejectedWhatsApp,
} from "../lib/whatsapp";
import { logger } from "../lib/logger";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { scanKycDocument } from "../lib/kycScanner";
import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES } from "./storage";
import type { File } from "@google-cloud/storage";

function fireEmail(to: string | null | undefined, msg: Omit<EmailMessage, "to">): void {
  if (!to) return;
  sendEmail({ to, ...msg }).catch((err) =>
    logger.warn({ err, to }, "onboarding email send threw"),
  );
}

function fireWhatsApp(to: string | null | undefined, body: string): void {
  if (!to) return;
  sendWhatsAppText(to, body).catch((err) =>
    logger.warn({ err, to }, "onboarding whatsapp send threw"),
  );
}

type DecisionKind = "approved" | "rejected" | "kyc_verified" | "kyc_rejected";

function fireDecisionNotifications(
  kind: DecisionKind,
  user: { name: string; email: string | null; phone: string | null; approvalNote: string | null; kycNote: string | null },
): void {
  switch (kind) {
    case "approved":
      fireEmail(user.email, applicationApprovedEmail(user.name, user.approvalNote));
      fireWhatsApp(user.phone, applicationApprovedWhatsApp(user.name, user.approvalNote));
      return;
    case "rejected":
      fireEmail(user.email, applicationRejectedEmail(user.name, user.approvalNote));
      fireWhatsApp(user.phone, applicationRejectedWhatsApp(user.name, user.approvalNote));
      return;
    case "kyc_verified":
      fireEmail(user.email, kycVerifiedEmail(user.name, user.kycNote));
      fireWhatsApp(user.phone, kycVerifiedWhatsApp(user.name, user.kycNote));
      return;
    case "kyc_rejected":
      fireEmail(user.email, kycRejectedEmail(user.name, user.kycNote));
      fireWhatsApp(user.phone, kycRejectedWhatsApp(user.name, user.kycNote));
      return;
  }
}

type EventTx = Tx | typeof db;

async function recordEvent(
  executor: EventTx,
  args: {
    userId: string;
    action: ApprovalEventAction;
    actorUserId?: string | null;
    actorName?: string | null;
    note?: string | null;
    internal?: boolean;
  },
): Promise<void> {
  await executor.insert(approvalEventsTable).values({
    userId: args.userId,
    action: args.action,
    actorUserId: args.actorUserId ?? null,
    actorName: args.actorName ?? null,
    note: args.note?.trim() || null,
    internal: args.internal ?? false,
  });
}

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * Global gate: signed-in users whose KYC is not verified are blocked from the
 * rest of the API until they finish onboarding. Anonymous traffic and a
 * specific whitelist (auth, storage, onboarding itself, super-admin) pass
 * through unchanged so the frontend can complete the funnel.
 */
const KYC_WHITELIST = [
  /^\/auth\//,
  /^\/me\/kyc/,
  /^\/storage\//,
  /^\/healthz/,
  /^\/admin\/approvals/,
  /^\/admin\/kyc/,
  /^\/landing-content/,
];

export function requireKycVerified(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    next();
    return;
  }
  // Admins and super admins are never gated — they need to be able to
  // approve KYC for everyone else.
  if (req.user.role === "admin" || req.user.role === "super_admin") {
    next();
    return;
  }
  if (req.user.kycStatus === "verified") {
    next();
    return;
  }
  const path = req.path;
  if (KYC_WHITELIST.some((rx) => rx.test(path))) {
    next();
    return;
  }
  res.status(403).json({
    error: "Finish KYC to use this feature.",
    reason: req.user.kycStatus ?? "not_submitted",
  });
}

const KycDocSchema = z.object({
  key: z.string().min(1),
  url: z.string().min(1),
  label: z.string().min(1),
});

const KycSubmissionBody = z.object({
  documents: z.array(KycDocSchema).min(1),
});

/**
 * Validate that the URL the client submitted points at an object our storage
 * layer actually issued, and that the stored blob is one of our allowed image
 * types within the configured size cap.
 *
 * Why this matters: the client uploads directly to a presigned GCS URL, so an
 * attacker who already has a session could (a) submit a URL pointing at any
 * arbitrary site we'd happily serve back, or (b) PUT a non-image (PDF, EXE,
 * script) to a presigned slot after telling /storage/uploads/request-url it
 * was a PNG. Re-checking content-type + size against the real GCS metadata
 * closes both holes. We also normalise the URL back to the canonical
 * `/objects/...` form so reviewers never see attacker-controlled query
 * strings or hostnames stored in the user row.
 *
 * VIRUS SCANNING — handled synchronously by `scanKycDocument` (see
 * `lib/kycScanner.ts`) which runs an EICAR signature check + a
 * magic-byte vs declared-MIME check on every uploaded blob. Infected
 * documents are quarantined to a `quarantine/` prefix via
 * `objectStorageService.quarantineObjectEntity` and the user row never
 * gains a reference to them. The scanner is intentionally pluggable: swap
 * the body of `scanKycDocument` for a ClamAV (`clamscan` npm bridge) or
 * hosted (VirusTotal / Cloudmersive) call without touching this route.
 * Defence-in-depth from the storage layer: `/storage/objects/*` sets
 * `X-Content-Type-Options: nosniff` and forces
 * `Content-Disposition: attachment` for anything non-image; the reviewer
 * UI additionally refuses to render any document whose
 * `scanStatus !== 'clean'`.
 */
async function validateKycDocumentUrl(rawUrl: string): Promise<
  | {
      ok: true;
      normalizedUrl: string;
      objectPath: string;
      objectFile: File;
      contentType: string;
    }
  | { ok: false; reason: string }
> {
  // Accept either the canonical `/api/storage/objects/...` form the upload
  // hook produces, or the raw `/objects/...` form. Reject anything else —
  // notably full http(s) URLs to attacker-controlled hosts.
  let objectPath: string;
  if (rawUrl.startsWith("/api/storage/objects/")) {
    objectPath = rawUrl.slice("/api/storage".length);
  } else if (rawUrl.startsWith("/objects/")) {
    objectPath = rawUrl;
  } else {
    return { ok: false, reason: "Document URL is not from our storage layer." };
  }

  let objectFile: File;
  try {
    objectFile = await objectStorageService.getObjectEntityFile(objectPath);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      return { ok: false, reason: "Uploaded document could not be found." };
    }
    throw err;
  }

  const [metadata] = await objectFile.getMetadata();
  const contentType = String(metadata.contentType ?? "").toLowerCase();
  if (!ALLOWED_UPLOAD_MIME.has(contentType)) {
    return {
      ok: false,
      reason: "Document must be a JPG, PNG, or WebP image.",
    };
  }
  const size = Number(metadata.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, reason: "Uploaded document is empty." };
  }
  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "Uploaded document exceeds the 10 MB limit." };
  }

  return {
    ok: true,
    normalizedUrl: `/api/storage${objectPath}`,
    objectPath,
    objectFile,
    contentType,
  };
}

/**
 * POST /me/kyc — the signed-in user uploads their role-specific KYC bundle.
 * Idempotent: re-submitting replaces the stored documents and bumps status
 * back to `submitted` (useful after a rejection).
 */
router.post("/me/kyc", requireAuth, async (req, res): Promise<void> => {
  const parsed = KycSubmissionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (req.user!.approvalStatus !== "approved") {
    res.status(403).json({ error: "Account is not approved yet." });
    return;
  }

  // Validate every submitted URL against the storage layer BEFORE we persist
  // anything. This is the chokepoint that enforces mime/size on the real
  // stored blob (not just whatever the browser advertised) and rejects
  // arbitrary off-platform URLs. Each validated document is then scanned
  // for malware; infected uploads are quarantined immediately and we abort
  // the whole submission so the user row never gains a reference to a
  // dirty file.
  const validated: KycDocument[] = [];
  for (const doc of parsed.data.documents) {
    const result = await validateKycDocumentUrl(doc.url);
    if (!result.ok) {
      res.status(400).json({ error: `${doc.label}: ${result.reason}` });
      return;
    }
    const scan = await scanKycDocument(result.objectFile, result.contentType);
    const checkedAt = new Date().toISOString();
    if (scan.status === "infected") {
      try {
        await objectStorageService.quarantineObjectEntity(result.objectPath);
      } catch (err) {
        req.log.error(
          { err, objectPath: result.objectPath },
          "Failed to quarantine infected KYC upload",
        );
      }
      req.log.warn(
        {
          userId: req.user!.id,
          objectPath: result.objectPath,
          details: scan.details,
        },
        "KYC document failed malware scan",
      );
      res.status(400).json({
        error: `${doc.label}: file flagged by malware scanner and quarantined. Please re-upload a fresh copy.`,
      });
      return;
    }
    if (scan.status === "error") {
      req.log.error(
        { userId: req.user!.id, objectPath: result.objectPath, details: scan.details },
        "KYC malware scan errored",
      );
      res.status(503).json({
        error: `${doc.label}: could not finish security scan. Please try again in a moment.`,
      });
      return;
    }
    validated.push({
      key: doc.key,
      label: doc.label,
      url: result.normalizedUrl,
      scanStatus: "clean",
      scanCheckedAt: checkedAt,
      scanDetails: scan.details,
    });
  }

  const [row] = await db
    .update(usersTable)
    .set({
      kycDocuments: validated,
      kycStatus: "submitted",
      kycNote: null,
    })
    .where(eq(usersTable.id, req.user!.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await recordEvent(db, {
    userId: row.id,
    action: "kyc_submitted",
    actorUserId: row.id,
    actorName: row.name,
  });
  const { passwordHash: _ph, ...safe } = row;
  res.json(safe);
});

/**
 * GET /admin/approvals — list applications by state. `state` defaults to
 * `pending` (sign-up review queue). Use `kyc_pending` for the KYC tab and
 * `all` for the history view.
 */
const APPROVAL_ROLES = [
  "owner",
  "center",
  "vendor",
  "delivery",
  "fleet",
  "renter",
] as const;

router.get("/admin/approvals", requireSuperAdmin, async (req, res): Promise<void> => {
  const state = String(req.query["state"] ?? "pending");
  const role = typeof req.query["role"] === "string" ? req.query["role"] : "";
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const rawLimit = Number(req.query["limit"] ?? 25);
  const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 25));
  const cursor = typeof req.query["cursor"] === "string" ? req.query["cursor"] : "";

  const conditions: SQL[] = [];
  if (state === "pending") {
    conditions.push(eq(usersTable.approvalStatus, "pending"));
  } else if (state === "kyc_pending") {
    conditions.push(eq(usersTable.approvalStatus, "approved"));
    conditions.push(eq(usersTable.kycStatus, "submitted"));
  } else if (state === "rejected") {
    const r = or(
      eq(usersTable.approvalStatus, "rejected"),
      eq(usersTable.kycStatus, "rejected"),
    );
    if (r) conditions.push(r);
  } else {
    conditions.push(
      inArray(usersTable.approvalStatus, ["pending", "approved", "rejected"]),
    );
  }
  if (role && (APPROVAL_ROLES as readonly string[]).includes(role)) {
    conditions.push(eq(usersTable.requestedRole, role));
  }
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const search = or(
      ilike(usersTable.name, pattern),
      ilike(usersTable.email, pattern),
      ilike(usersTable.phone, pattern),
    );
    if (search) conditions.push(search);
  }
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      const [iso, id] = decoded.split("|");
      if (iso && id) {
        const ts = new Date(iso);
        if (!Number.isNaN(ts.getTime())) {
          const after = or(
            lt(usersTable.createdAt, ts),
            and(eq(usersTable.createdAt, ts), lt(usersTable.id, id)),
          );
          if (after) conditions.push(after);
        }
      }
    } catch {
      // ignore malformed cursor — start from top
    }
  }

  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await db
    .select()
    .from(usersTable)
    .where(where)
    .orderBy(desc(usersTable.createdAt), desc(usersTable.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`, "utf8").toString(
          "base64url",
        )
      : null;

  res.json({
    items: page.map((r) => {
      const { passwordHash: _ph, ...safe } = r;
      return safe;
    }),
    nextCursor,
  });
});

const ApprovalDecisionBody = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().nullish(),
});

/**
 * PATCH /admin/approvals/:userId — super admin approves or rejects an
 * application. On approval we create the matching domain record so the user
 * lands somewhere meaningful after their next sign-in.
 */
router.patch(
  "/admin/approvals/:userId",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const parsed = ApprovalDecisionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const userId = String(req.params["userId"]);
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (target.approvalStatus !== "pending") {
      res.status(409).json({ error: "Application is not pending." });
      return;
    }
    if (parsed.data.decision === "reject") {
      const [row] = await db
        .update(usersTable)
        .set({
          approvalStatus: "rejected",
          approvalNote: parsed.data.note?.trim() || null,
        })
        .where(eq(usersTable.id, userId))
        .returning();
      await recordEvent(db, {
        userId,
        action: "rejected",
        actorUserId: req.user!.id,
        actorName: req.user!.name,
        note: parsed.data.note ?? null,
      });
      const { passwordHash: _ph, ...safe } = row!;
      fireDecisionNotifications("rejected", row!);
      res.json(safe);
      return;
    }
    // Approve — provision role-specific shell record AND flip status inside a
    // single transaction so two simultaneous approvers can't double-provision
    // and a partial provision can't leave the user "approved" but without
    // their org/center row. The status flip re-checks `pending` so the second
    // tx is a no-op.
    let updated: typeof target | undefined;
    try {
      await db.transaction(async (tx) => {
        const [stillPending] = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(
            and(eq(usersTable.id, userId), eq(usersTable.approvalStatus, "pending")),
          );
        if (!stillPending) {
          throw new Error("already_decided");
        }
        await provisionRoleRecord(tx, target);
        const [row] = await tx
          .update(usersTable)
          .set({
            approvalStatus: "approved",
            approvalNote: parsed.data.note?.trim() || null,
            kycStatus: "not_submitted",
          })
          .where(eq(usersTable.id, userId))
          .returning();
        updated = row;
        await recordEvent(tx, {
          userId,
          action: "approved",
          actorUserId: req.user!.id,
          actorName: req.user!.name,
          note: parsed.data.note ?? null,
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === "already_decided") {
        res.status(409).json({ error: "Application is not pending." });
        return;
      }
      throw err;
    }
    const { passwordHash: _ph, ...safe } = updated!;
    fireDecisionNotifications("approved", updated!);
    res.json(safe);
  },
);

const RESEND_COOLDOWN_MS = 60_000;
const lastResendAt = new Map<string, number>();

type ResendKind = "approved" | "rejected" | "kyc_verified" | "kyc_rejected";

function resolveResendKind(
  user: typeof usersTable.$inferSelect,
): ResendKind | null {
  if (user.kycStatus === "verified") return "kyc_verified";
  if (user.kycStatus === "rejected") return "kyc_rejected";
  if (user.approvalStatus === "rejected") return "rejected";
  if (user.approvalStatus === "approved") return "approved";
  return null;
}

/**
 * POST /admin/approvals/:userId/resend-email — re-fire the decision email
 * matching the user's current approval/KYC state. Useful when the applicant
 * lost or filtered the original message. Rate-limited per user (in-memory)
 * to prevent accidental spamming; the action is super-admin-only and very
 * low volume so a process-local map is sufficient.
 */
router.post(
  "/admin/approvals/:userId/resend-email",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const userId = String(req.params["userId"]);
    const [target] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!target.email) {
      res.status(400).json({ error: "User has no email on file." });
      return;
    }
    const kind = resolveResendKind(target);
    if (!kind) {
      res.status(409).json({ error: "No decision has been made yet." });
      return;
    }
    const now = Date.now();
    const prev = lastResendAt.get(userId);
    if (prev && now - prev < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (now - prev)) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: `Please wait ${retryAfter}s before resending.`,
        retryAfter,
      });
      return;
    }
    lastResendAt.set(userId, now);
    const msg =
      kind === "approved"
        ? applicationApprovedEmail(target.name, target.approvalNote)
        : kind === "rejected"
          ? applicationRejectedEmail(target.name, target.approvalNote)
          : kind === "kyc_verified"
            ? kycVerifiedEmail(target.name, target.kycNote)
            : kycRejectedEmail(target.name, target.kycNote);
    const result = await sendEmail({ to: target.email, ...msg });
    res.json({ kind, sent: result.ok, reason: result.reason ?? null });
  },
);

const KycDecisionBody = z.object({
  decision: z.enum(["verify", "reject"]),
  note: z.string().nullish(),
});

router.patch(
  "/admin/kyc/:userId",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const parsed = KycDecisionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const userId = String(req.params["userId"]);
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (target.kycStatus !== "submitted") {
      res.status(409).json({ error: "No KYC submission to review." });
      return;
    }
    const [row] = await db
      .update(usersTable)
      .set({
        kycStatus: parsed.data.decision === "verify" ? "verified" : "rejected",
        kycNote: parsed.data.note?.trim() || null,
      })
      .where(eq(usersTable.id, userId))
      .returning();
    await recordEvent(db, {
      userId,
      action: parsed.data.decision === "verify" ? "kyc_verified" : "kyc_rejected",
      actorUserId: req.user!.id,
      actorName: req.user!.name,
      note: parsed.data.note ?? null,
    });
    const { passwordHash: _ph, ...safe } = row!;
    fireDecisionNotifications(
      parsed.data.decision === "verify" ? "kyc_verified" : "kyc_rejected",
      row!,
    );
    res.json(safe);
  },
);

/**
 * GET /me/approval-events — the signed-in user's own audit trail with
 * internal staff notes filtered out. Powers the timeline on the onboarding
 * KYC + rejected screens so applicants can see their own decision history.
 */
router.get("/me/approval-events", requireAuth, async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(approvalEventsTable)
    .where(
      and(
        eq(approvalEventsTable.userId, req.user!.id),
        eq(approvalEventsTable.internal, false),
      ),
    )
    .orderBy(approvalEventsTable.createdAt);
  res.json(rows);
});

/**
 * GET /admin/approvals/:userId/events — full chronological audit trail for an
 * applicant. Returns both the public state transitions and any internal-only
 * notes left by staff.
 */
router.get(
  "/admin/approvals/:userId/events",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const userId = String(req.params["userId"]);
    const rows = await db
      .select()
      .from(approvalEventsTable)
      .where(eq(approvalEventsTable.userId, userId))
      .orderBy(approvalEventsTable.createdAt);
    res.json(rows);
  },
);

const InternalNoteBody = z.object({
  note: z.string().trim().min(1),
});

/**
 * POST /admin/approvals/:userId/notes — staff leave an internal-only note on
 * an applicant's audit trail. Not surfaced to the applicant.
 */
router.post(
  "/admin/approvals/:userId/notes",
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const parsed = InternalNoteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const userId = String(req.params["userId"]);
    const [target] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await recordEvent(db, {
      userId,
      action: "note",
      actorUserId: req.user!.id,
      actorName: req.user!.name,
      note: parsed.data.note,
      internal: true,
    });
    const [row] = await db
      .select()
      .from(approvalEventsTable)
      .where(eq(approvalEventsTable.userId, userId))
      .orderBy(desc(approvalEventsTable.createdAt))
      .limit(1);
    res.status(201).json(row);
  },
);

type UserRow = typeof usersTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Create the directory record that matches the applicant's requested role so
 * they have somewhere to land after first sign-in. Runs inside the approval
 * transaction so a provisioning failure rolls the user back to `pending`
 * (rather than leaving them approved with no org/center row).
 */
async function provisionRoleRecord(tx: Tx, target: UserRow): Promise<void> {
  const phone = target.phone ?? "";
  const data = (target.applicantData ?? {}) as Record<string, unknown>;
  const str = (k: string): string =>
    typeof data[k] === "string" ? (data[k] as string).trim() : "";
  switch (target.requestedRole) {
      case "center": {
        await tx.insert(serviceCentersTable).values({
          name: str("businessName") || target.name,
          address: str("address") || "TBD",
          city: str("city") || "TBD",
          phone: phone || "TBD",
          specialties: str("specialty") ? [str("specialty")] : [],
        });
        break;
      }
      case "vendor": {
        await tx.insert(vendorsTable).values({
          name: str("businessName") || target.name,
          address: str("address") || "TBD",
          phone: phone || "TBD",
          city: str("city") || "TBD",
          region: str("region") || "TBD",
        });
        break;
      }
      case "delivery": {
        await tx.insert(deliveryAgentsTable).values({
          name: target.name,
          phone: phone || "TBD",
          city: str("city") || "TBD",
          region: str("region") || "TBD",
          vehicleType: str("vehicleType") || "motorbike",
        });
        break;
      }
      case "fleet": {
        const slug = `${(str("orgName") || target.name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
        const [org] = await tx
          .insert(organizationsTable)
          .values({
            name: str("orgName") || target.name,
            slug,
            industry: str("industry") || null,
            contactName: target.name,
            contactPhone: phone || "TBD",
            contactEmail: target.email,
            city: str("city") || null,
            region: str("region") || null,
            kycStatus: "pending",
          })
          .returning();
        if (org && phone) {
          await tx.insert(organizationMembersTable).values({
            organizationId: org.id,
            phone,
            name: target.name,
            role: "admin",
          });
        }
        break;
      }
      case "renter": {
        if (phone) {
          await tx
            .insert(renterProfilesTable)
            .values({
              name: target.name,
              phone,
              email: target.email,
            })
            .onConflictDoNothing();
        }
        break;
      }
    case "owner":
    default:
      // Owners need no extra row — vehicles attach to them by phone.
      break;
  }
}

export default router;
