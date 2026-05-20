import { Router, type IRouter } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { createHash, randomInt } from "node:crypto";
import {
  db,
  usersTable,
  approvalEventsTable,
  type PendingVerifications,
  type PendingVerificationEntry,
  type NotificationChannel,
} from "@workspace/db";
import {
  LoginBody,
  SignupBody,
  UpdateMyProfileBody,
  ChangePasswordBody,
  VerifySignupCodeBody,
  ResendSignupVerificationBody,
} from "@workspace/api-zod";
import {
  verifyPassword,
  hashPassword,
  issueSessionCookie,
  clearSessionCookie,
  requireAuth,
  toAuthedUser,
} from "../lib/auth";
import { sendEmail, signupVerificationEmail } from "../lib/email";
import { sendWhatsAppText, signupVerificationWhatsApp } from "../lib/whatsapp";
import { logger } from "../lib/logger";

// One-time signup verification codes are short-lived and the resend
// cooldown matches the decision-email resend (60s) so applicants can't
// trivially be used to spam an arbitrary inbox.
const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
const VERIFICATION_CODE_TTL_MINUTES = Math.round(
  VERIFICATION_CODE_TTL_MS / 60_000,
);
const VERIFICATION_RESEND_COOLDOWN_MS = 60_000;
const VERIFICATION_MAX_ATTEMPTS = 5;

function generateCode(): string {
  // 6-digit numeric, zero-padded. randomInt is cryptographically random.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function buildPendingEntry(code: string): PendingVerificationEntry {
  const now = new Date();
  return {
    codeHash: hashCode(code),
    expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS).toISOString(),
    lastSentAt: now.toISOString(),
    attempts: 0,
  };
}

function sendVerificationCode(
  channel: NotificationChannel,
  recipient: string,
  name: string,
  code: string,
): void {
  if (channel === "email") {
    sendEmail({
      to: recipient,
      ...signupVerificationEmail(name, code, VERIFICATION_CODE_TTL_MINUTES),
    }).catch((err) =>
      logger.warn({ err, to: recipient }, "signup verification email threw"),
    );
  } else {
    sendWhatsAppText(
      recipient,
      signupVerificationWhatsApp(name, code, VERIFICATION_CODE_TTL_MINUTES),
    ).catch((err) =>
      logger.warn({ err, to: recipient }, "signup verification whatsapp threw"),
    );
  }
}

function verifiedColumnFor(channel: NotificationChannel) {
  return channel === "email"
    ? usersTable.emailVerifiedAt
    : usersTable.phoneVerifiedAt;
}

function isChannelVerified(
  user: Pick<typeof usersTable.$inferSelect, "emailVerifiedAt" | "phoneVerifiedAt">,
  channel: NotificationChannel,
): boolean {
  return Boolean(
    channel === "email" ? user.emailVerifiedAt : user.phoneVerifiedAt,
  );
}

function pendingVerificationChannels(
  user: typeof usersTable.$inferSelect,
): NotificationChannel[] {
  const selected = (user.notificationChannels ?? ["email", "whatsapp"]) as
    | NotificationChannel[]
    | readonly NotificationChannel[];
  return (selected as NotificationChannel[]).filter(
    (c) => !isChannelVerified(user, c),
  );
}

function verificationStatus(user: typeof usersTable.$inferSelect) {
  const selected = (user.notificationChannels ?? ["email", "whatsapp"]) as
    | NotificationChannel[]
    | readonly NotificationChannel[];
  const verified: NotificationChannel[] = [];
  const pending: NotificationChannel[] = [];
  for (const c of selected as NotificationChannel[]) {
    if (isChannelVerified(user, c)) verified.push(c);
    else pending.push(c);
  }
  return {
    userId: user.id,
    verifiedChannels: verified,
    pendingChannels: pending,
    allVerified: pending.length === 0,
  };
}

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (!row || !row.active) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (!verifyPassword(parsed.data.password, row.passwordHash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  if (row.approvalStatus === "pending") {
    res.status(401).json({
      error: "Your application is still under review.",
      reason: "pending",
    });
    return;
  }
  if (row.approvalStatus === "rejected") {
    res.status(401).json({
      error: "Your application was not approved.",
      reason: "rejected",
      note: row.approvalNote ?? null,
    });
    return;
  }
  issueSessionCookie(res, row.id);
  res.json(toAuthedUser(row));
});

