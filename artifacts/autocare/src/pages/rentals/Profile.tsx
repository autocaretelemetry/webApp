import { useEffect, useRef, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRenterProfileByPhone,
  useUpsertRenterProfile,
} from "@workspace/api-client-react";
import { getGetRenterProfileByPhoneQueryKey } from "@/lib/queryKeys";
import { useAuth } from "@/lib/auth";
import { describeMutationError } from "@/lib/adminErrors";
import { useUpload } from "@workspace/object-storage-web";
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
  Loader2,
  Image as ImageIcon,
  Trash2,
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
  const { user } = useAuth();
  const authPhone = user?.phone ?? "";

  const nextUrl = new URLSearchParams(search).get("next");

  const { data: server } = useGetRenterProfileByPhone(authPhone, {
    query: {
      enabled: !!authPhone,
      queryKey: getGetRenterProfileByPhoneQueryKey(authPhone),
      retry: false,
    },
  });

  const upsert = useUpsertRenterProfile();

  const [form, setForm] = useState({
    name: user?.name ?? "",
    phone: authPhone,
    email: user?.email ?? "",
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
          // Phone is bound to the signed-in account; the server still
          // expects it in the body but the form keeps it read-only so
          // the renter can't accidentally write a profile under a
          // different phone number than the one they log in with.
          phone: authPhone,
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
      await queryClient.invalidateQueries({
        queryKey: getGetRenterProfileByPhoneQueryKey(saved.phone),
      });
      toast.success("Profile saved.");
      if (nextUrl) setLocation(nextUrl);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to save profile."));
    }
  };

  // KYC minimum: only a government ID is mandatory. Driver's licence is
  // optional because some renters will only book "with-driver" listings.
  const kycDone = !!form.idDocumentUrl.trim();

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
            <Field label="Phone (your sign-in number)" required>
              <Input value={authPhone} readOnly disabled />
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
              Upload clear photos of your documents. JPG or PNG, up to 10 MB each. Owners review these before approving your booking.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Field label="Driver's licence number (optional)">
                <Input value={form.driverLicenseNumber} onChange={(e) => update("driverLicenseNumber", e.target.value)} placeholder="LAG-DL-…" />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              A driver's licence is only required if you plan to self-drive. If
              you'll always rent with a driver, you can skip the licence fields.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <UploadField
                label="Government ID photo"
                required
                url={form.idDocumentUrl}
                onChange={(url) => update("idDocumentUrl", url)}
              />
              <UploadField
                label="Driver's licence photo (optional)"
                url={form.driverLicenseUrl}
                onChange={(url) => update("driverLicenseUrl", url)}
              />
              <UploadField
                label="Selfie (optional)"
                url={form.selfieUrl}
                onChange={(url) => update("selfieUrl", url)}
              />
            </div>
          </CardContent>
        </Card>

        {!kycDone && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Add a clear photo of your government ID to start booking rentals.
            Upload your licence too if you want to self-drive.
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

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function UploadField({
  label,
  required,
  url,
  onChange,
}: {
  label: string;
  required?: boolean;
  url: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading, progress } = useUpload({
    onSuccess: (res) => onChange(`/api/storage${res.objectPath}`),
    onError: (err) => toast.error(err.message || "Upload failed."),
  });

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick a JPG or PNG image.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Image must be 10 MB or smaller.");
      return;
    }
    await uploadFile(file);
  };

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center justify-between">
        <span>{label}{required && <span className="text-destructive ml-0.5">*</span>}</span>
        {url && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
      </Label>
      <div
        className="aspect-[4/3] rounded-md border border-dashed bg-muted/40 overflow-hidden flex items-center justify-center relative cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        {url ? (
          <img src={url} alt={label} className="w-full h-full object-cover" />
        ) : isUploading ? (
          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Uploading… {progress}%
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground p-3 text-center">
            <ImageIcon className="h-5 w-5" />
            Click to upload
          </div>
        )}
        {url && isUploading && (
          <div className="absolute inset-0 bg-background/70 flex items-center justify-center text-xs">
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> {progress}%
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPick}
        />
      </div>
    </div>
  );
}

/**
 * Minimum KYC for booking any rental: a government ID is always required.
 * For "self_drive" bookings we additionally require a licence number AND a
 * licence photo — see `isProfileReadyForMode`.
 */
export function isProfileReadyForBooking(p: {
  idDocumentUrl?: string | null;
}): boolean {
  return Boolean(p.idDocumentUrl?.trim());
}

/**
 * KYC required for a specific rental mode. `with_driver` only needs the base
 * KYC (gov ID); `self_drive` also needs the licence number and a licence
 * photo so the owner can verify the renter is allowed to drive.
 */
export function isProfileReadyForMode(
  p: {
    driverLicenseNumber?: string | null;
    driverLicenseUrl?: string | null;
    idDocumentUrl?: string | null;
  },
  mode: "self_drive" | "with_driver",
): boolean {
  if (!isProfileReadyForBooking(p)) return false;
  if (mode === "with_driver") return true;
  return Boolean(p.driverLicenseNumber?.trim() && p.driverLicenseUrl?.trim());
}
