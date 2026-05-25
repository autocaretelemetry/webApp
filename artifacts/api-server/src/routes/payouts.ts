import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  serviceCentersTable,
  vendorsTable,
  usersTable,
  centerStaffTable,
  vendorStaffTable,
  sellerPayoutsTable,
  type PayoutAccount,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import {
  disburseToSeller,
  retryPayoutsForSeller,
  disbursementConfigured,
} from "../lib/payouts";

const router: IRouter = Router();

const PayoutAccountBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bank"),
    accountName: z.string().min(2),
    accountNumber: z.string().min(4),
    bank: z.string().min(2),
  }),
  z.object({
    kind: z.literal("momo"),
    accountName: z.string().min(2),
    accountNumber: z.string().min(8),
    network: z.string().min(2),
  }),
]);

function normaliseAccount(parsed: z.infer<typeof PayoutAccountBody>): PayoutAccount {
  if (parsed.kind === "bank") {
    return {
      kind: "bank",
      accountName: parsed.accountName.trim(),
      accountNumber: parsed.accountNumber.trim(),
      bank: parsed.bank.trim(),
    };
  }
  return {
    kind: "momo",
    accountName: parsed.accountName.trim(),
    accountNumber: parsed.accountNumber.trim(),
    network: parsed.network.trim(),
  };
}

// ----- Service center payout account -----

router.put(
  "/service-centers/:centerId/payout-account",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const centerId = z.string().uuid().safeParse(req.params["centerId"]);
    if (!centerId.success) {
      res.status(400).json({ error: "Invalid center id" });
      return;
    }
    const body = PayoutAccountBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (user.role !== "admin" && user.role !== "super_admin") {
      const [staff] = await db
        .select()
        .from(centerStaffTable)
        .where(
          and(
            eq(centerStaffTable.userId, user.id),
            eq(centerStaffTable.centerId, centerId.data),
            eq(centerStaffTable.active, true),
          ),
        );
      if (!staff) {
        res.status(403).json({ error: "You don't have access to this service center." });
        return;
      }
    }
    const account = normaliseAccount(body.data);
    const [updated] = await db
      .update(serviceCentersTable)
      .set({ payoutAccount: account })
      .where(eq(serviceCentersTable.id, centerId.data))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Service center not found" });
      return;
    }
    retryPayoutsForSeller("service_center", centerId.data).catch(() => {});
    res.json(updated);
  },
);

router.get(
  "/service-centers/:centerId/payout-account",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const centerId = z.string().uuid().safeParse(req.params["centerId"]);
    if (!centerId.success) {
      res.status(400).json({ error: "Invalid center id" });
      return;
    }
    // Bank/MoMo destinations are sensitive — gate reads the same way as PUTs.
    if (user.role !== "admin" && user.role !== "super_admin") {
      const [staff] = await db
        .select()
        .from(centerStaffTable)
        .where(
          and(
            eq(centerStaffTable.userId, user.id),
            eq(centerStaffTable.centerId, centerId.data),
            eq(centerStaffTable.active, true),
          ),
        );
      if (!staff) {
        res.status(403).json({ error: "You don't have access to this service center." });
        return;
      }
    }
    const [c] = await db
      .select({ payoutAccount: serviceCentersTable.payoutAccount })
      .from(serviceCentersTable)
      .where(eq(serviceCentersTable.id, centerId.data));
    if (!c) {
      res.status(404).json({ error: "Service center not found" });
      return;
    }
    res.json({ payoutAccount: c.payoutAccount ?? null });
  },
);

// ----- Vendor payout account -----

