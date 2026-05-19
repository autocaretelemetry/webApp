import { useMemo, useState } from "react";
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
import { useRenterProfile } from "@/lib/profile";
import { isProfileReadyForBooking } from "@/pages/rentals/Profile";
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
  const { profile: local } = useRenterProfile();

  const loanerFor = useMemo(() => new URLSearchParams(search).get("loaner"), [search]);

  const { data: car, isLoading } = useGetRentalCar(id, {
    query: { enabled: !!id, queryKey: getGetRentalCarQueryKey(id) },
  });

  const { data: renter, isLoading: renterLoading } = useGetRenterProfileByPhone(local.phone, {
    query: {
      enabled: !!local.phone,
      queryKey: getGetRenterProfileByPhoneQueryKey(local.phone),
      retry: false,
    },
  });

  const create = useCreateRentalBooking();

  const [startDate, setStartDate] = useState(todayISO(1));
  const [endDate, setEndDate] = useState(todayISO(3));
  const [notes, setNotes] = useState("");

  const days = useMemo(() => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    const diff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff);
  }, [startDate, endDate]);

  const estimate = car ? days * car.dailyRate : 0;

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!car) return <p className="text-sm text-muted-foreground">Rental car not found.</p>;

  const profileReady = renter && isProfileReadyForBooking(renter);
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
                      ? "Your profile is missing a driver's licence or ID document. Add them to request this rental."
                      : "Create your renter profile and upload KYC documents to request a rental."}
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
                    <span className="text-muted-foreground">{formatCurrency(car.dailyRate)} × {days} day{days === 1 ? "" : "s"}</span>
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

                <Button type="submit" className="w-full" disabled={create.isPending}>
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
