import { and, desc, eq } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  subscriptionPlansTable,
  vehiclesTable,
  DEFAULT_PLAN_LIMITS,
  type PlanLimits,
} from "@workspace/db";

export type { PlanLimits };

/**
 * Sensible free-tier caps for subscribers without an active subscription.
 * Tuned so that an unsubscribed account can still try the product but feels
 * the squeeze quickly enough to convert. Tweak here — never inline.
 */
const FREE_LIMITS: Record<"center" | "vendor" | "owner", PlanLimits> = {
  center: {
    ...DEFAULT_PLAN_LIMITS,
    maxBookingsPerMonth: 10,
  },
  vendor: {
    ...DEFAULT_PLAN_LIMITS,
    maxPartsListed: 25,
  },
  owner: {
    ...DEFAULT_PLAN_LIMITS,
  },
};

export type SubscriberKind = "center" | "vendor" | "owner";

/**
 * Resolve the active plan limits for a subscriber. Falls back to the free
 * tier for that audience when there is no active subscription.
 *
 * Every gated server action (booking quota, parts quota, featured sort,
 * history export, priority booking) should funnel through this function so
 * plan logic lives in one place.
 */
export async function getEntitlements(
  kind: SubscriberKind,
  subscriberId: string,
): Promise<PlanLimits> {
  // If a subscriber somehow has more than one active subscription (the
  // POST /subscriptions route doesn't currently enforce single-active),
  // we deterministically pick the most-recently started one so quotas
  // and feature flags don't oscillate request-to-request.
  const [row] = await db
    .select({ limits: subscriptionPlansTable.limits })
    .from(subscriptionsTable)
    .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
    .where(
      and(
        eq(subscriptionsTable.subscriberKind, kind),
        eq(subscriptionsTable.subscriberId, subscriberId),
        eq(subscriptionsTable.status, "active"),
        eq(subscriptionPlansTable.active, true),
      ),
    )
    .orderBy(desc(subscriptionsTable.startedAt))
    .limit(1);
  if (!row) return FREE_LIMITS[kind];
  // Merge over defaults so older plans missing newer fields still resolve.
  return { ...DEFAULT_PLAN_LIMITS, ...row.limits };
}

/**
 * Map a vehicle to the owner-subscription subscriberId we match on. We use
 * `ownerPhone` as the canonical owner identity — it's what renter logins
 * authenticate against and what owner subscriptions are keyed by.
 */
export async function getOwnerEntitlementsForVehicle(
  vehicleId: string,
): Promise<{ ownerPhone: string | null; limits: PlanLimits }> {
  const [v] = await db
    .select({ ownerPhone: vehiclesTable.ownerPhone })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId));
  if (!v?.ownerPhone) {
    return { ownerPhone: v?.ownerPhone ?? null, limits: FREE_LIMITS.owner };
  }
  const limits = await getEntitlements("owner", v.ownerPhone);
  return { ownerPhone: v.ownerPhone, limits };
}

/**
 * Set membership helper: which of the given subscriberIds have an active
 * featured-placement entitlement? Returns a Set for O(1) lookup in list
 * orderings. Centers and vendors only — owners don't appear in directories.
 */
export async function featuredSubscriberIds(
  kind: "center" | "vendor",
  candidateIds: string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  const rows = await db
    .select({
      subscriberId: subscriptionsTable.subscriberId,
      limits: subscriptionPlansTable.limits,
    })
    .from(subscriptionsTable)
    .innerJoin(subscriptionPlansTable, eq(subscriptionsTable.planId, subscriptionPlansTable.id))
    .where(
      and(
        eq(subscriptionsTable.subscriberKind, kind),
        eq(subscriptionsTable.status, "active"),
        eq(subscriptionPlansTable.active, true),
      ),
    );
  const out = new Set<string>();
  for (const r of rows) {
    if (r.limits?.featuredPlacement && candidateIds.includes(r.subscriberId)) {
      out.add(r.subscriberId);
    }
  }
  return out;
}
