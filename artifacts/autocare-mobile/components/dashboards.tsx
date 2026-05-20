import React from "react";
import { View, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import {
  useGetOwnerDashboard,
  useGetCenterDashboard,
  useGetVendorDashboard,
  useGetAdminOverview,
  useListVehicles,
  useListBookings,
  useListServiceCenters,
  useListVendors,
  useListOrders,
  getGetVendorDashboardQueryKey,
} from "@workspace/api-client-react";

import { Card, EmptyState, LoadingScreen, Row, Section, StatTile, Badge } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { ROLE_TAGLINE, type Role } from "@/lib/roles";

type DashboardProps = { token: string; phone?: string | null };

function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{children}</View>
  );
}

function ErrorCard({ title, body }: { title: string; body?: string }) {
  return <EmptyState title={title} body={body} />;
}

function statusTone(s: string | undefined): "primary" | "muted" | "success" | "warning" | "destructive" {
  switch (s) {
    case "completed":
    case "approved":
    case "paid":
    case "delivered":
      return "success";
    case "in_progress":
    case "accepted":
    case "shipped":
      return "primary";
    case "awaiting_approval":
    case "requested":
    case "pending":
      return "warning";
    case "cancelled":
    case "rejected":
      return "destructive";
    default:
      return "muted";
  }
}

/* -------------------- Owner -------------------- */
function OwnerDashboard() {
  const { data, isLoading, error } = useGetOwnerDashboard();
  const vehicles = useListVehicles();
  const d = data as
    | {
        totalVehicles?: number;
        statusCounts?: Record<string, number>;
        upcomingReminders?: Array<{ vehicleId?: string; title?: string; dueLabel?: string }>;
      }
    | undefined;
  if (isLoading) return <LoadingScreen />;
  if (error) return <ErrorCard title="Couldn't load dashboard" body="Pull to retry." />;
  const status = d?.statusCounts ?? {};
  const upcoming = d?.upcomingReminders ?? [];
  const list = (vehicles.data ?? []) as Array<{ id: string; year?: number; make?: string; model?: string; plate?: string }>;
  return (
    <View style={{ gap: 18 }}>
      <StatRow>
        <StatTile label="Vehicles" value={d?.totalVehicles ?? list.length} />
        <StatTile label="Active jobs" value={status["in_progress"] ?? 0} />
        <StatTile label="Awaiting approval" value={status["awaiting_approval"] ?? 0} />
      </StatRow>
      <Section title="Upcoming reminders">
        {upcoming.length === 0 ? (
          <EmptyState title="No reminders due" body="We'll alert you when service is coming up." />
        ) : (
          <Card padding={0}>
            {upcoming.slice(0, 5).map((r, i) => (
              <View
                key={`${r.vehicleId ?? "x"}-${i}`}
                style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}
              >
                <Row title={r.title ?? "Service reminder"} subtitle={r.dueLabel} />
              </View>
            ))}
          </Card>
        )}
      </Section>
      <Section title="My garage">
        {list.length === 0 ? (
          <EmptyState title="No vehicles yet" body="Add a vehicle from the web app to get started." />
        ) : (
          <Card padding={0}>
            {list.slice(0, 6).map((v, i) => (
              <View
                key={v.id}
                style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}
              >
                <Row
                  title={`${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || "Vehicle"}
                  subtitle={v.plate ?? undefined}
                />
              </View>
            ))}
          </Card>
        )}
      </Section>
    </View>
  );
}

/* -------------------- Center -------------------- */
function CenterDashboard() {
  const { data, isLoading, error } = useGetCenterDashboard();
  const d = data as
    | {
        statusCounts?: Record<string, number>;
        queue?: Array<{ id: string; vehicleLabel?: string; status?: string }>;
        revenueThisMonthCents?: number;
      }
    | undefined;
  if (isLoading) return <LoadingScreen />;
  if (error) return <ErrorCard title="Couldn't load center dashboard" />;
  const sc = d?.statusCounts ?? {};
  const queue = d?.queue ?? [];
  return (
    <View style={{ gap: 18 }}>
      <StatRow>
        <StatTile label="Requested" value={sc["requested"] ?? 0} />
        <StatTile label="In progress" value={sc["in_progress"] ?? 0} />
        <StatTile label="Awaiting approval" value={sc["awaiting_approval"] ?? 0} />
        <StatTile
          label="This month"
          value={`GHS ${(((d?.revenueThisMonthCents ?? 0) as number) / 100).toFixed(0)}`}
        />
      </StatRow>
      <Section title="Active queue">
        {queue.length === 0 ? (
          <EmptyState title="Queue is clear" body="No active jobs right now." />
        ) : (
          <Card padding={0}>
            {queue.slice(0, 8).map((b, i) => (
              <View
                key={b.id}
                style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}
              >
                <Row
                  title={b.vehicleLabel ?? "Booking"}
                  subtitle={`#${b.id.slice(0, 8)}`}
                  badge={{ label: (b.status ?? "").replaceAll("_", " "), tone: statusTone(b.status) }}
                />
              </View>
            ))}
          </Card>
        )}
      </Section>
    </View>
  );
}

