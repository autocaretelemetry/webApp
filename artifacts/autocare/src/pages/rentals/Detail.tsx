import { useEffect, useMemo, useState } from "react";
import { recordRecentlyViewedCar } from "@/lib/recentCars";
import { Link, useParams, useSearch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRentalCar,
  useGetRenterProfileByPhone,
  useCreateRentalBooking,
} from "@workspace/api-client-react";
import {
  getGetRentalCarQueryKey,
  getGetRenterProfileByPhoneQueryKey,
  getListRentalBookingsQueryKey,
} from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { useAuth } from "@/lib/auth";
import { isProfileReadyForBooking, isProfileReadyForMode } from "@/pages/rentals/Profile";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { ImageGallery } from "@/components/ImageGallery";
import {
  Car,
  MapPin,
  Users,
  Cog,
  Fuel,
  Phone,
  User,
  Calendar,
  ArrowLeft,
  ShieldAlert,
  IdCard,
  Languages,
  Award,
  KeyRound,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";

function todayISO(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function RentalDetail() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const authPhone = user?.phone ?? "";

  const loanerFor = useMemo(() => new URLSearchParams(search).get("loaner"), [search]);

  const { data: car, isLoading } = useGetRentalCar(id, {
    query: { enabled: !!id, queryKey: getGetRentalCarQueryKey(id) },
  });

  // Track recently-viewed cars in localStorage so the renter dashboard
  // can surface them. Purely UX state — no server round-trip needed.
  useEffect(() => {
    if (!car?.id) return;
    recordRecentlyViewedCar({
      id: car.id,
      label: `${car.brand} ${car.model} ${car.year}`,
      imageUrl: car.imageUrl ?? car.imageUrls?.[0] ?? null,
      city: car.city ?? null,
      dailyRate: car.dailyRate ?? null,
    });
  }, [car?.id, car?.brand, car?.model, car?.year, car?.imageUrl, car?.city, car?.dailyRate]);

  const { data: renter, isLoading: renterLoading } = useGetRenterProfileByPhone(authPhone, {
    query: {
      enabled: !!authPhone,
      queryKey: getGetRenterProfileByPhoneQueryKey(authPhone),
      retry: false,
    },
  });

  const create = useCreateRentalBooking();

  const [startDate, setStartDate] = useState(todayISO(1));
  const [endDate, setEndDate] = useState(todayISO(3));
  const [notes, setNotes] = useState("");
  // Default to whichever mode the owner offers first; falls back to
  // self_drive if for some reason the array is empty.
  const offeredModes: ("self_drive" | "with_driver")[] =
    (car?.rentalModes as ("self_drive" | "with_driver")[] | undefined) ?? ["self_drive"];
  const [rentalMode, setRentalMode] = useState<"self_drive" | "with_driver">(
    offeredModes[0] ?? "self_drive",
  );
  // If the car loads later and the chosen mode isn't actually offered,
  // snap to a valid one so the booking can't be submitted with an
  // invalid mode hidden in state.
  useMemo(() => {
    if (car && !offeredModes.includes(rentalMode)) {
      setRentalMode(offeredModes[0] ?? "self_drive");
    }
  }, [car, offeredModes, rentalMode]);

  const days = useMemo(() => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    const diff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff);
  }, [startDate, endDate]);

  const effectiveDailyRate = car
    ? rentalMode === "with_driver" && car.withDriverDailyRate != null
      ? car.withDriverDailyRate
      : car.dailyRate
    : 0;
  const estimate = days * effectiveDailyRate;

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!car) return <p className="text-sm text-muted-foreground">Rental car not found.</p>;

  const profileReady = renter && isProfileReadyForBooking(renter);
  const modeReady = renter && isProfileReadyForMode(renter, rentalMode);
  const nextUrl = `/rentals/${car.id}${loanerFor ? `?loaner=${loanerFor}` : ""}`;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renter) {
      toast.error("Create your renter profile first.");
      return;
    }
    if (new Date(endDate) <= new Date(startDate)) {
      toast.error("End date must be after start date.");
      return;
    }
    try {
      await create.mutateAsync({
        data: {
          carId: car.id,
          renterId: renter.id,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          purpose: loanerFor ? "loaner" : "general",
          serviceBookingId: loanerFor ?? undefined,
          notes: notes || undefined,
          rentalMode,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getListRentalBookingsQueryKey(),
      });
      toast.success("Rental request sent. The owner will review your KYC and respond shortly.");
      setLocation(`/rentals/my-bookings`);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to create rental booking."));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <Link href={loanerFor ? `/rentals?loaner=${loanerFor}` : "/rentals"}>
        <Button variant="ghost" size="sm" className="gap-2 -ml-2">
          <ArrowLeft className="h-4 w-4" /> Back to rentals
        </Button>
      </Link>

      <PageHeader
        title={`${car.year} ${car.brand} ${car.model}`}
        description={
          car.ownerKind === "platform"
            ? "AutoCare fleet vehicle — insured and serviced by us."
            : `Listed by ${car.ownerName}`
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          {(() => {
            const gallery =
              car.imageUrls && car.imageUrls.length > 0
                ? car.imageUrls
                : car.imageUrl
                  ? [car.imageUrl]
                  : [];
            return gallery.length > 0 ? (
              <ImageGallery
                images={gallery}
                alt={`${car.brand} ${car.model}`}
                className="p-2"
              />
            ) : (
              <div className="aspect-video bg-muted flex items-center justify-center text-muted-foreground">
                <Car className="h-16 w-16" />
              </div>
            );
          })()}
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <Spec icon={Users} label="Seats" value={`${car.seats}`} />
              <Spec icon={Cog} label="Transmission" value={car.transmission} />
              <Spec icon={Fuel} label="Fuel" value={car.fuelType} />
              <Spec icon={MapPin} label="City" value={car.city} />
            </div>
            {car.description && (
              <div>
                <h4 className="text-sm font-semibold mb-1">About this car</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-line">{car.description}</p>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold mb-2">Rental options</h4>
              <div className="flex flex-wrap gap-2">
                {offeredModes.includes("self_drive") && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/15 text-secondary px-3 py-1 text-xs font-medium">
                    <KeyRound className="h-3 w-3" /> Self-drive — {formatCurrency(car.dailyRate)}/day
                  </span>
                )}
                {offeredModes.includes("with_driver") && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary px-3 py-1 text-xs font-medium">
                    <UserCheck className="h-3 w-3" /> With driver — {formatCurrency(car.withDriverDailyRate ?? car.dailyRate)}/day
                  </span>
                )}
              </div>
            </div>

            {offeredModes.includes("with_driver") && car.driver && (
              <div className="rounded-md border bg-muted/30 p-3">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <UserCheck className="h-4 w-4" /> Your driver
                </h4>
                <div className="flex gap-3">
                  <div className="h-16 w-16 rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0">
                    {car.driver.photoUrl ? (
                      <img
                        src={car.driver.photoUrl}
                        alt={car.driver.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="h-7 w-7 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                    <div className="font-medium">{car.driver.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Award className="h-3 w-3" />
                      {car.driver.yearsExperience}{" "}
                      {car.driver.yearsExperience === 1 ? "year" : "years"} experience
                    </div>
                    {(car.driver.languages ?? []).length > 0 && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Languages className="h-3 w-3" /> {(car.driver.languages ?? []).join(", ")}
                      </div>
                    )}
                    {car.driver.bio && (
                      <p className="text-xs text-muted-foreground mt-1">{car.driver.bio}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold mb-1">Pickup</h4>
              <p className="text-sm text-muted-foreground flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" /> {car.pickupAddress}
              </p>
            </div>
            <div>
              <h4 className="text-sm font-semibold mb-1">Owner contact</h4>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <User className="h-4 w-4" /> {car.ownerName}
              </p>
              <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                <Phone className="h-4 w-4" /> {car.ownerPhone}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" /> Book this car
            </CardTitle>
          </CardHeader>
          <CardContent>
            {renterLoading ? (
              <p className="text-sm text-muted-foreground">Checking your profile…</p>
            ) : !profileReady ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-700 dark:text-amber-300 flex-shrink-0" />
                  <p className="text-amber-800 dark:text-amber-200">
                    {renter
                      ? "Your profile is missing a government ID. Add it to request this rental."
                      : "Create your renter profile and upload your government ID to request a rental."}
                  </p>
                </div>
                <Link href={`/rentals/profile?next=${encodeURIComponent(nextUrl)}`}>
                  <Button className="w-full gap-2">
                    <IdCard className="h-4 w-4" /> Complete renter profile
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Booking as <span className="font-medium text-foreground">{renter!.name}</span> · {renter!.phone}
                </p>

                {offeredModes.length > 1 && (
                  <div className="space-y-1.5">
                    <Label>Rental mode</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {offeredModes.includes("self_drive") && (
                        <button
                          type="button"
                          onClick={() => setRentalMode("self_drive")}
                          className={`rounded-md border p-2 text-xs text-left transition-colors ${
                            rentalMode === "self_drive"
                              ? "border-primary bg-primary/10"
                              : "hover:bg-accent/40"
                          }`}
                        >
                          <div className="font-medium flex items-center gap-1.5">
                            <KeyRound className="h-3 w-3" /> Self-drive
                          </div>
                          <div className="text-muted-foreground mt-0.5">
                            {formatCurrency(car.dailyRate)}/day
                          </div>
                        </button>
                      )}
                      {offeredModes.includes("with_driver") && (
                        <button
                          type="button"
                          onClick={() => setRentalMode("with_driver")}
                          className={`rounded-md border p-2 text-xs text-left transition-colors ${
                            rentalMode === "with_driver"
                              ? "border-primary bg-primary/10"
                              : "hover:bg-accent/40"
                          }`}
                        >
                          <div className="font-medium flex items-center gap-1.5">
                            <UserCheck className="h-3 w-3" /> With driver
                          </div>
                          <div className="text-muted-foreground mt-0.5">
                            {formatCurrency(car.withDriverDailyRate ?? car.dailyRate)}/day
                          </div>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {rentalMode === "self_drive" && !modeReady && (
                  <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs space-y-2">
                    <p className="text-amber-800 dark:text-amber-200">
                      Self-drive needs your licence number and a photo of your licence.
                      Add them, or choose "with driver" if it's offered.
                    </p>
                    <Link href={`/rentals/profile?next=${encodeURIComponent(nextUrl)}`}>
                      <Button type="button" variant="outline" size="sm" className="gap-2">
                        <IdCard className="h-4 w-4" /> Add licence
                      </Button>
                    </Link>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="start">Pickup date</Label>
                    <Input id="start" type="date" value={startDate} min={todayISO()} onChange={(e) => setStartDate(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="end">Return date</Label>
                    <Input id="end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes for the owner (optional)</Label>
                  <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Trip purpose, pickup time…" />
                </div>

                <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{formatCurrency(effectiveDailyRate)} × {days} day{days === 1 ? "" : "s"}</span>
                    <span className="font-semibold">{formatCurrency(estimate)}</span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="font-semibold">Estimated total</span>
                    <span className="font-bold text-primary">{formatCurrency(estimate)}</span>
                  </div>
                </div>

                {loanerFor && (
                  <p className="text-xs text-muted-foreground">
                    This rental will be linked to your service booking as a loaner.
                  </p>
                )}

                <p className="text-xs text-muted-foreground">
                  Your KYC will be sent to the owner for review. Once approved, you'll both sign the contract and choose how to pay.
                </p>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={create.isPending || !modeReady}
                >
                  {create.isPending ? "Sending request…" : "Request booking"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Spec({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="font-medium capitalize">{value}</p>
    </div>
  );
}
