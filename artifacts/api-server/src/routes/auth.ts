import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  LoginBody,
  SignupBody,
  UpdateMyProfileBody,
  ChangePasswordBody,
} from "@workspace/api-zod";
import {
  verifyPassword,
  hashPassword,
  issueSessionCookie,
  clearSessionCookie,
  requireAuth,
} from "../lib/auth";

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
  issueSessionCookie(res, row.id);
  const { passwordHash: _ph, ...safe } = row;
  res.json(safe);
});

/**
 * Public signup — currently only used by the "Sign up to rent" flow, so we
 * pin every new account to the `owner` role. Renting a car uses an owner
 * account plus a phone-keyed renter profile created on the next step.
 */
router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  // Pre-check is a UX optimization only — the DB unique index on users.email
  // is the source of truth. We still try/catch the insert so two concurrent
  // signups for the same email both get a deterministic 409.
  const [dup] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (dup) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }
  let row;
  try {
    [row] = await db
      .insert(usersTable)
      .values({
        email,
        passwordHash: hashPassword(parsed.data.password),
        name: parsed.data.name.trim(),
        role: "owner",
        phone: parsed.data.phone?.trim() || null,
      })
      .returning();
  } catch (err) {
    // Postgres unique_violation. node-postgres surfaces the SQLSTATE on
    // `code`; drizzle wraps it but preserves the underlying error.
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
  issueSessionCookie(res, row.id);
  const { passwordHash: _ph, ...safe } = row;
  res.status(201).json(safe);
});

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
  const { passwordHash: _ph, ...safe } = row;
  res.json(safe);
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
