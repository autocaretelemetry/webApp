import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, userAddressesTable, type UserAddress } from "@workspace/db";
import { requireAuth } from "../lib/auth";

/**
 * Saved-shipping-address book endpoints. Intentionally outside the
 * OpenAPI contract (same precedent as the fleet routes and the
 * maintenance-history CSV/PDF route): they're consumed by one client,
 * so we hit plain Express + Zod with React Query and skip codegen
 * churn. Every route is auth-gated and scoped to `req.user.id` — there
 * is no IDOR surface; the URL never carries another user's id.
 */

const AddressBody = z.object({
  label: z.string().trim().min(1).max(60),
  recipientName: z.string().trim().min(1).max(120),
  recipientPhone: z.string().trim().min(1).max(40),
  addressLine: z.string().trim().min(1).max(500),
  city: z.string().trim().max(120).optional().default(""),
  region: z.string().trim().max(120).optional().default(""),
  isDefault: z.boolean().optional(),
});

const AddressPatch = AddressBody.partial();

type AddressDto = {
  id: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  city: string;
  region: string;
  isDefault: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: UserAddress): AddressDto {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    addressLine: row.addressLine,
    city: row.city,
    region: row.region,
    isDefault: row.isDefault,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Sort: default first, then most-recently-used, then newest. The client
// uses this order directly in the dropdown.
function listForUser(userId: string) {
  return db
    .select()
    .from(userAddressesTable)
    .where(eq(userAddressesTable.userId, userId))
    .orderBy(
      desc(userAddressesTable.isDefault),
      desc(sql`coalesce(${userAddressesTable.lastUsedAt}, ${userAddressesTable.createdAt})`),
      desc(userAddressesTable.createdAt),
    );
}

async function clearOtherDefaults(userId: string, exceptId?: string) {
  const whereClause = exceptId
    ? and(
        eq(userAddressesTable.userId, userId),
        sql`${userAddressesTable.id} <> ${exceptId}`,
      )
    : eq(userAddressesTable.userId, userId);
  await db
    .update(userAddressesTable)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(whereClause);
}

const router: IRouter = Router();

router.get("/me/addresses", requireAuth, async (req, res): Promise<void> => {
  const rows = await listForUser(req.user!.id);
  res.json(rows.map(toDto));
});

router.post("/me/addresses", requireAuth, async (req, res): Promise<void> => {
  const parsed = AddressBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db
    .select({ id: userAddressesTable.id })
    .from(userAddressesTable)
    .where(eq(userAddressesTable.userId, req.user!.id));
  // First address always becomes the default — buyers expect the only
  // saved entry to be preselected at checkout.
  const shouldBeDefault = parsed.data.isDefault === true || existing.length === 0;
  if (shouldBeDefault) {
    await clearOtherDefaults(req.user!.id);
  }
  const [row] = await db
    .insert(userAddressesTable)
    .values({
      userId: req.user!.id,
      label: parsed.data.label,
      recipientName: parsed.data.recipientName,
      recipientPhone: parsed.data.recipientPhone,
      addressLine: parsed.data.addressLine,
      city: parsed.data.city ?? "",
      region: parsed.data.region ?? "",
      isDefault: shouldBeDefault,
    })
    .returning();
  if (!row) {
    res.status(500).json({ error: "Could not save address" });
    return;
  }
  res.status(201).json(toDto(row));
});

router.patch(
  "/me/addresses/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = AddressPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const id = String(req.params.id);
    const [current] = await db
      .select()
      .from(userAddressesTable)
      .where(
        and(
          eq(userAddressesTable.id, id),
          eq(userAddressesTable.userId, req.user!.id),
        ),
      );
    if (!current) {
      res.status(404).json({ error: "Address not found" });
      return;
    }
    const patch: Partial<typeof userAddressesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.label !== undefined) patch.label = parsed.data.label;
    if (parsed.data.recipientName !== undefined)
      patch.recipientName = parsed.data.recipientName;
    if (parsed.data.recipientPhone !== undefined)
      patch.recipientPhone = parsed.data.recipientPhone;
    if (parsed.data.addressLine !== undefined)
      patch.addressLine = parsed.data.addressLine;
    if (parsed.data.city !== undefined) patch.city = parsed.data.city ?? "";
    if (parsed.data.region !== undefined)
      patch.region = parsed.data.region ?? "";
    const makingDefault = parsed.data.isDefault === true;
    const clearingDefault =
      parsed.data.isDefault === false && current.isDefault;
    if (makingDefault) {
      await clearOtherDefaults(req.user!.id, id);
      patch.isDefault = true;
    } else if (clearingDefault) {
      // Don't allow turning the default off if it's the only address;
      // it would leave the user with no preselected entry at checkout.
      const others = await db
        .select({ id: userAddressesTable.id })
        .from(userAddressesTable)
        .where(
          and(
            eq(userAddressesTable.userId, req.user!.id),
            sql`${userAddressesTable.id} <> ${id}`,
          ),
        );
      if (others.length === 0) {
        res.status(400).json({
          error: "At least one address must be marked as default.",
        });
        return;
      }
      patch.isDefault = false;
    }
    const [row] = await db
      .update(userAddressesTable)
      .set(patch)
      .where(eq(userAddressesTable.id, id))
      .returning();
    res.json(toDto(row!));
  },
);

router.delete(
  "/me/addresses/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const [current] = await db
      .select()
      .from(userAddressesTable)
      .where(
        and(
          eq(userAddressesTable.id, id),
          eq(userAddressesTable.userId, req.user!.id),
        ),
      );
    if (!current) {
      res.status(404).json({ error: "Address not found" });
      return;
    }
    await db
      .delete(userAddressesTable)
      .where(eq(userAddressesTable.id, id));
    // If we just removed the default, promote the most-recently-used
    // surviving entry so the buyer still has a preselected address.
    if (current.isDefault) {
      const [next] = await db
        .select({ id: userAddressesTable.id })
        .from(userAddressesTable)
        .where(eq(userAddressesTable.userId, req.user!.id))
        .orderBy(
          desc(
            sql`coalesce(${userAddressesTable.lastUsedAt}, ${userAddressesTable.createdAt})`,
          ),
          desc(userAddressesTable.createdAt),
        )
        .limit(1);
      if (next) {
        await db
          .update(userAddressesTable)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(userAddressesTable.id, next.id));
      }
    }
    res.status(204).end();
  },
);

// Bump lastUsedAt and promote to default. Used by checkout after a
// successful order so the next visit preselects this address.
router.post(
  "/me/addresses/:id/touch",
  requireAuth,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const [current] = await db
      .select()
      .from(userAddressesTable)
      .where(
        and(
          eq(userAddressesTable.id, id),
          eq(userAddressesTable.userId, req.user!.id),
        ),
      );
    if (!current) {
      res.status(404).json({ error: "Address not found" });
      return;
    }
    await clearOtherDefaults(req.user!.id, id);
    const [row] = await db
      .update(userAddressesTable)
      .set({ lastUsedAt: new Date(), isDefault: true, updatedAt: new Date() })
      .where(eq(userAddressesTable.id, id))
      .returning();
    res.json(toDto(row!));
  },
);

export default router;
