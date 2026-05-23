import { Router, type IRouter } from "express";
import { desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import {
  db,
  commissionRatesTable,
  commissionLedgerTable,
  COMMISSION_SALE_KINDS,
} from "@workspace/db";

const router: IRouter = Router();

function requireSuperAdmin(
  req: import("express").Request,
  res: import("express").Response,
): boolean {
  if (req.user?.role !== "super_admin") {
    res.status(403).json({ error: "Super admin only." });
    return false;
  }
  return true;
}

const SaleKindParam = z.object({
  saleKind: z.enum(COMMISSION_SALE_KINDS),
});

const UpdateRateBody = z.object({
  percent: z.number().min(0).max(100),
});

router.get("/admin/commission-rates", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const rows = await db.select().from(commissionRatesTable);
  const byKind = new Map(rows.map((r) => [r.saleKind, r] as const));
  // Always return one entry per known kind, defaulting to 0% so the UI
  // can render the full matrix even before any rates are saved.
  const result = COMMISSION_SALE_KINDS.map((kind) => {
    const existing = byKind.get(kind);
    return existing
      ? {
          saleKind: existing.saleKind,
          percent: existing.percent,
          updatedAt: existing.updatedAt,
        }
      : { saleKind: kind, percent: 0, updatedAt: null };
  });
  res.json(result);
});

router.put(
  "/admin/commission-rates/:saleKind",
  requireAuth,
  async (req, res): Promise<void> => {
    if (!requireSuperAdmin(req, res)) return;
    const params = SaleKindParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = UpdateRateBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const now = new Date();
    const [row] = await db
      .insert(commissionRatesTable)
      .values({
        saleKind: params.data.saleKind,
        percent: body.data.percent,
        updatedAt: now,
        updatedByUserId: req.user?.id ?? null,
      })
      .onConflictDoUpdate({
        target: commissionRatesTable.saleKind,
        set: {
          percent: body.data.percent,
          updatedAt: now,
          updatedByUserId: req.user?.id ?? null,
        },
      })
      .returning();
    res.json({
      saleKind: row.saleKind,
      percent: row.percent,
      updatedAt: row.updatedAt,
    });
  },
);

router.get("/admin/commission-ledger", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const rows = await db
    .select()
    .from(commissionLedgerTable)
    .orderBy(desc(commissionLedgerTable.createdAt))
    .limit(500);
  const totals = await db
    .select({
      saleKind: commissionLedgerTable.saleKind,
      gross: sql<number>`coalesce(sum(${commissionLedgerTable.grossAmount}), 0)::float`,
      commission: sql<number>`coalesce(sum(${commissionLedgerTable.commissionAmount}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(commissionLedgerTable)
    .groupBy(commissionLedgerTable.saleKind);
  res.json({ entries: rows, totals });
});

export default router;