router.put(
  "/vendors/:vendorId/payout-account",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const vendorId = z.string().uuid().safeParse(req.params["vendorId"]);
    if (!vendorId.success) {
      res.status(400).json({ error: "Invalid vendor id" });
      return;
    }
    const body = PayoutAccountBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    if (user.role !== "admin" && user.role !== "super_admin") {
      const [staff] = await db
        .select()
        .from(vendorStaffTable)
        .where(
          and(
            eq(vendorStaffTable.userId, user.id),
            eq(vendorStaffTable.vendorId, vendorId.data),
            eq(vendorStaffTable.active, true),
          ),
        );
      if (!staff) {
        res.status(403).json({ error: "You don't have access to this vendor." });
        return;
      }
    }
    const account = normaliseAccount(body.data);
    const [updated] = await db
      .update(vendorsTable)
      .set({ payoutAccount: account })
      .where(eq(vendorsTable.id, vendorId.data))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    retryPayoutsForSeller("vendor", vendorId.data).catch(() => {});
    res.json(updated);
  },
);

router.get(
  "/vendors/:vendorId/payout-account",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = req.user!;
    const vendorId = z.string().uuid().safeParse(req.params["vendorId"]);
    if (!vendorId.success) {
      res.status(400).json({ error: "Invalid vendor id" });
      return;
    }
    if (user.role !== "admin" && user.role !== "super_admin") {
      const [staff] = await db
        .select()
        .from(vendorStaffTable)
        .where(
          and(
            eq(vendorStaffTable.userId, user.id),
            eq(vendorStaffTable.vendorId, vendorId.data),
            eq(vendorStaffTable.active, true),
          ),
        );
      if (!staff) {
        res.status(403).json({ error: "You don't have access to this vendor." });
        return;
      }
    }
    const [v] = await db
      .select({ payoutAccount: vendorsTable.payoutAccount })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vendorId.data));
    if (!v) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    res.json({ payoutAccount: v.payoutAccount ?? null });
  },
);

// ----- Personal (rental car owner) payout account -----

router.put("/me/payout-account", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const body = PayoutAccountBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const account = normaliseAccount(body.data);
  await db.update(usersTable).set({ payoutAccount: account }).where(eq(usersTable.id, user.id));
  if (user.phone) {
    retryPayoutsForSeller("owner", user.phone).catch(() => {});
  }
  res.json({ payoutAccount: account });
});

router.get("/me/payout-account", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const [u] = await db
    .select({ payoutAccount: usersTable.payoutAccount })
    .from(usersTable)
    .where(eq(usersTable.id, user.id));
  res.json({ payoutAccount: u?.payoutAccount ?? null });
});

// ----- Super-admin queue -----

function requireSuperAdmin(req: Parameters<typeof requireAuth>[0], res: Parameters<typeof requireAuth>[1]): boolean {
  const user = req.user!;
  if (user.role !== "admin" && user.role !== "super_admin") {
    res.status(403).json({ error: "Super-admin only." });
    return false;
  }
  return true;
}

router.get("/admin/payouts", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const status = req.query["status"] as string | undefined;
  const where = status ? eq(sellerPayoutsTable.status, status) : undefined;
  const rows = await (where ? db.select().from(sellerPayoutsTable).where(where) : db.select().from(sellerPayoutsTable))
    .orderBy(desc(sellerPayoutsTable.createdAt))
    .limit(500);
  res.json({
    disburseConfigured: disbursementConfigured(),
    payouts: rows,
  });
});

router.post("/admin/payouts/:payoutId/retry", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const id = z.string().uuid().safeParse(req.params["payoutId"]);
  if (!id.success) {
    res.status(400).json({ error: "Invalid payout id" });
    return;
  }
  const updated = await disburseToSeller(id.data);
  if (!updated) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }
  res.json(updated);
});

const MarkPaidBody = z.object({
  reference: z.string().min(1),
  note: z.string().max(500).optional(),
});

router.post("/admin/payouts/:payoutId/mark-paid", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const id = z.string().uuid().safeParse(req.params["payoutId"]);
  if (!id.success) {
    res.status(400).json({ error: "Invalid payout id" });
    return;
  }
  const body = MarkPaidBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(sellerPayoutsTable)
    .set({
      status: "paid",
      paidAt: new Date(),
      reference: body.data.reference,
      manualNote: body.data.note ?? null,
    })
    .where(eq(sellerPayoutsTable.id, id.data))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Payout not found" });
    return;
  }
  res.json(row);
});

export default router;
