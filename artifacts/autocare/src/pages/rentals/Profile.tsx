import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRenterProfileByPhone,
  useUpsertRenterProfile,
} from "@workspace/api-client-react";
import { getGetRenterProfileByPhoneQueryKey } from "@/lib/queryKeys";
import { useRenterProfile, setRenterProfile } from "@/lib/profile";
import { describeMutationError } from "@/lib/adminErrors";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  IdCard,
  ShieldCheck,
  UploadCloud,
  Clock,
  XCircle,
  CheckCircle2,
  User,
} from "lucide-react";

function KycBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: typeof ShieldCheck }> = {
    verified: { label: "KYC verified", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: ShieldCheck },
    pending: { label: "KYC pending review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Clock },
    rejected: { label: "KYC rejected", cls: "bg-destructive/15 text-destructive", icon: XCircle },
  };
  const s = map[status] ?? map.pending;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs uppercase tracking-wide px-2.5 py-1 rounded ${s.cls}`}>
      <Icon className="h-3.5 w-3.5" /> {s.label}
    </span>
  );
}

export default function RenterProfilePage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { profile: local } = useRenterProfile();

  const nextUrl = new URLSearchParams(search).get("next");

  const { data: server } = useGetRenterProfileByPhone(local.phone, {
    query: {
      enabled: !!local.phone,
      queryKey: getGetRenterProfileByPhoneQueryKey(local.phone),
      retry: false,
    },
  });

  const upsert = useUpsertRenterProfile();

  const [form, setForm] = useState({
    name: local.name,
    phone: local.phone,
    email: local.email,
    address: "",
    dateOfBirth: "",
    driverLicenseNumber: "",
    driverLicenseUrl: "",
    idDocumentType: "national_id",
    idDocumentUrl: "",
    selfieUrl: "",
  });

  useEffect(() => {
    if (server) {
      setForm({
        name: server.name,
        phone: server.phone,
        email: server.email ?? "",
        address: server.address ?? "",
        dateOfBirth: server.dateOfBirth ?? "",
        driverLicenseNumber: server.driverLicenseNumber ?? "",
        driverLicenseUrl: server.driverLicenseUrl ?? "",
        idDocumentType: server.idDocumentType ?? "national_id",
        idDocumentUrl: server.idDocumentUrl ?? "",
        selfieUrl: server.selfieUrl ?? "",
      });
    }
  }, [server]);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = await upsert.mutateAsync({
        data: {
          name: form.name,
          phone: form.phone,
          email: form.email || undefined,
          address: form.address || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          driverLicenseNumber: form.driverLicenseNumber || undefined,
          driverLicenseUrl: form.driverLicenseUrl || undefined,
          idDocumentType: form.idDocumentType || undefined,
          idDocumentUrl: form.idDocumentUrl || undefined,
          selfieUrl: form.selfieUrl || undefined,
        },
      });
      setRenterProfile({ name: saved.name, phone: saved.phone, email: saved.email ?? "" });
      await queryClient.invalidateQueries({
        queryKey: getGetRenterProfileByPhoneQueryKey(saved.phone),
      });
      toast.success("Profile saved.");
      if (nextUrl) setLocation(nextUrl);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to save profile."));
    }
  };

  const kycDone =
    form.driverLicenseNumber.trim() &&
    form.driverLicenseUrl.trim() &&
    form.idDocumentUrl.trim();

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Your renter profile"
        description="Create your profile and upload KYC documents so car owners can verify and approve your booking requests."
      />

      {server && <div><KycBadge status={server.kycStatus} /></div>}

      {nextUrl && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground">
          Complete your KYC details and we'll take you back to finish your booking.
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" /> Personal details
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input value={form.name} onChange={(e) => update("name", e.target.value)} required />
            </Field>
            <Field label="Phone (used as your unique ID)" required>
              <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} required />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
            </Field>
            <Field label="Date of birth">
              <Input type="date" value={form.dateOfBirth} onChange={(e) => update("dateOfBirth", e.target.value)} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input value={form.address} onChange={(e) => update("address", e.target.value)} placeholder="Street, area, city" />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <IdCard className="h-4 w-4" /> KYC documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground flex items-start gap-2">
              <UploadCloud className="h-4 w-4 mt-0.5 flex-shrink-0" />
              Paste an image URL for each document. Owners review these before approving your booking.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Driver's licence number" required>
                <Input value={form.driverLicenseNumber} onChange={(e) => update("driverLicenseNumber", e.target.value)} placeholder="LAG-DL-…" />
              </Field>
              <Field label="Driver's licence photo URL" required>
                <Input value={form.driverLicenseUrl} onChange={(e) => update("driverLicenseUrl", e.target.value)} placeholder="https://…" />
              </Field>
              <Field label="ID document type">
                <Select value={form.idDocumentType} onValueChange={(v) => update("idDocumentType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="national_id">National ID</SelectItem>
                    <SelectItem value="passport">Passport</SelectItem>
                    <SelectItem value="voters_card">Voter's card</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="ID document photo URL" required>
                <Input value={form.idDocumentUrl} onChange={(e) => update("idDocumentUrl", e.target.value)} placeholder="https://…" />
              </Field>
              <Field label="Selfie URL (optional)" className="sm:col-span-2">
                <Input value={form.selfieUrl} onChange={(e) => update("selfieUrl", e.target.value)} placeholder="https://…" />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Preview url={form.driverLicenseUrl} label="Licence" />
              <Preview url={form.idDocumentUrl} label="ID" />
              <Preview url={form.selfieUrl} label="Selfie" />
            </div>
          </CardContent>
        </Card>

        {!kycDone && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Add your licence number, licence photo and ID photo to start booking rentals.
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setLocation("/rentals")}>Back to rentals</Button>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? "Saving…" : server ? "Save changes" : "Create profile"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children, className }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label>{label}{required && <span className="text-destructive ml-0.5">*</span>}</Label>
      {children}
    </div>
  );
}

function Preview({ url, label }: { url: string; label: string }) {
  return (
    <div className="aspect-[4/3] rounded-md bg-muted border overflow-hidden flex items-center justify-center relative">
      {url ? (
        <img src={url} alt={label} className="w-full h-full object-cover" />
      ) : (
        <span className="text-xs text-muted-foreground">{label}</span>
      )}
      <span className="absolute bottom-1 left-1 text-[10px] uppercase tracking-wide bg-background/80 px-1.5 rounded">{label}</span>
    </div>
  );
}

export function isProfileReadyForBooking(p: {
  driverLicenseNumber?: string | null;
  driverLicenseUrl?: string | null;
  idDocumentUrl?: string | null;
}): boolean {
  return Boolean(
    p.driverLicenseNumber?.trim() &&
      p.driverLicenseUrl?.trim() &&
      p.idDocumentUrl?.trim(),
  );
}
