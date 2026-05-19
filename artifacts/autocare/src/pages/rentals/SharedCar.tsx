import { useMemo } from "react";
import { useParams, Link } from "wouter";
import { useGetPublicRentalCar, useGetRenterProfileByPhone } from "@workspace/api-client-react";
import {
  getGetPublicRentalCarQueryKey,
  getGetRenterProfileByPhoneQueryKey,
} from "@/lib/queryKeys";
import { useRenterProfile, hasStoredRenterProfile } from "@/lib/profile";
import { isProfileReadyForBooking } from "@/pages/rentals/Profile";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { ImageGallery } from "@/components/ImageGallery";
import {
  Car,
  MapPin,
  Users,
  Cog,
  Fuel,
  ShieldCheck,
  IdCard,
  Wrench,
  Share2,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

function shareUrlForCar(id: string): string {
  if (typeof window === "undefined") return "";
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}/share/cars/${id}`;
}

export default function SharedCar() {
  const { id } = useParams<{ id: string }>();
  const { profile: local } = useRenterProfile();
  // Only consult the renter-profile-by-phone endpoint when the visitor
  // actually has a saved profile in this browser. Otherwise a brand-new
  // visitor would be matched against the hardcoded default identity and
  // skip the signup/KYC step.
  const hasProfile = hasStoredRenterProfile();

  const { data: car, isLoading } = useGetPublicRentalCar(id, {
    query: { enabled: !!id, queryKey: getGetPublicRentalCarQueryKey(id), retry: false },
  });

  const { data: renter } = useGetRenterProfileByPhone(local.phone, {
    query: {
      enabled: hasProfile && !!local.phone,
      queryKey: getGetRenterProfileByPhoneQueryKey(local.phone),
      retry: false,
    },
  });

  const cta = useMemo(() => {
    if (!car) return null;
    const bookingHref = `/rentals/${car.id}`;
    if (!hasProfile || !renter) {
      return {
        label: "Sign up & complete KYC to book",
        href: `/rentals/profile?next=${encodeURIComponent(bookingHref)}`,
        helper:
          "We'll set up your renter profile and KYC, then bring you straight back to book this car.",
      };
    }
    if (!isProfileReadyForBooking(renter)) {
      return {
        label: "Finish KYC to book",
        href: `/rentals/profile?next=${encodeURIComponent(bookingHref)}`,
        helper:
          "Add your driver's licence and ID document — usually under a minute — and we'll bring you back here.",
      };
    }
    return {
      label: "Book this car",
      href: bookingHref,
      helper: `You're booking as ${renter.name}. The owner will review and confirm.`,
    };
  }, [car, renter, hasProfile]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrlForCar(id));
      toast.success("Link copied to clipboard.");
    } catch {
      toast.error("Couldn't copy link automatically — long-press to copy.");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/rentals" className="inline-flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Wrench className="h-4 w-4" />
            </span>
            <span>AutoCare Rentals</span>
          </Link>
          <Button variant="outline" size="sm" className="gap-2" onClick={copyLink}>
            <Share2 className="h-4 w-4" /> Copy link
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !car && (
          <Card>
            <CardContent className="py-12 text-center space-y-2">
              <p className="font-medium">This rental link is no longer available.</p>
              <p className="text-sm text-muted-foreground">
                The owner may have removed the listing or it's pending review.
              </p>
              <Link href="/rentals">
                <Button variant="outline" className="mt-2">Browse other rentals</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {car && cta && (
          <>
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
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight">
                      {car.year} {car.brand} {car.model}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {car.color} · {car.city} · Listed by {car.ownerName}
                    </p>
                  </div>

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
                </CardContent>
              </Card>

              <Card className="h-fit">
                <CardContent className="p-5 space-y-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">From</p>
                    <p className="text-3xl font-bold text-primary">
                      {formatCurrency(car.dailyRate)}
                      <span className="text-sm font-normal text-muted-foreground"> / day</span>
                    </p>
                  </div>

                  <Link href={cta.href}>
                    <Button className="w-full gap-2" size="lg">
                      {cta.label} <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <p className="text-xs text-muted-foreground text-center">{cta.helper}</p>

                  <div className="rounded-md border bg-muted/40 p-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      How it works
                    </p>
                    <Step
                      n={1}
                      icon={IdCard}
                      title="Create your renter profile"
                      desc="Phone, address, and one quick KYC upload."
                    />
                    <Step
                      n={2}
                      icon={ShieldCheck}
                      title="Owner reviews & approves"
                      desc="Usually within a few hours."
                    />
                    <Step
                      n={3}
                      icon={CheckCircle2}
                      title="Sign the contract & pay"
                      desc="Pay online or cash on pickup — your call."
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            <p className="text-center text-xs text-muted-foreground pt-4">
              You're viewing a public listing shared by the owner. Powered by AutoCare.
            </p>
          </>
        )}
      </main>
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

function Step({
  n,
  icon: Icon,
  title,
  desc,
}: {
  n: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold">
        {n}
      </span>
      <div className="text-sm">
        <p className="font-medium flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {title}
        </p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

export { shareUrlForCar };