/* -------------------- Vendor -------------------- */
function VendorDashboard({ token, phone }: DashboardProps) {
  const vendors = useListVendors();
  const vendorList = (vendors.data as Array<{ id: string; contactPhone?: string | null }>) ?? [];
  const vendorId =
    vendorList.find((v) => phone && v.contactPhone === phone)?.id ?? vendorList[0]?.id;
  const { data, isLoading, error } = useGetVendorDashboard(vendorId ?? "", {
    query: {
      enabled: !!vendorId,
      queryKey: getGetVendorDashboardQueryKey(vendorId ?? ""),
    },
  });
  void token;
  const d = data as
    | {
        totalParts?: number;
        openOrders?: number;
        revenueThisMonthCents?: number;
        recentOrders?: Array<{ id: string; buyerName?: string; status?: string }>;
      }
    | undefined;
  if (vendors.isLoading || (vendorId && isLoading)) return <LoadingScreen />;
  if (!vendorId) {
    return <EmptyState title="No vendor profile" body="Your vendor profile hasn't been provisioned yet." />;
  }
  if (error) return <ErrorCard title="Couldn't load vendor dashboard" />;
  const orders = d?.recentOrders ?? [];
  return (
    <View style={{ gap: 18 }}>
      <StatRow>
        <StatTile label="Listed parts" value={d?.totalParts ?? 0} />
        <StatTile label="Open orders" value={d?.openOrders ?? 0} />
        <StatTile
          label="Revenue (mo.)"
          value={`GHS ${(((d?.revenueThisMonthCents ?? 0) as number) / 100).toFixed(0)}`}
        />
      </StatRow>
      <Section title="Recent orders">
        {orders.length === 0 ? (
          <EmptyState title="No orders yet" body="Orders will appear here as they come in." />
        ) : (
          <Card padding={0}>
            {orders.slice(0, 8).map((o, i) => (
              <View
                key={o.id}
                style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}
              >
                <Row
                  title={o.buyerName ?? "Buyer"}
                  subtitle={`#${o.id.slice(0, 8)}`}
                  badge={{ label: (o.status ?? "").replaceAll("_", " "), tone: statusTone(o.status) }}
                />
              </View>
            ))}
          </Card>
        )}
      </Section>
    </View>
  );
}

