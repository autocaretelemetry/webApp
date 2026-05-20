import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
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
import { logger } from "../lib/logger";

function fireEmail(to: string | null | undefined, msg: Omit<EmailMessage, "to">): void {
  if (!to) return;
  sendEmail({ to, ...msg }).catch((err) =>
    logger.warn({ err, to }, "onboarding email send threw"),
  );
}

const router: IRouter = Router();

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
  const [row] = await db
    .update(usersTable)
    .set({
      kycDocuments: parsed.data.documents as KycDocument[],
      kycStatus: "submitted",
      kycNote: null,
    })
    .where(eq(usersTable.id, req.user!.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const { passwordHash: _ph, ...safe } = row;
  res.json(safe);
});

/**
 * GET /admin/approvals — list applications by state. `state` defaults to
 * `pending` (sign-up review queue). Use `kyc_pending` for the KYC tab and
 * `all` for the history view.
 */
router.get("/admin/approvals", requireSuperAdmin, async (req, res): Promise<void> => {
  const state = String(req.query["state"] ?? "pending");
  let where;
  if (state === "pending") {
    where = eq(usersTable.approvalStatus, "pending");
  } else if (state === "kyc_pending") {
    where = and(
      eq(usersTable.approvalStatus, "approved"),
      eq(usersTable.kycStatus, "submitted"),
    );
  } else if (state === "rejected") {
    where = or(
      eq(usersTable.approvalStatus, "rejected"),
      eq(usersTable.kycStatus, "rejected"),
    );
  } else {
    where = inArray(usersTable.approvalStatus, ["pending", "approved", "rejected"]);
  }
  const rows = await db
    .select()
    .from(usersTable)
    .where(where)
    .orderBy(desc(usersTable.createdAt));
  res.json(
    rows.map((r) => {
      const { passwordHash: _ph, ...safe } = r;
      return safe;
    }),
  );
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
      const { passwordHash: _ph, ...safe } = row!;
      fireEmail(
        row!.email,
        applicationRejectedEmail(row!.name, row!.approvalNote),
      );
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
      });
    } catch (err) {
      if (err instanceof Error && err.message === "already_decided") {
        res.status(409).json({ error: "Application is not pending." });
        return;
      }
      throw err;
    }
    const { passwordHash: _ph, ...safe } = updated!;
    fireEmail(
      updated!.email,
      applicationApprovedEmail(updated!.name, updated!.approvalNote),
    );
    res.json(safe);
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
    const { passwordHash: _ph, ...safe } = row!;
    fireEmail(
      row!.email,
      parsed.data.decision === "verify"
        ? kycVerifiedEmail(row!.name, row!.kycNote)
        : kycRejectedEmail(row!.name, row!.kycNote),
    );
    res.json(safe);
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
