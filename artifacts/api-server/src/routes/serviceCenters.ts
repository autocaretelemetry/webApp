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

  const rows = q.data.specialty
    ? await db
        .select()
        .from(serviceCentersTable)
        .where(sql`${q.data.specialty} = ANY(${serviceCentersTable.specialties})`)
        .orderBy(desc(serviceCentersTable.rating))
    : await db
        .select()
        .from(serviceCentersTable)
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

router.get(
  "/service-centers/:centerId/mechanics",
  async (req, res): Promise<void> => {
    const params = ListMechanicsForCenterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const rows = await db
      .select()
      .from(mechanicsTable)
      .where(eq(mechanicsTable.serviceCenterId, params.data.centerId))
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

export default router;
