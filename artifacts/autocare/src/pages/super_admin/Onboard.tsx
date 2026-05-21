import { useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Building2,
  Car,
  CheckCircle2,
  Copy,
  KeyRound,
  Store,
  Truck,
  UserPlus,
  Users,
} from "lucide-react";

type Role = "owner" | "renter" | "center" | "vendor" | "delivery" | "fleet";

const ROLES: Array<{
  value: Role;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "owner", label: "Car owner", description: "Individual vehicle owner.", icon: Car },
  { value: "renter", label: "Renter", description: "Books cars from the rental marketplace.", icon: KeyRound },
  { value: "center", label: "Service center", description: "Garage that accepts service bookings.", icon: Store },
  { value: "vendor", label: "Parts vendor", description: "Sells parts on the marketplace.", icon: Store },
  { value: "delivery", label: "Delivery agent", description: "Delivers parts orders.", icon: Truck },
  { value: "fleet", label: "Fleet / institution", description: "Organisation account with multiple vehicles.", icon: Building2 },
];

type FieldSpec = { name: string; label: string; placeholder?: string };

function applicantFieldsFor(role: Role): FieldSpec[] {
  switch (role) {
    case "center":
      return [
        { name: "businessName", label: "Business name", placeholder: "e.g. Adum AutoCare" },
        { name: "address", label: "Address" },
        { name: "city", label: "City" },
        { name: "specialty", label: "Primary specialty", placeholder: "e.g. Diesel engines" },
      ];
    case "vendor":
      return [
        { name: "businessName", label: "Business name" },
        { name: "address", label: "Address" },
        { name: "city", label: "City" },
        { name: "region", label: "Region" },
      ];
    case "delivery":
      return [
        { name: "city", label: "City" },
        { name: "region", label: "Region" },
        { name: "vehicleType", label: "Vehicle type", placeholder: "motorbike, van, truck…" },
      ];
    case "fleet":
      return [
        { name: "orgName", label: "Organisation name" },
        { name: "industry", label: "Industry", placeholder: "Logistics, Telecom…" },
        { name: "city", label: "City" },
        { name: "region", label: "Region" },
      ];
    default:
      return [];
  }
}

export default function SuperAdminOnboard() {
  const [role, setRole] = useState<Role>("owner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [applicant, setApplicant] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ name: string; email: string; password: string } | null>(null);

  function reset() {
    setName("");
    setEmail("");
    setPhone("");
    setApplicant({});
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim()) {
      toast.error("Name, email, and phone are required.");
      return;
    }
    setSubmitting(true);
    try {
      // Strip empty applicant fields so we don't send "" for things the
      // applicant didn't fill in — provisionRoleRecord uses "TBD"
      // fallbacks which look cleaner than empty strings in the directory.
      const applicantData: Record<string, string> = {};
      for (const [k, v] of Object.entries(applicant)) {
        if (v.trim()) applicantData[k] = v.trim();
      }
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          role,
          applicantData: Object.keys(applicantData).length > 0 ? applicantData : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to create account.");
      }
      setResult({ name: name.trim(), email: email.trim(), password: body.tempPassword });
      toast.success("Account created.");
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create account.");
    } finally {
      setSubmitting(false);
    }
  }

  const fields = applicantFieldsFor(role);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500 max-w-3xl">
      <PageHeader
        title="Onboard a new account"
        description="Create a fully approved account on behalf of someone who can't self-signup. KYC is marked verified and the matching directory row is provisioned."
      />

      <form onSubmit={onSubmit} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Account type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-2">
              {ROLES.map((r) => {
                const Icon = r.icon;
                const active = role === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => {
                      setRole(r.value);
                      setApplicant({});
                    }}
                    className={`text-left rounded-md border p-3 transition flex items-start gap-3 ${
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:border-primary/40"
                    }`}
                  >
                    <Icon className={`h-5 w-5 mt-0.5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Account holder
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Akosua Mensah" />
            </Field>
            <Field label="Email" required>
              <Input value={email} type="email" onChange={(e) => setEmail(e.target.value)} placeholder="akosua@example.com" />
            </Field>
            <Field label="Phone" required>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+233 24 123 4567" />
            </Field>
          </CardContent>
        </Card>

        {fields.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {ROLES.find((r) => r.value === role)?.label} details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <Field key={f.name} label={f.label}>
                  <Input
                    value={applicant[f.name] ?? ""}
                    onChange={(e) =>
                      setApplicant((a) => ({ ...a, [f.name]: e.target.value }))
                    }
                    placeholder={f.placeholder}
                  />
                </Field>
              ))}
            </CardContent>
          </Card>
        )}

        <Select value={role} onValueChange={(v) => setRole(v as Role)}>
          <SelectTrigger className="hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create account"}
          </Button>
        </div>
      </form>

      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Account created
            </DialogTitle>
            <DialogDescription>
              Share these credentials with the user — the temporary password is shown only once.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-3 text-sm">
              <CredRow label="Name" value={result.name} />
              <CredRow label="Email" value={result.email} />
              <CredRow label="Temporary password" value={result.password} mono />
              <p className="text-xs text-muted-foreground">
                Ask the user to change their password after first sign-in via Settings.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

function CredRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded border p-2.5 bg-muted/40">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`truncate ${mono ? "font-mono text-sm" : "text-sm"}`}>{value}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success(`${label} copied.`);
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
