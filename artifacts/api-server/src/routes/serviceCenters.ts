import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  serviceCentersTable,
  mechanicsTable,
  bookingsTable,
} from "@workspace/db";
import {
  ListServiceCentersQueryParams,
  GetServiceCenterParams,
  ListMechanicsForCenterParams,
  GetMechanicParams,
  UpdateServiceCenterBody,
  UpdateServiceCenterParams,
  UpdateServiceCenterSettingsBody,
  UpdateServiceCenterSettingsParams,
  DeleteServiceCenterParams,
  UpdateMechanicBody,
  UpdateMechanicParams,
  DeleteMechanicParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function openJobsByCenter(centerIds: string[]): Promise<Map<string, number>> {
  if (centerIds.length === 0) return new Map();
  const rows = await db
    .select({
      centerId: bookingsTable.serviceCenterId,
      n: count(bookingsTable.id),
    })
    .from(bookingsTable)
    .where(
      and(
        inArray(bookingsTable.serviceCenterId, centerIds),
        ne(bookingsTable.status, "completed"),
        ne(bookingsTable.status, "cancelled"),
      ),
    )
    .groupBy(bookingsTable.serviceCenterId);
  return new Map(rows.map((r) => [r.centerId, Number(r.n)]));
}

router.get("/service-centers", async (req, res): Promise<void> => {
  const q = ListServiceCentersQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  // Suspended centers are hidden from owners during browse/booking; admin
  // pages pass includeInactive=true to see them.
  const includeInactive = req.query.includeInactive === "true";
  const activeFilter = includeInactive
    ? undefined
    : eq(serviceCentersTable.active, true);

  const rows = q.data.specialty
    ? await db
        .select()
        .from(serviceCentersTable)
        .where(
          and(
            sql`${q.data.specialty} = ANY(${serviceCentersTable.specialties})`,
            activeFilter,
          ),
        )
        .orderBy(desc(serviceCentersTable.rating))
    : await db
        .select()
        .from(serviceCentersTable)
        .where(activeFilter)
        .orderBy(desc(serviceCentersTable.rating));

  const openMap = await openJobsByCenter(rows.map((r) => r.id));
  res.json(rows.map((r) => ({ ...r, openJobs: openMap.get(r.id) ?? 0 })));
});

router.get("/service-centers/:centerId", async (req, res): Promise<void> => {
  const params = GetServiceCenterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(serviceCentersTable)
    .where(eq(serviceCentersTable.id, params.data.centerId));
  if (!row) {
    res.status(404).json({ error: "Service center not found" });
    return;
  }
  const openMap = await openJobsByCenter([row.id]);
  res.json({ ...row, openJobs: openMap.get(row.id) ?? 0 });
});

router.patch(
  "/service-centers/:centerId/settings",
  async (req, res): Promise<void> => {
    const params = UpdateServiceCenterSettingsParams.safeParse(req.params);
    const body = UpdateServiceCenterSettingsBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res
        .status(400)
        .json({ error: (params.success ? body : params).error!.message });
      return;
    }
    const updates: Partial<typeof serviceCentersTable.$inferInsert> = {};
    if (body.data.whatsappOptIn !== undefined)
      updates.whatsappOptIn = body.data.whatsappOptIn;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No settings provided" });
      return;
    }
    const [row] = await db
      .update(serviceCentersTable)
      .set(updates)
      .where(eq(serviceCentersTable.id, params.data.centerId))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Service center not found" });
      return;
    }
    const openMap = await openJobsByCenter([row.id]);
    res.json({ ...row, openJobs: openMap.get(row.id) ?? 0 });
  },
);

router.patch("/service-centers/:centerId", async (req, res): Promise<void> => {
  const params = UpdateServiceCenterParams.safeParse(req.params);
  const body = UpdateServiceCenterBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res
      .status(400)
      .json({ error: (params.success ? body : params).error!.message });
    return;
  }
  const [row] = await db
    .update(serviceCentersTable)
    .set({ active: body.data.active })
    .where(eq(serviceCentersTable.id, params.data.centerId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Service center not found" });
    return;
  }
  const openMap = await openJobsByCenter([row.id]);
  res.json({ ...row, openJobs: openMap.get(row.id) ?? 0 });
});

router.delete("/service-centers/:centerId", async (req, res): Promise<void> => {
  const params = DeleteServiceCenterParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Bookings cascade-delete from centers; that would silently nuke history.
  // Force admin to suspend whenever any booking exists.
  const [bookingsRow] = await db
    .select({ n: count() })
    .from(bookingsTable)
    .where(eq(bookingsTable.serviceCenterId, params.data.centerId));
  const [mechanicsRow] = await db
    .select({ n: count() })
    .from(mechanicsTable)
    .where(eq(mechanicsTable.serviceCenterId, params.data.centerId));
  const bookingsN = Number(bookingsRow?.n ?? 0);
  const mechanicsN = Number(mechanicsRow?.n ?? 0);
  if (bookingsN > 0 || mechanicsN > 0) {
    res.status(409).json({
      error: "Service center has dependent records",
      reason: "has_dependents",
      details: `${bookingsN} booking(s) and ${mechanicsN} mechanic(s) reference this center. Suspend instead.`,
    });
    return;
  }
  const deleted = await db
    .delete(serviceCentersTable)
    .where(eq(serviceCentersTable.id, params.data.centerId))
    .returning({ id: serviceCentersTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Service center not found" });
    return;
  }
  res.status(204).end();
});

router.get(
  "/service-centers/:centerId/mechanics",
  async (req, res): Promise<void> => {
    const params = ListMechanicsForCenterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    // Suspended mechanics shouldn't be assignable from the center's roster.
    const rows = await db
      .select()
      .from(mechanicsTable)
      .where(
        and(
          eq(mechanicsTable.serviceCenterId, params.data.centerId),
          eq(mechanicsTable.active, true),
        ),
      )
      .orderBy(desc(mechanicsTable.rating));
    res.json(rows);
  },
);

router.get("/mechanics/:mechanicId", async (req, res): Promise<void> => {
  const params = GetMechanicParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(mechanicsTable)
    .where(eq(mechanicsTable.id, params.data.mechanicId));
  if (!row) {
    res.status(404).json({ error: "Mechanic not found" });
    return;
  }
  res.json(row);
});

router.patch("/mechanics/:mechanicId", async (req, res): Promise<void> => {
  const params = UpdateMechanicParams.safeParse(req.params);
  const body = UpdateMechanicBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res
      .status(400)
      .json({ error: (params.success ? body : params).error!.message });
    return;
  }
  const [row] = await db
    .update(mechanicsTable)
    .set({ active: body.data.active })
    .where(eq(mechanicsTable.id, params.data.mechanicId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Mechanic not found" });
    return;
  }
  res.json(row);
});

router.delete("/mechanics/:mechanicId", async (req, res): Promise<void> => {
  const params = DeleteMechanicParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // bookings.mechanicId / orders.mechanicId both ON DELETE SET NULL — hard
  // delete is safe and preserves the booking/order history detached.
  const deleted = await db
    .delete(mechanicsTable)
    .where(eq(mechanicsTable.id, params.data.mechanicId))
    .returning({ id: mechanicsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Mechanic not found" });
    return;
  }
  res.status(204).end();
});

export default router;
