import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendors,
  useListDeliveryAgents,
  useRegisterDeliveryAgent,
} from "@workspace/api-client-react";
import { getListDeliveryAgentsQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { ImageUploader } from "@/components/ImageUploader";
import { resolveImageUrl } from "@/lib/format";
import { toast } from "sonner";
import {
  Truck,
  Plus,
  Loader2,
  BadgeCheck,
  ShieldCheck,
  FileBadge,
  IdCard,
  X,
} from "lucide-react";

const CITY_OPTIONS = ["Accra", "Kumasi", "Takoradi", "Tamale", "Tema"];
const REGION_BY_CITY: Record<string, string> = {
  Accra: "Greater Accra",
  Kumasi: "Ashanti",
  Takoradi: "Western",
  Tamale: "Northern",
  Tema: "Greater Accra",
};

export default function VendorDeliveryTeam() {
  const { data: vendors } = useListVendors();
  const vendor = vendors?.[0];
  const queryClient = useQueryClient();

  const teamParams = vendor ? { vendorId: vendor.id } : {};
  const { data: team, isLoading } = useListDeliveryAgents(teamParams, {
    query: {
      enabled: !!vendor,
      queryKey: getListDeliveryAgentsQueryKey(teamParams),
    },
  });

  const [showForm, setShowForm] = useState(false);
  const register = useRegisterDeliveryAgent();
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+233 ");
  const [city, setCity] = useState<string>("Accra");
  const [vehicleType, setVehicleType] = useState<string>("Motorcycle");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [passportUrl, setPassportUrl] = useState("");
  const [ghanaCardUrl, setGhanaCardUrl] = useState("");
  const [licenseUrl, setLicenseUrl] = useState("");

  if (!vendor) return <div className="p-8">Loading…</div>;

  const reset = () => {
    setName("");
    setPhone("+233 ");
    setCity("Accra");
    setVehicleType("Motorcycle");
    setBio("");
    setPhotoUrl("");
    setPassportUrl("");
    setGhanaCardUrl("");
    setLicenseUrl("");
  };

  const onSubmit = async () => {
    if (!name.trim() || !phone.trim()) {
      toast.error("Name and phone are required.");
      return;
    }
    if (!photoUrl) {
      toast.error("Please upload a profile photo.");
      return;
    }
    if (!passportUrl && !ghanaCardUrl && !licenseUrl) {
      toast.error("Upload at least one government ID (passport, Ghana card, or driver's license).");
      return;
    }
    setSubmitting(true);
    try {
      await register.mutateAsync({
        data: {
          name: name.trim(),
          phone: phone.trim(),
          city,
          region: REGION_BY_CITY[city] ?? city,
          vehicleType,
          bio: bio.trim() || null,
          photoUrl,
          passportUrl: passportUrl || null,
          ghanaCardUrl: ghanaCardUrl || null,
          licenseUrl: licenseUrl || null,
          vendorId: vendor.id,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getListDeliveryAgentsQueryKey(teamParams),
      });
      toast.success(`${name.trim()} added to your delivery team.`);
      reset();
      setShowForm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add rider.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="My delivery team"
          description="Onboard your own riders. They'll appear in the courier picker on every order with a Vendor certified badge."
        />
        {!showForm && (
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add delivery rider
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">New delivery rider</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  reset();
                  setShowForm(false);
                }}
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div>
              <Label>
                Profile photo <span className="text-destructive">*</span>
              </Label>
              <div className="mt-1.5 max-w-xs">
                <ImageUploader value={photoUrl} onChange={setPhotoUrl} label="Upload rider's photo" />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="t-name">Full name</Label>
                <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="t-phone">Phone</Label>
                <Input id="t-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1.5" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>City</Label>
                <Select value={city} onValueChange={setCity}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CITY_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vehicle type</Label>
                <Select value={vehicleType} onValueChange={setVehicleType}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Motorcycle">Motorcycle</SelectItem>
                    <SelectItem value="Van">Van</SelectItem>
                    <SelectItem value="Pickup">Pickup</SelectItem>
                    <SelectItem value="Bicycle">Bicycle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="t-bio">Short bio (optional)</Label>
              <Textarea id="t-bio" rows={2} value={bio} onChange={(e) => setBio(e.target.value)} className="mt-1.5" placeholder="Coverage area, experience, etc." />
            </div>

            <div className="pt-2 border-t">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <h4 className="font-semibold text-sm">KYC — government ID</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Upload at least one document. A driver's license alone is fine; a
                passport or Ghana card on file helps with quicker verification.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Passport</Label>
                  <div className="mt-1.5">
                    <ImageUploader value={passportUrl} onChange={setPassportUrl} label="Upload passport" />
                  </div>
                </div>
                <div>
                  <Label>Ghana card</Label>
                  <div className="mt-1.5">
                    <ImageUploader value={ghanaCardUrl} onChange={setGhanaCardUrl} label="Upload Ghana card" />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Label>Driver's license (optional)</Label>
                  <div className="mt-1.5 max-w-md">
                    <ImageUploader value={licenseUrl} onChange={setLicenseUrl} label="Upload driver's license" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  setShowForm(false);
                }}
              >
                Cancel
              </Button>
              <Button onClick={onSubmit} disabled={submitting} className="gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                Add to team
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="p-8 text-sm text-muted-foreground">Loading team…</div>
      ) : team && team.length > 0 ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {team.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  {a.photoUrl ? (
                    <img
                      src={resolveImageUrl(a.photoUrl)}
                      alt={a.name}
                      className="h-14 w-14 rounded-full object-cover border"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                      <Truck className="h-6 w-6" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{a.phone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {a.vendorCertified && (
                    <Badge variant="secondary" className="gap-1">
                      <BadgeCheck className="h-3 w-3" /> Vendor certified
                    </Badge>
                  )}
                  <Badge variant="outline">{a.vehicleType}</Badge>
                  <Badge variant="outline">{a.city}</Badge>
                  {!a.active && <Badge variant="destructive">Inactive</Badge>}
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {a.passportUrl && (
                    <Badge variant="outline" className="gap-1 text-[10px]"><FileBadge className="h-3 w-3" /> Passport</Badge>
                  )}
                  {a.ghanaCardUrl && (
                    <Badge variant="outline" className="gap-1 text-[10px]"><IdCard className="h-3 w-3" /> Ghana card</Badge>
                  )}
                  {a.licenseUrl && (
                    <Badge variant="outline" className="gap-1 text-[10px]"><ShieldCheck className="h-3 w-3" /> License</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {a.rating.toFixed(1)} rating · {a.completedDeliveries} deliveries
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <div className="h-12 w-12 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Truck className="h-6 w-6" />
            </div>
            <h3 className="font-semibold">No riders on your team yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Add your own delivery riders to handle your orders. They get a
              <span className="font-medium"> Vendor certified </span>
              badge wherever they appear.
            </p>
            {!showForm && (
              <Button onClick={() => setShowForm(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Add your first rider
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
