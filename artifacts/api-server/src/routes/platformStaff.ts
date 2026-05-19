import { Router, type IRouter } from "express";
import { and, eq, desc, ne } from "drizzle-orm";
import { db, platformStaffTable, usersTable } from "@workspace/db";
import {
  ListPlatformStaffQueryParams,
  CreatePlatformStaffBody,
  UpdatePlatformStaffParams,
  UpdatePlatformStaffBody,
  DeletePlatformStaffParams,
} from "@workspace/api-zod";
import { hashPassword, requireAuth } from "../lib/auth";

const router: IRouter = Router();

/**
 * Platform staff are paired with a `users` row (role: 'admin'). All writes
 * that span both tables run in a transaction so a failed step rolls back the
 * other and we never leave behind orphan users or half-renamed accounts.
 */
router.get("/platform-staff", requireAuth, async (req, res): Promise<void> => {
  const q = ListPlatformStaffQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const base = db
    .select({
      id: platformStaffTable.id,
      userId: platformStaffTable.userId,
      name: platformStaffTable.name,
      email: platformStaffTable.email,
      role: platformStaffTable.role,
      permissions: platformStaffTable.permissions,
      active: platformStaffTable.active,
      createdAt: platformStaffTable.createdAt,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(platformStaffTable)
    .leftJoin(usersTable, eq(platformStaffTable.userId, usersTable.id));
  const rows = await (q.data.includeInactive
    ? base.orderBy(desc(platformStaffTable.createdAt))
    : base
        .where(eq(platformStaffTable.active, true))
        .orderBy(desc(platformStaffTable.createdAt)));
  res.json(rows);
});

router.post("/platform-staff", requireAuth, async (req, res): Promise<void> => {
  const body = CreatePlatformStaffBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const emailLc = body.data.email.trim().toLowerCase();
  try {
    const result = await db.transaction(async (tx) => {
      const dupStaff = await tx
        .select({ id: platformStaffTable.id })
        .from(platformStaffTable)
        .where(eq(platformStaffTable.email, emailLc));
      if (dupStaff.length > 0) throw new Error("DUP_STAFF");
      const dupUser = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, emailLc));
      if (dupUser.length > 0) throw new Error("DUP_USER");

      const [user] = await tx
        .insert(usersTable)
        .values({
          email: emailLc,
          passwordHash: hashPassword(body.data.password),
          name: body.data.name.trim(),
          role: "admin",
        })
        .returning();
      const [row] = await tx
        .insert(platformStaffTable)
        .values({
          userId: user!.id,
          name: body.data.name.trim(),
          email: emailLc,
          role: body.data.role ?? "staff",
          permissions: body.data.permissions ?? [],
        })
        .returning();
      return { ...row, avatarUrl: user!.avatarUrl ?? null };
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "DUP_STAFF") {
      res.status(409).json({ error: "A staff member with that email already exists." });
      return;
    }
    if (err instanceof Error && err.message === "DUP_USER") {
      res.status(409).json({ error: "That email is already used by another account." });
      return;
    }
    throw err;
  }
});

router.patch(
  "/platform-staff/:staffId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdatePlatformStaffParams.safeParse(req.params);
    const body = UpdatePlatformStaffBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: (params.error ?? body.error)?.message });
      return;
    }
    const emailLc = body.data.email?.trim().toLowerCase();

    try {
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(platformStaffTable)
          .where(eq(platformStaffTable.id, params.data.staffId));
        if (!existing) throw new Error("NOT_FOUND");

        if (emailLc) {
          const dupStaff = await tx
            .select({ id: platformStaffTable.id })
            .from(platformStaffTable)
            .where(
              and(
                eq(platformStaffTable.email, emailLc),
                ne(platformStaffTable.id, params.data.staffId),
              ),
            );
          if (dupStaff.length > 0) throw new Error("DUP_STAFF");
          const dupUser = await tx
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eq(usersTable.email, emailLc));
          if (
            dupUser.some(
              (u) => !existing.userId || u.id !== existing.userId,
            )
          ) {
            throw new Error("DUP_USER");
          }
        }

        const staffPatch: Record<string, unknown> = { ...body.data };
        if (emailLc !== undefined) staffPatch["email"] = emailLc;
        if (body.data.name !== undefined)
          staffPatch["name"] = body.data.name.trim();
        const [row] = await tx
          .update(platformStaffTable)
          .set(staffPatch)
          .where(eq(platformStaffTable.id, params.data.staffId))
          .returning();

        let avatarUrl: string | null = null;
        if (existing.userId) {
          const userPatch: Record<string, unknown> = {};
          if (body.data.name !== undefined)
            userPatch["name"] = body.data.name.trim();
          if (emailLc !== undefined) userPatch["email"] = emailLc;
          if (body.data.active !== undefined)
            userPatch["active"] = body.data.active;
          if (Object.keys(userPatch).length > 0) {
            await tx
              .update(usersTable)
              .set(userPatch)
              .where(eq(usersTable.id, existing.userId));
          }
          const [u] = await tx
            .select({ avatarUrl: usersTable.avatarUrl })
            .from(usersTable)
            .where(eq(usersTable.id, existing.userId));
          avatarUrl = u?.avatarUrl ?? null;
        }
        return { ...row, avatarUrl };
      });
      res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message === "NOT_FOUND") {
        res.status(404).json({ error: "Staff not found" });
        return;
      }
      if (err instanceof Error && err.message === "DUP_STAFF") {
        res.status(409).json({ error: "A staff member with that email already exists." });
        return;
      }
      if (err instanceof Error && err.message === "DUP_USER") {
        res.status(409).json({ error: "That email is already used by another account." });
        return;
      }
      throw err;
    }
  },
);

router.delete(
  "/platform-staff/:staffId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeletePlatformStaffParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ userId: platformStaffTable.userId })
        .from(platformStaffTable)
        .where(eq(platformStaffTable.id, params.data.staffId));
      await tx
        .delete(platformStaffTable)
        .where(eq(platformStaffTable.id, params.data.staffId));
      if (existing?.userId) {
        await tx.delete(usersTable).where(eq(usersTable.id, existing.userId));
      }
    });
    res.status(204).end();
  },
);

export default router;
