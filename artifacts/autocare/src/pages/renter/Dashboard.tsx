import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListRentalBookings,
  useGetRenterProfileByPhone,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  getListRentalBookingsQueryKey,
  getGetRenterProfileByPhoneQueryKey,
} from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  IdCard,
  History,
} from "lucide-react";
import { formatCurrency, formatDate, resolveImageUrl } from "@/lib/format";
import { getRecentlyViewedCars, type RecentCar } from "@/lib/recentCars";

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

  // Pull the persisted renter profile so we can surface explicit
  // driver's-licence status separately from the broader KYC state.
  const { data: renterProfile } = useGetRenterProfileByPhone(phone, {
    query: {
      enabled: !!phone,
      queryKey: getGetRenterProfileByPhoneQueryKey(phone),
      retry: false,
    },
  });

  const [recent, setRecent] = useState<RecentCar[]>([]);
  useEffect(() => {
    setRecent(getRecentlyViewedCars());
    const handler = () => setRecent(getRecentlyViewedCars());
    window.addEventListener("renter:recentCars-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("renter:recentCars-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

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
  const licenceOnFile = Boolean(
    renterProfile?.driverLicenseNumber?.trim() &&
      renterProfile?.driverLicenseUrl?.trim(),
  );

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
                  <Link key={b.id} href="/rentals/my-bookings">
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
              Verification status
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
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Identity (KYC)
                </div>
                <div className="font-medium capitalize">
                  {user?.kycStatus?.replace("_", " ") ?? "Not submitted"}
                </div>
              </div>
              {kycVerified ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">Verified</Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/60 text-amber-700">
                  Action needed
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <IdCard className="h-3.5 w-3.5" /> Driver's licence
                </div>
                <div className="font-medium">
                  {licenceOnFile ? "On file" : "Not uploaded"}
                </div>
                {!licenceOnFile && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Required only for self-drive trips.
                  </div>
                )}
              </div>
              {licenceOnFile ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">Ready</Badge>
              ) : (
                <Badge variant="outline">Optional</Badge>
              )}
            </div>
            <Link href="/rentals/profile">
              <Button variant="outline" size="sm" className="w-full mt-2">
                Manage profile
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="h-5 w-5" /> Recently viewed cars
          </CardTitle>
          <Link href="/rentals">
            <Button variant="ghost" size="sm">
              Browse all
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center space-y-3">
              <p>Cars you open will show up here so you can come back to them.</p>
              <Link href="/rentals">
                <Button size="sm" variant="outline">
                  Start browsing
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((c) => (
                <Link key={c.id} href={`/rentals/${c.id}`}>
                  <div className="border rounded-lg overflow-hidden hover:bg-accent/30 transition cursor-pointer">
                    <div className="h-28 bg-muted flex items-center justify-center">
                      {c.imageUrl ? (
                        <img
                          src={resolveImageUrl(c.imageUrl)}
                          alt={c.label}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Car className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <div className="p-3">
                      <div className="font-semibold text-sm truncate">{c.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate">{c.city ?? ""}</span>
                        {c.dailyRate != null && (
                          <span className="font-medium text-foreground shrink-0">
                            {formatCurrency(c.dailyRate)}/day
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