/* -------------------- Renter -------------------- */
function RenterDashboard({ token }: DashboardProps) {
  const cars = useQuery({
    queryKey: ["rental-cars-mobile"],
    queryFn: async () => {
      const r = await fetch(`/api/rental-cars?limit=10`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!r.ok) throw new Error("rental cars");
      return (await r.json()) as Array<{ id: string; year?: number; make?: string; model?: string; dailyRate?: number }>;
    },
  });
  const trips = useQuery({
    queryKey: ["rental-bookings-mine"],
    queryFn: async () => {
      const r = await fetch(`/api/rental-bookings?mine=true`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!r.ok) return [];
      return (await r.json()) as Array<{ id: string; status?: string; startsAt?: string; carLabel?: string }>;
    },
  });
  const carList = cars.data ?? [];
  const tripList = trips.data ?? [];
  const active = tripList.filter((t) => t.status === "active" || t.status === "confirmed");
  return (
    <View style={{ gap: 18 }}>
      <StatRow>
        <StatTile label="Active trips" value={active.length} />
        <StatTile label="Total bookings" value={tripList.length} />
        <StatTile label="Cars available" value={carList.length} />
      </StatRow>
      <Section title="My trips">
        {tripList.length === 0 ? (
          <EmptyState title="No trips yet" body="Browse cars from the Browse tab to book your first rental." />
        ) : (
          <Card padding={0}>
            {tripList.slice(0, 6).map((t, i) => (
              <View
                key={t.id}
                style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}
              >
                <Row
                  title={t.carLabel ?? "Trip"}
                  subtitle={t.startsAt ? new Date(t.startsAt).toLocaleString() : undefined}
                  badge={{ label: (t.status ?? "").replaceAll("_", " "), tone: statusTone(t.status) }}
                />
              </View>
            ))}
          </Card>
        )}
      </Section>
    </View>
  );
}

/* -------------------- Fleet -------------------- */
function FleetDashboard({ token }: DashboardProps) {
  const orgs = useQuery({
    queryKey: ["my-organizations"],
    queryFn: async () => {
      const r = await fetch(`/api/organizations/mine`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!r.ok) return [];
      return (await r.json()) as Array<{ id: string; name: string }>;
    },
  });
  const list = orgs.data ?? [];
  const orgId = list[0]?.id;
  const dash = useQuery({
    queryKey: ["fleet-dashboard", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const r = await fetch(`/api/organizations/${orgId}/dashboard`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!r.ok) return null;
      return (await r.json()) as {
        vehicleCount?: number;
        activeJobs?: number;
        upcomingReminders?: Array<{ title?: string; dueLabel?: string }>;
        partsSpendCents?: number;
      };
    },
  });
  if (!list.length) {
    return <EmptyState title="No fleet found" body="Register a fleet from the web app to get started." />;
  }
  const d = dash.data;
  return (
    <View style={{ gap: 18 }}>
      <Card>
        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 18 }}>{list[0]?.name}</Text>
      </Card>
      <StatRow>
        <StatTile label="Vehicles" value={d?.vehicleCount ?? "—"} />
        <StatTile label="Active jobs" value={d?.activeJobs ?? "—"} />
        <StatTile
          label="Parts (mo.)"
          value={d?.partsSpendCents == null ? "—" : `GHS ${(d.partsSpendCents / 100).toFixed(0)}`}
        />
      </StatRow>
      <Section title="Reminders">
        {(d?.upcomingReminders ?? []).length === 0 ? (
          <EmptyState title="No reminders due" />
        ) : (
          <Card padding={0}>
            {(d?.upcomingReminders ?? []).slice(0, 5).map((r, i) => (
              <View key={i} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
                <Row title={r.title ?? "Reminder"} subtitle={r.dueLabel} />
              </View>
            ))}
          </Card>
        )}
      </Section>
    </View>
  );
}

