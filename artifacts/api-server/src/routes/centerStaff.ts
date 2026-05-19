import { Router, type IRouter } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, centerStaffTable, serviceCentersTable, usersTable } from "@workspace/db";
import {
  ListCenterStaffParams,
  CreateCenterStaffParams,
  CreateCenterStaffBody,
  UpdateCenterStaffParams,
  UpdateCenterStaffBody,
  DeleteCenterStaffParams,
} from "@workspace/api-zod";
import { hashPassword, requireAuth } from "../lib/auth";

const router: IRouter = Router();

async function centerExists(centerId: string): Promise<boolean> {
  const [c] = await db
    .select({ id: serviceCentersTable.id })
    .from(serviceCentersTable)
    .where(eq(serviceCentersTable.id, centerId));
  return !!c;
}

/**
 * Service-center staff are real login accounts. Each row is paired with a
 * `users` row (role: 'center'); writes that touch both tables run inside a
 * single DB transaction so we never end up with an orphan `users` row or a
 * staff record whose identity has half-updated.
 */
router.get(
  "/service-centers/:centerId/staff",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListCenterStaffParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await centerExists(params.data.centerId))) {
      res.status(404).json({ error: "Service center not found" });
      return;
    }
    const rows = await db
      .select({
        id: centerStaffTable.id,
        centerId: centerStaffTable.centerId,
        userId: centerStaffTable.userId,
        name: centerStaffTable.name,
        email: centerStaffTable.email,
        phone: centerStaffTable.phone,
        role: centerStaffTable.role,
        permissions: centerStaffTable.permissions,
        active: centerStaffTable.active,
        createdAt: centerStaffTable.createdAt,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(centerStaffTable)
      .leftJoin(usersTable, eq(centerStaffTable.userId, usersTable.id))
      .where(eq(centerStaffTable.centerId, params.data.centerId))
      .orderBy(desc(centerStaffTable.createdAt));
    res.json(rows);
  },
);

router.post(
  "/service-centers/:centerId/staff",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreateCenterStaffParams.safeParse(req.params);
    const body = CreateCenterStaffBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: (params.error ?? body.error)?.message });
      return;
    }
    if (!(await centerExists(params.data.centerId))) {
      res.status(404).json({ error: "Service center not found" });
      return;
    }
    const emailLc = body.data.email.trim().toLowerCase();
    try {
      const result = await db.transaction(async (tx) => {
        const dupStaff = await tx
          .select({ id: centerStaffTable.id })
          .from(centerStaffTable)
          .where(
            and(
              eq(centerStaffTable.centerId, params.data.centerId),
              eq(centerStaffTable.email, emailLc),
            ),
          );
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
            role: "center",
            phone: body.data.phone ?? null,
          })
          .returning();
        const [row] = await tx
          .insert(centerStaffTable)
          .values({
            centerId: params.data.centerId,
            userId: user!.id,
            name: body.data.name.trim(),
            email: emailLc,
            phone: body.data.phone ?? null,
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
  },
);

router.patch(
  "/service-centers/:centerId/staff/:staffId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateCenterStaffParams.safeParse(req.params);
    const body = UpdateCenterStaffBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: (params.error ?? body.error)?.message });
      return;
    }
    if (!(await centerExists(params.data.centerId))) {
      res.status(404).json({ error: "Service center not found" });
      return;
    }
    const emailLc = body.data.email?.trim().toLowerCase();

    try {
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(centerStaffTable)
          .where(
            and(
              eq(centerStaffTable.id, params.data.staffId),
              eq(centerStaffTable.centerId, params.data.centerId),
            ),
          );
        if (!existing) throw new Error("NOT_FOUND");

        if (emailLc) {
          const dupStaff = await tx
            .select({ id: centerStaffTable.id })
            .from(centerStaffTable)
            .where(
              and(
                eq(centerStaffTable.centerId, params.data.centerId),
                eq(centerStaffTable.email, emailLc),
                ne(centerStaffTable.id, params.data.staffId),
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
          .update(centerStaffTable)
          .set(staffPatch)
          .where(
            and(
              eq(centerStaffTable.id, params.data.staffId),
              eq(centerStaffTable.centerId, params.data.centerId),
            ),
          )
          .returning();

        let avatarUrl: string | null = null;
        if (existing.userId) {
          const userPatch: Record<string, unknown> = {};
          if (body.data.name !== undefined)
            userPatch["name"] = body.data.name.trim();
          if (emailLc !== undefined) userPatch["email"] = emailLc;
          if (body.data.phone !== undefined)
            userPatch["phone"] = body.data.phone ?? null;
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
  "/service-centers/:centerId/staff/:staffId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteCenterStaffParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await centerExists(params.data.centerId))) {
      res.status(404).json({ error: "Service center not found" });
      return;
    }
    const found = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ userId: centerStaffTable.userId })
        .from(centerStaffTable)
        .where(
          and(
            eq(centerStaffTable.id, params.data.staffId),
            eq(centerStaffTable.centerId, params.data.centerId),
          ),
        );
      if (!existing) return false;
      await tx
        .delete(centerStaffTable)
        .where(
          and(
            eq(centerStaffTable.id, params.data.staffId),
            eq(centerStaffTable.centerId, params.data.centerId),
          ),
        );
      if (existing.userId) {
        await tx.delete(usersTable).where(eq(usersTable.id, existing.userId));
      }
      return true;
    });
    if (!found) {
      res.status(404).json({ error: "Staff not found" });
      return;
    }
    res.status(204).end();
  },
);

export default router;