/**
 * Public signup. Two flavors share this endpoint:
 *
 *  1. Legacy "Sign up to rent" — body has no `requestedRole`. We provision an
 *     `owner` account and sign them in immediately so the rentals flow keeps
 *     working without rewiring (renter-profile KYC stays the booking gate).
 *  2. New multi-role apply flow (`/signup` page) — body carries
 *     `requestedRole` + `applicantData`. We park the user in
 *     `approvalStatus=pending`, do NOT issue a session cookie, and the super
 *     admin must approve before they can sign in. Once approved they land on
 *     `/onboarding/kyc` until verified.
 */
router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const requestedRole = parsed.data.requestedRole ?? null;
  const isApplication = !!requestedRole;
  // Normalise channel preferences against the allowed list. Omitting the
  // field (legacy callers) means "default to all channels" — handled by
  // leaving the column null so wantsChannel() falls back to delivering on
  // every channel.
  const allowedChannels = ["email", "whatsapp"] as const;
  let notificationChannels: typeof allowedChannels[number][] | null = null;
  if (parsed.data.notificationChannels !== undefined) {
    const set = new Set(parsed.data.notificationChannels);
    notificationChannels = allowedChannels.filter((c) => set.has(c));
  }
  // Resolved channels actually used for code-issuance / storage on the new
  // row — defaults to both when the caller omitted the field.
  const resolvedChannels: NotificationChannel[] =
    notificationChannels ?? [...allowedChannels];
  const [dup] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (dup) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }
  // For an application, the user has no usable role yet — store a neutral
  // placeholder until approval (we never let `pending` users sign in anyway).
  const insertRole = isApplication
    ? requestedRole === "renter"
      ? "owner"
      : requestedRole
    : "owner";
  const phone = parsed.data.phone?.trim() || null;
  // Generate one-time verification codes for every selected channel that
  // has a corresponding contact value on file. Legacy callers (no
  // `requestedRole`) skip verification entirely and are marked verified
  // up-front — they get an immediate session anyway, so the gate would
  // serve no purpose. Application signups go through full verification.
  const codesToSend: Array<{ channel: NotificationChannel; recipient: string; code: string }> = [];
  const pendingVerifications: PendingVerifications = {};
  if (isApplication) {
    for (const channel of resolvedChannels) {
      const recipient = channel === "email" ? email : phone;
      if (!recipient) continue;
      const code = generateCode();
      pendingVerifications[channel] = buildPendingEntry(code);
      codesToSend.push({ channel, recipient, code });
    }
  }
  let row;
  try {
    [row] = await db
      .insert(usersTable)
      .values({
        email,
        passwordHash: hashPassword(parsed.data.password),
        name: parsed.data.name.trim(),
        role: insertRole,
        phone,
        approvalStatus: isApplication ? "pending" : "approved",
        kycStatus: isApplication ? "not_submitted" : "verified",
        requestedRole,
        applicantData: (parsed.data.applicantData ?? null) as
          | Record<string, unknown>
          | null,
        ...(notificationChannels !== null
          ? { notificationChannels }
          : {}),
        // Legacy auto-approved signups skip verification (no inbox to land
        // in before sign-in); applications start with both verifiedAt
        // columns null and codes parked in pendingVerifications.
        ...(isApplication
          ? { pendingVerifications }
          : { emailVerifiedAt: new Date(), phoneVerifiedAt: new Date() }),
      })
      .returning();
  } catch (err) {
    const code =
      (err as { code?: string }).code ??
      (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }
    throw err;
  }
  if (!row) {
    res.status(500).json({ error: "Could not create account" });
    return;
  }
  if (isApplication) {
    await db.insert(approvalEventsTable).values({
      userId: row.id,
      action: "applied",
      actorUserId: row.id,
      actorName: row.name,
      note: `Applied as ${requestedRole}.`,
    });
    // Fire the verification codes after the row is committed so a
    // transient send failure can't leave us with a user that doesn't know
    // how to verify. sendVerificationCode is fire-and-forget — failures
    // are logged and the applicant can hit "resend" to get a fresh copy.
    for (const c of codesToSend) {
      sendVerificationCode(c.channel, c.recipient, row.name, c.code);
    }
  }
  // Only the legacy auto-approved path issues a cookie. Applications get
  // returned without a session so the client can show "pending" UX.
  if (!isApplication) {
    issueSessionCookie(res, row.id);
  }
  res.status(isApplication ? 202 : 201).json(toAuthedUser(row));
});