/* -------------------- Delivery -------------------- */
function DeliveryDashboard({ token }: DashboardProps) {
  const jobs = useQuery({
    queryKey: ["delivery-jobs"],
    queryFn: async () => {
      const r = await fetch(`/api/orders?mine=true&assigned=true`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!r.ok) return [];
      return (await r.json()) as Array<{ id: string; status?: string; buyerName?: string; shippingAddress?: string }>;
    },
  });
  const list = jobs.data ?? [];
  const active = list.filter((o) => o.status === "shipped" || o.status === "ready_for_pickup");
  return (
    <View style={{ gap: 18 }}>
      <StatRow>
        <StatTile label="Active jobs" value={active.length} />
        <StatTile label="Total assigned" value={list.length} />
      </StatRow>
      <Section title="Assigned deliveries">
        {list.length === 0 ? (
          <EmptyState title="No deliveries" body="Pickup jobs will appear here when assigned." />
        ) : (
          <Card padding={0}>
            {list.slice(0, 10).map((j, i) => (
              <View key={j.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
                <Row
                  title={j.buyerName ?? "Customer"}
                  subtitle={j.shippingAddress}
                  badge={{ label: (j.status ?? "").replaceAll("_", " "), tone: statusTone(j.status) }}
                />
              </View>
            ))}
          </Card>
        )}
      </Section>
    </View>
  );
}

/* -------------------- Admin / Super Admin -------------------- */
function AdminDashboard() {
  const { data, isLoading } = useGetAdminOverview();
  const centers = useListServiceCenters();
  if (isLoading) return <LoadingScreen />;
  const o = data as
    | {
        users?: number;
        vehicles?: number;
        bookingsThisMonth?: number;
        revenueCents?: number;
      }
    | undefined;
  return (
    <View style={{ gap: 18 }}>
      <StatRow>
        <StatTile label="Users" value={o?.users ?? "—"} />
        <StatTile label="Vehicles" value={o?.vehicles ?? "—"} />
        <StatTile label="Bookings (mo.)" value={o?.bookingsThisMonth ?? "—"} />
        <StatTile
          label="GMV (mo.)"
          value={o?.revenueCents == null ? "—" : `GHS ${(o.revenueCents / 100).toFixed(0)}`}
        />
      </StatRow>
      <Section title="Service centers">
        <Card padding={0}>
          {((centers.data as Array<{ id: string; name: string; city?: string }>) ?? []).slice(0, 8).map((c, i) => (
            <View key={c.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
              <Row title={c.name} subtitle={c.city} />
            </View>
          ))}
        </Card>
      </Section>
    </View>
  );
}

/* -------------------- Router -------------------- */
export function RoleDashboard({
  role,
  token,
  phone,
}: {
  role: Role;
  token: string | null;
  phone?: string | null;
}) {
  const c = useColors();
  const safeToken = token ?? "";
  let body: React.ReactNode;
  switch (role) {
    case "owner":
      body = <OwnerDashboard />;
      break;
    case "center":
      body = <CenterDashboard />;
      break;
    case "vendor":
      body = <VendorDashboard token={safeToken} phone={phone} />;
      break;
    case "renter":
      body = <RenterDashboard token={safeToken} phone={phone} />;
      break;
    case "fleet":
      body = <FleetDashboard token={safeToken} phone={phone} />;
      break;
    case "delivery":
      body = <DeliveryDashboard token={safeToken} phone={phone} />;
      break;
    case "admin":
    case "super_admin":
      body = <AdminDashboard />;
      break;
    default:
      body = <EmptyState title="No dashboard for this role yet" />;
  }
  return (
    <View style={{ gap: 18 }}>
      <View>
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "Inter_500Medium",
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: 0.8,
          }}
        >
          {ROLE_TAGLINE[role]}
        </Text>
      </View>
      {body}
    </View>
  );
}

/* -------------------- Shared lists for tabs -------------------- */
export function WorkList({ role, token }: { role: Role; token: string | null }) {
  const safeToken = token ?? "";
  if (role === "owner" || role === "center" || role === "admin" || role === "super_admin") {
    return <BookingsList />;
  }
  if (role === "vendor") {
    return <OrdersList />;
  }
  if (role === "renter") {
    return <MyTripsList token={safeToken} />;
  }
  if (role === "delivery") {
    return <DeliveryJobsList token={safeToken} />;
  }
  if (role === "fleet") {
    return <FleetVehiclesList token={safeToken} />;
  }
  return <EmptyState title="Nothing here yet" />;
}

