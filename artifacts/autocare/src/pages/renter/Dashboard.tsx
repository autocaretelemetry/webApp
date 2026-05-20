import { useMemo } from "react";
import { Link } from "wouter";
import { useListRentalBookings } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { getListRentalBookingsQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  KeyRound,
  CalendarDays,
  PlayCircle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ShieldAlert,
  UserCircle2,
  Car,
} from "lucide-react";
import { formatCurrency, formatDate, resolveImageUrl } from "@/lib/format";

const ACTIVE = new Set([
  "pending_review",
  "contract_pending",
  "awaiting_payment",
  "confirmed",
  "active",
]);

const STATUS_LABEL: Record<string, string> = {
  pending_review: "Awaiting owner review",
  contract_pending: "Sign contract",
  awaiting_payment: "Awaiting payment",
  confirmed: "Confirmed",
  active: "Trip in progress",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Declined",
};

export default function RenterDashboard() {
  const { user } = useAuth();
  const phone = user?.phone ?? "";
  const params = { renterPhone: phone };
  const { data: bookings, isLoading } = useListRentalBookings(params, {
    query: {
      enabled: !!phone,
      queryKey: getListRentalBookingsQueryKey(params),
    },
  });

  const stats = useMemo(() => {
    const all = bookings ?? [];
    let active = 0;
    let completed = 0;
    let pendingAction = 0;
    let lifetimeSpend = 0;
    for (const b of all) {
      if (ACTIVE.has(b.status)) active += 1;
      if (b.status === "completed") {
        completed += 1;
        lifetimeSpend += b.total ?? 0;
      }
      if (b.status === "contract_pending" || b.status === "awaiting_payment") {
        pendingAction += 1;
      }
    }
    return { total: all.length, active, completed, pendingAction, lifetimeSpend };
  }, [bookings]);

  const upcoming = useMemo(() => {
    const all = bookings ?? [];
    return all
      .filter((b) => ACTIVE.has(b.status))
      .sort((a, b) => +new Date(a.startDate) - +new Date(b.startDate))
      .slice(0, 4);
  }, [bookings]);

  const kycVerified = user?.kycStatus === "verified";

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader
        title={`Welcome back, ${user?.name?.split(" ")[0] || "there"}`}
        description="Track your trips, manage your profile, and find your next ride."
        actions={
          <>
            <Link href="/rentals/profile">
              <Button variant="outline">My profile</Button>
            </Link>
            <Link href="/rentals">
              <Button>Browse cars</Button>
            </Link>
          </>
        }
      />

      {!kycVerified && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldAlert className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-sm">Finish your renter profile</div>
              <p className="text-sm text-muted-foreground mt-1">
                Upload your government ID (and driver's licence for self-drive rentals) so you can
                book a car.
              </p>
            </div>
            <Link href="/rentals/profile">
              <Button size="sm" variant="outline">
                Complete profile
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active rentals</CardTitle>
            <PlayCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs your action</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingAction}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Trips completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Lifetime spend</CardTitle>
            <KeyRound className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.lifetimeSpend)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="h-5 w-5" /> Upcoming & active trips
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground py-6">Loading your trips...</div>
            ) : upcoming.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center space-y-3">
                <p>No upcoming trips.</p>
                <Link href="/rentals">
                  <Button size="sm">Find a car</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {upcoming.map((b) => (
                  <Link key={b.id} href={`/rentals/${b.id}`}>
                    <div className="flex items-center gap-4 border rounded-lg p-3 hover:bg-accent/30 transition cursor-pointer">
                      <div className="h-14 w-14 rounded-md bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                        {b.carImageUrl ? (
                          <img
                            src={resolveImageUrl(b.carImageUrl)}
                            alt={b.carLabel ?? "Car"}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Car className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">
                          {b.carLabel ?? "Rental"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {formatDate(b.startDate)} — {formatDate(b.endDate)}
                        </div>
                      </div>
                      <div className="text-xs font-medium text-right shrink-0">
                        {STATUS_LABEL[b.status] ?? b.status}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              {kycVerified ? (
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
              ) : (
                <UserCircle2 className="h-5 w-5" />
              )}{" "}
              My profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Name</div>
              <div className="font-medium">{user?.name || "Not set"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Phone</div>
              <div className="font-medium">{user?.phone || "Not set"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                KYC status
              </div>
              <div className="font-medium capitalize">
                {user?.kycStatus?.replace("_", " ") ?? "Not submitted"}
              </div>
            </div>
            <Link href="/rentals/profile">
              <Button variant="outline" size="sm" className="w-full mt-2">
                Manage profile
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