/**
 * POST /auth/signup/verify — applicant submits the one-time code we sent
 * to their email or WhatsApp at signup. Successful verification stamps the
 * matching `xVerifiedAt` column and drops the pending entry so a stale
 * code can't be re-used. We never expose whether the user exists when the
 * code is wrong; failed attempts increment a counter and a flood (5+)
 * forces the applicant to request a fresh code via /resend-verification.
 */
router.post("/auth/signup/verify", async (req, res): Promise<void> => {
  const parsed = VerifySignupCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { userId, channel, code } = parsed.data;
  const [row] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (isChannelVerified(row, channel)) {
    res.json(verificationStatus(row));
    return;
  }
  const pending: PendingVerifications = (row.pendingVerifications ?? {}) as PendingVerifications;
  const entry = pending[channel];
  if (!entry) {
    res.status(400).json({ error: "No verification code is pending for that channel." });
    return;
  }
  if (entry.attempts >= VERIFICATION_MAX_ATTEMPTS) {
    res.status(400).json({
      error: "Too many incorrect attempts. Request a new code to continue.",
    });
    return;
  }
  if (new Date(entry.expiresAt).getTime() < Date.now()) {
    res.status(400).json({ error: "That code has expired. Request a new one." });
    return;
  }
  const submitted = code.trim().replace(/\s+/g, "");
  if (hashCode(submitted) !== entry.codeHash) {
    const nextPending: PendingVerifications = { ...pending };
    nextPending[channel] = { ...entry, attempts: entry.attempts + 1 };
    await db
      .update(usersTable)
      .set({ pendingVerifications: nextPending })
      .where(eq(usersTable.id, userId));
    res.status(400).json({ error: "That code doesn't match — please try again." });
    return;
  }
  // Correct code — strip the pending entry and stamp the verifiedAt column.
  const nextPending: PendingVerifications = { ...pending };
  delete nextPending[channel];
  const patch: Record<string, unknown> = {
    pendingVerifications:
      Object.keys(nextPending).length === 0 ? null : nextPending,
  };
  patch[channel === "email" ? "emailVerifiedAt" : "phoneVerifiedAt"] = new Date();
  const [updated] = await db
    .update(usersTable)
    .set(patch)
    .where(eq(usersTable.id, userId))
    .returning();
  res.json(verificationStatus(updated ?? row));
});

/**
 * POST /auth/signup/resend-verification — applicant asks us to re-send the
 * code for a channel that's still pending. Rate-limited per channel
 * (lastSentAt + cooldown) so a malicious caller can't use the endpoint to
 * spam an arbitrary inbox or burn through WhatsApp quota. The cooldown
 * reservation is done with a single conditional UPDATE so concurrent
 * clicks race for the same row safely across multiple API instances.
 */