function BookingsList() {
  const { data, isLoading } = useListBookings();
  if (isLoading) return <LoadingScreen />;
  const list = (data as Array<{
    id: string;
    status?: string;
    vehicleLabel?: string;
    serviceCenterName?: string;
    scheduledAt?: string;
  }>) ?? [];
  if (list.length === 0) return <EmptyState title="No service bookings" body="Create one from the web dashboard." />;
  return (
    <Card padding={0}>
      {list.slice(0, 30).map((b, i) => (
        <View key={b.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
          <Row
            title={b.vehicleLabel ?? "Booking"}
            subtitle={[b.serviceCenterName, b.scheduledAt ? new Date(b.scheduledAt).toLocaleString() : null]
              .filter(Boolean)
              .join("  ·  ")}
            badge={{ label: (b.status ?? "").replaceAll("_", " "), tone: statusTone(b.status) }}
          />
        </View>
      ))}
    </Card>
  );
}

function OrdersList() {
  const { data, isLoading } = useListOrders();
  if (isLoading) return <LoadingScreen />;
  const list = (data as Array<{ id: string; status?: string; buyerName?: string; totalCents?: number }>) ?? [];
  if (list.length === 0) return <EmptyState title="No orders" />;
  return (
    <Card padding={0}>
      {list.slice(0, 30).map((o, i) => (
        <View key={o.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
          <Row
            title={o.buyerName ?? "Buyer"}
            subtitle={o.totalCents != null ? `GHS ${(o.totalCents / 100).toFixed(2)}` : undefined}
            badge={{ label: (o.status ?? "").replaceAll("_", " "), tone: statusTone(o.status) }}
          />
        </View>
      ))}
    </Card>
  );
}

function MyTripsList({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ["my-trips"],
    queryFn: async () => {
      const r = await fetch(`/api/rental-bookings?mine=true`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!r.ok) return [];
      return (await r.json()) as Array<{ id: string; status?: string; carLabel?: string; startsAt?: string }>;
    },
  });
  if (q.isLoading) return <LoadingScreen />;
  const list = q.data ?? [];
  if (list.length === 0) return <EmptyState title="No trips yet" body="Browse cars to book." />;
  return (
    <Card padding={0}>
      {list.map((t, i) => (
        <View key={t.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
          <Row
            title={t.carLabel ?? "Trip"}
            subtitle={t.startsAt ? new Date(t.startsAt).toLocaleString() : undefined}
            badge={{ label: (t.status ?? "").replaceAll("_", " "), tone: statusTone(t.status) }}
          />
        </View>
      ))}
    </Card>
  );
}

function DeliveryJobsList({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ["delivery-jobs-list"],
    queryFn: async () => {
      const r = await fetch(`/api/orders?mine=true&assigned=true`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!r.ok) return [];
      return (await r.json()) as Array<{ id: string; status?: string; buyerName?: string; shippingAddress?: string }>;
    },
  });
  if (q.isLoading) return <LoadingScreen />;
  const list = q.data ?? [];
  if (list.length === 0) return <EmptyState title="No deliveries assigned" />;
  return (
    <Card padding={0}>
      {list.map((j, i) => (
        <View key={j.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
          <Row
            title={j.buyerName ?? "Customer"}
            subtitle={j.shippingAddress}
            badge={{ label: (j.status ?? "").replaceAll("_", " "), tone: statusTone(j.status) }}
          />
        </View>
      ))}
    </Card>
  );
}

function FleetVehiclesList({ token }: { token: string }) {
  const orgs = useQuery({
    queryKey: ["my-organizations-fleetlist"],
    queryFn: async () => {
      const r = await fetch(`/api/organizations/mine`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!r.ok) return [];
      return (await r.json()) as Array<{ id: string }>;
    },
  });
  const orgId = orgs.data?.[0]?.id;
  const vehicles = useQuery({
    queryKey: ["fleet-vehicles", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const r = await fetch(`/api/organizations/${orgId}/vehicles`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!r.ok) return [];
      return (await r.json()) as Array<{ id: string; make?: string; model?: string; plate?: string }>;
    },
  });
  if (vehicles.isLoading) return <LoadingScreen />;
  const list = vehicles.data ?? [];
  if (list.length === 0) return <EmptyState title="No vehicles in fleet" />;
  return (
    <Card padding={0}>
      {list.map((v, i) => (
        <View key={v.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
          <Row title={`${v.make ?? ""} ${v.model ?? ""}`.trim() || "Vehicle"} subtitle={v.plate} />
        </View>
      ))}
    </Card>
  );
}
