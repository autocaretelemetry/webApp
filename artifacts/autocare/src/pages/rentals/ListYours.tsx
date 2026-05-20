import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useCreateRentalCar, useListDrivers } from "@workspace/api-client-react";
import { getListRentalCarsQueryKey, getListDriversQueryKey } from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Car, Banknote, ShieldCheck, Wrench, Camera, User, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { MultiImageUploader } from "@/components/MultiImageUploader";

const GHANA_CITIES = [
  "Accra",
  "Kumasi",
  "Takoradi",
  "Tamale",
  "Cape Coast",
  "Sunyani",
  "Ho",
  "Koforidua",
  "Tema",
];

export default function ListYourCar() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const create = useCreateRentalCar();
  const { user } = useAuth();

  const [form, setForm] = useState({
    ownerName: user?.name ?? "",
    ownerPhone: user?.phone ?? "",
    ownerEmail: user?.email ?? "",
    brand: "",
    model: "",
    year: new Date().getFullYear() - 2,
    color: "",
    plateNumber: "",
    transmission: "automatic" as "automatic" | "manual",
    seats: 5,
    fuelType: "petrol" as "petrol" | "diesel" | "hybrid" | "electric",
    dailyRate: 250,
    city: "Accra",
    pickupAddress: "",
    description: "",
    imageUrls: [] as string[],
    selfDrive: true,
    withDriver: false,
    withDriverDailyRate: 0,
    driverId: "",
  });

  const { data: drivers } = useListDrivers(
    { ownerPhone: form.ownerPhone },
    {
      query: {
        enabled: !!form.ownerPhone && form.withDriver,
        queryKey: getListDriversQueryKey({ ownerPhone: form.ownerPhone }),
      },
    },
  );

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.imageUrls.length === 0) {
      toast.error("Please upload at least one photo of the car before submitting.");
      return;
    }
    const rentalModes: ("self_drive" | "with_driver")[] = [];
    if (form.selfDrive) rentalModes.push("self_drive");
    if (form.withDriver) rentalModes.push("with_driver");
    if (rentalModes.length === 0) {
      toast.error("Pick at least one rental mode — self-drive, with driver, or both.");
      return;
    }
    if (form.withDriver && !form.driverId) {
      toast.error("Pick the driver profile that will be attached to this listing.");
      return;
    }
    try {
      await create.mutateAsync({
        data: {
          ownerKind: "user",
          ownerName: form.ownerName,
          ownerPhone: form.ownerPhone,
          ownerEmail: form.ownerEmail || undefined,
          brand: form.brand,
          model: form.model,
          year: Number(form.year),
          color: form.color,
          plateNumber: form.plateNumber,
          transmission: form.transmission,
          seats: Number(form.seats),
          fuelType: form.fuelType,
          dailyRate: Number(form.dailyRate),
          city: form.city,
          pickupAddress: form.pickupAddress,
          description: form.description || undefined,
          imageUrl: form.imageUrls[0],
          imageUrls: form.imageUrls,
          rentalModes,
          withDriverDailyRate:
            form.withDriver && form.withDriverDailyRate > 0
              ? Number(form.withDriverDailyRate)
              : undefined,
          driverId: form.withDriver ? form.driverId : undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListRentalCarsQueryKey() });
      toast.success("Listing submitted! AutoCare will review and approve shortly.");
      setLocation("/rentals/my-listings");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to submit listing."));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="List your car for rental"
        description="Earn money when your car would otherwise sit idle. We review every listing for safety and quality before it goes live."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: Banknote,
            title: "Earn passive income",
            body: "Set your own daily rate. AutoCare keeps a small platform fee.",
          },
          {
            icon: ShieldCheck,
            title: "Vetted renters",
            body: "Every booking goes through verification before pickup.",
          },
          {
            icon: Wrench,
            title: "AutoCare-backed",
            body: "Our service centers handle any maintenance issues that come up.",
          },
        ].map((b) => (
          <Card key={b.title}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <b.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="font-semibold text-sm">{b.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{b.body}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Car className="h-4 w-4" /> About the car
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand" required>
              <Input value={form.brand} onChange={(e) => update("brand", e.target.value)} placeholder="Toyota" required />
            </Field>
            <Field label="Model" required>
              <Input value={form.model} onChange={(e) => update("model", e.target.value)} placeholder="Camry" required />
            </Field>
            <Field label="Year" required>
              <Input
                type="number"
                min={1990}
                max={new Date().getFullYear() + 1}
                value={form.year}
                onChange={(e) => update("year", Number(e.target.value))}
                required
              />
            </Field>
            <Field label="Color" required>
              <Input value={form.color} onChange={(e) => update("color", e.target.value)} placeholder="Silver" required />
            </Field>
            <Field label="Plate number" required>
              <Input value={form.plateNumber} onChange={(e) => update("plateNumber", e.target.value)} placeholder="LAG-123-AB" required />
            </Field>
            <Field label="Seats" required>
              <Input
                type="number"
                min={2}
                max={12}
                value={form.seats}
                onChange={(e) => update("seats", Number(e.target.value))}
                required
              />
            </Field>
            <Field label="Transmission">
              <Select value={form.transmission} onValueChange={(v) => update("transmission", v as typeof form.transmission)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automatic</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fuel type">
              <Select value={form.fuelType} onValueChange={(v) => update("fuelType", v as typeof form.fuelType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="petrol">Petrol</SelectItem>
                  <SelectItem value="diesel">Diesel</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="electric">Electric</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Camera className="h-3.5 w-3.5" /> Car photos
                </span>
              }
              required
              className="sm:col-span-2"
            >
              <MultiImageUploader
                value={form.imageUrls}
                onChange={(paths) => update("imageUrls", paths)}
                max={8}
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Add several angles — exterior, interior, back, side. Renters
                want to see what they're booking.
              </p>
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="Tell renters what makes your car great…"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pricing & pickup</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Daily rate (GHS)" required>
              <Input
                type="number"
                min={0}
                value={form.dailyRate}
                onChange={(e) => update("dailyRate", Number(e.target.value))}
                required
              />
            </Field>
            <Field label="Pickup city" required>
              <Select value={form.city} onValueChange={(v) => update("city", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GHANA_CITIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Pickup address" required className="sm:col-span-2">
              <Input
                value={form.pickupAddress}
                onChange={(e) => update("pickupAddress", e.target.value)}
                placeholder="Street, area, city"
                required
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" /> Rental modes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Pick how you'll offer this car. You can offer self-drive,
              with-driver, or both. Renters will choose at booking time.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/40 transition-colors">
                <Checkbox
                  checked={form.selfDrive}
                  onCheckedChange={(v) => update("selfDrive", !!v)}
                />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Self-drive</p>
                  <p className="text-xs text-muted-foreground">
                    Renter drives the car themselves. We verify their licence.
                  </p>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent/40 transition-colors">
                <Checkbox
                  checked={form.withDriver}
                  onCheckedChange={(v) => update("withDriver", !!v)}
                />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">With driver</p>
                  <p className="text-xs text-muted-foreground">
                    Your chauffeur drives. Renter sees the driver's profile.
                  </p>
                </div>
              </label>
            </div>

            {form.withDriver && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <Field label="Daily rate when rented with driver (GHS)">
                  <Input
                    type="number"
                    min={0}
                    value={form.withDriverDailyRate}
                    onChange={(e) =>
                      update("withDriverDailyRate", Number(e.target.value))
                    }
                    placeholder="Leave 0 to use the same daily rate"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Most owners charge a bit more to cover the driver's time.
                    Leave it at 0 to use the same rate as self-drive.
                  </p>
                </Field>

                <Field label="Driver profile" required>
                  {(drivers ?? []).length === 0 ? (
                    <div className="rounded-md border border-dashed p-3 text-sm space-y-2">
                      <p className="text-muted-foreground">
                        You haven't added any drivers yet. Add one first, then
                        come back to attach them to this listing.
                      </p>
                      <Link href="/rentals/drivers">
                        <Button type="button" variant="outline" size="sm" className="gap-2">
                          <UserPlus className="h-4 w-4" /> Add a driver
                        </Button>
                      </Link>
                    </div>
                  ) : (
                    <Select
                      value={form.driverId}
                      onValueChange={(v) => update("driverId", v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a driver" />
                      </SelectTrigger>
                      <SelectContent>
                        {(drivers ?? []).map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.name} · {d.yearsExperience}y experience
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your contact info</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <Field label="Full name" required>
              <Input value={form.ownerName} onChange={(e) => update("ownerName", e.target.value)} required />
            </Field>
            <Field label="Phone" required>
              <Input value={form.ownerPhone} onChange={(e) => update("ownerPhone", e.target.value)} required />
            </Field>
            <Field label="Email (optional)">
              <Input type="email" value={form.ownerEmail} onChange={(e) => update("ownerEmail", e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setLocation("/rentals")}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Submitting…" : "Submit for review"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}
