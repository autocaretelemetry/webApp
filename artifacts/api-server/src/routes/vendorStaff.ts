import { Router, type IRouter } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, vendorStaffTable, vendorsTable, usersTable } from "@workspace/db";
import {
  ListVendorStaffParams,
  CreateVendorStaffParams,
  CreateVendorStaffBody,
  UpdateVendorStaffParams,
  UpdateVendorStaffBody,
  DeleteVendorStaffParams,
} from "@workspace/api-zod";
import { hashPassword, requireAuth } from "../lib/auth";

const router: IRouter = Router();

async function vendorExists(vendorId: string): Promise<boolean> {
  const [v] = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, vendorId));
  return !!v;
}

/**
 * Vendor staff are real login accounts. Each staff row is paired with a row
 * in `users` (role: 'vendor'). Mutations that touch both tables run inside a
 * single DB transaction so we never end up with an orphaned `users` row or a
 * staff row whose identity has half-updated.
 */
router.get(
  "/vendors/:vendorId/staff",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListVendorStaffParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await vendorExists(params.data.vendorId))) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    const rows = await db
      .select({
        id: vendorStaffTable.id,
        vendorId: vendorStaffTable.vendorId,
        userId: vendorStaffTable.userId,
        name: vendorStaffTable.name,
        email: vendorStaffTable.email,
        phone: vendorStaffTable.phone,
        role: vendorStaffTable.role,
        permissions: vendorStaffTable.permissions,
        active: vendorStaffTable.active,
        createdAt: vendorStaffTable.createdAt,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(vendorStaffTable)
      .leftJoin(usersTable, eq(vendorStaffTable.userId, usersTable.id))
      .where(eq(vendorStaffTable.vendorId, params.data.vendorId))
      .orderBy(desc(vendorStaffTable.createdAt));
    res.json(rows);
  },
);

router.post(
  "/vendors/:vendorId/staff",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreateVendorStaffParams.safeParse(req.params);
    const body = CreateVendorStaffBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: (params.error ?? body.error)?.message });
      return;
    }
    if (!(await vendorExists(params.data.vendorId))) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    const emailLc = body.data.email.trim().toLowerCase();
    try {
      const result = await db.transaction(async (tx) => {
        // Email must be unique both within this vendor's staff and across
        // every platform login account.
        const dupStaff = await tx
          .select({ id: vendorStaffTable.id })
          .from(vendorStaffTable)
          .where(
            and(
              eq(vendorStaffTable.vendorId, params.data.vendorId),
              eq(vendorStaffTable.email, emailLc),
            ),
          );
        if (dupStaff.length > 0) {
          throw new Error("DUP_STAFF");
        }
        const dupUser = await tx
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.email, emailLc));
        if (dupUser.length > 0) {
          throw new Error("DUP_USER");
        }
        const [user] = await tx
          .insert(usersTable)
          .values({
            email: emailLc,
            passwordHash: hashPassword(body.data.password),
            name: body.data.name.trim(),
            role: "vendor",
            phone: body.data.phone ?? null,
          })
          .returning();
        const [row] = await tx
          .insert(vendorStaffTable)
          .values({
            vendorId: params.data.vendorId,
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
  "/vendors/:vendorId/staff/:staffId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateVendorStaffParams.safeParse(req.params);
    const body = UpdateVendorStaffBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: (params.error ?? body.error)?.message });
      return;
    }
    if (!(await vendorExists(params.data.vendorId))) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    const emailLc = body.data.email?.trim().toLowerCase();

    try {
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(vendorStaffTable)
          .where(
            and(
              eq(vendorStaffTable.id, params.data.staffId),
              eq(vendorStaffTable.vendorId, params.data.vendorId),
            ),
          );
        if (!existing) {
          throw new Error("NOT_FOUND");
        }

        if (emailLc) {
          const dupStaff = await tx
            .select({ id: vendorStaffTable.id })
            .from(vendorStaffTable)
            .where(
              and(
                eq(vendorStaffTable.vendorId, params.data.vendorId),
                eq(vendorStaffTable.email, emailLc),
                ne(vendorStaffTable.id, params.data.staffId),
              ),
            );
          if (dupStaff.length > 0) throw new Error("DUP_STAFF");
          // Block re-using an email owned by a different login account.
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
          .update(vendorStaffTable)
          .set(staffPatch)
          .where(
            and(
              eq(vendorStaffTable.id, params.data.staffId),
              eq(vendorStaffTable.vendorId, params.data.vendorId),
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
  "/vendors/:vendorId/staff/:staffId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteVendorStaffParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!(await vendorExists(params.data.vendorId))) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    const found = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ userId: vendorStaffTable.userId })
        .from(vendorStaffTable)
        .where(
          and(
            eq(vendorStaffTable.id, params.data.staffId),
            eq(vendorStaffTable.vendorId, params.data.vendorId),
          ),
        );
      if (!existing) return false;
      await tx
        .delete(vendorStaffTable)
        .where(
          and(
            eq(vendorStaffTable.id, params.data.staffId),
            eq(vendorStaffTable.vendorId, params.data.vendorId),
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