router.post(
  "/auth/signup/resend-verification",
  async (req, res): Promise<void> => {
    const parsed = ResendSignupVerificationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { userId, channel } = parsed.data;
    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (isChannelVerified(row, channel)) {
      res.json(verificationStatus(row));
      return;
    }
    const recipient = channel === "email" ? row.email : row.phone;
    if (!recipient) {
      res.status(400).json({
        error: `No ${channel === "email" ? "email address" : "phone number"} on file.`,
      });
      return;
    }
    const selected = (row.notificationChannels ?? ["email", "whatsapp"]) as
      | NotificationChannel[]
      | readonly NotificationChannel[];
    if (!(selected as NotificationChannel[]).includes(channel)) {
      res.status(400).json({ error: "That channel was not selected at signup." });
      return;
    }
    const now = Date.now();
    const pending: PendingVerifications = (row.pendingVerifications ?? {}) as PendingVerifications;
    const existing = pending[channel];
    if (existing) {
      const lastSent = new Date(existing.lastSentAt).getTime();
      const elapsed = now - lastSent;
      if (elapsed < VERIFICATION_RESEND_COOLDOWN_MS) {
        const retryAfterSeconds = Math.ceil(
          (VERIFICATION_RESEND_COOLDOWN_MS - elapsed) / 1000,
        );
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.status(429).json({
          error: `Please wait ${retryAfterSeconds}s before requesting another code.`,
          retryAfterSeconds,
        });
        return;
      }
    }
    const code = generateCode();
    const nextEntry = buildPendingEntry(code);
    const nextPending: PendingVerifications = { ...pending, [channel]: nextEntry };
    // Guard against a concurrent verify landing between our SELECT and
    // UPDATE: only write if the channel is still unverified. A concurrent
    // resend that won the cooldown check above will produce a near-
    // identical write — losing that race is benign (the latest code wins).
    const [updated] = await db
      .update(usersTable)
      .set({ pendingVerifications: nextPending })
      .where(
        and(
          eq(usersTable.id, userId),
          isNull(verifiedColumnFor(channel)),
        ),
      )
      .returning();
    if (!updated) {
      // Channel was verified concurrently — re-read and report status.
      const [fresh] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      res.json(verificationStatus(fresh ?? row));
      return;
    }
    sendVerificationCode(channel, recipient, updated.name, code);
    res.json({
      ...verificationStatus(updated),
      retryAfterSeconds: Math.ceil(VERIFICATION_RESEND_COOLDOWN_MS / 1000),
    });
  },
);

router.post("/auth/logout", (_req, res): void => {
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/auth/me", (req, res): void => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(req.user);
});

router.patch("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateMyProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Only forward keys the caller actually set so we don't overwrite stored
  // values with `undefined` (Drizzle would set them to NULL).
  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch["name"] = parsed.data.name.trim();
  if (parsed.data.phone !== undefined) {
    const p = parsed.data.phone?.trim();
    patch["phone"] = p ? p : null;
  }
  if (parsed.data.avatarUrl !== undefined) {
    const a = parsed.data.avatarUrl?.trim();
    patch["avatarUrl"] = a ? a : null;
  }
  if (parsed.data.notificationChannels !== undefined) {
    // De-dupe and preserve canonical order so storage stays normalised.
    const allowed = ["email", "whatsapp"] as const;
    const set = new Set(parsed.data.notificationChannels);
    patch["notificationChannels"] = allowed.filter((c) => set.has(c));
  }
  if (Object.keys(patch).length === 0) {
    res.json(req.user);
    return;
  }
  const [row] = await db
    .update(usersTable)
    .set(patch)
    .where(eq(usersTable.id, req.user!.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // Best-effort sync to any staff records linked to this user so the staff
  // list shows the same name/phone the user just set.
  try {
    const { vendorStaffTable, platformStaffTable } = await import("@workspace/db");
    const staffPatch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) staffPatch["name"] = parsed.data.name.trim();
    if (parsed.data.phone !== undefined) {
      const p = parsed.data.phone?.trim();
      staffPatch["phone"] = p ? p : null;
    }
    if (Object.keys(staffPatch).length > 0) {
      await db
        .update(vendorStaffTable)
        .set(staffPatch)
        .where(eq(vendorStaffTable.userId, row.id));
      // platform_staff has no phone column; only forward name updates.
      if (parsed.data.name !== undefined) {
        await db
          .update(platformStaffTable)
          .set({ name: parsed.data.name.trim() })
          .where(eq(platformStaffTable.userId, row.id));
      }
    }
  } catch (err) {
    req.log.warn({ err }, "Failed to mirror profile to staff records");
  }
  res.json(toAuthedUser(row));
});

router.post(
  "/auth/change-password",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = ChangePasswordBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.id));
    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!verifyPassword(parsed.data.currentPassword, row.passwordHash)) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    await db
      .update(usersTable)
      .set({ passwordHash: hashPassword(parsed.data.newPassword) })
      .where(eq(usersTable.id, row.id));
    res.status(204).end();
  },
);

export default router;
