import { useState } from "react";
import { Link, useLocation } from "wouter";
import { signup as signupApi } from "@workspace/api-client-react";
import {
  Wrench,
  UserPlus,
  Car,
  Users,
  Wrench as WrenchIcon,
  Store,
  Truck,
  Building2,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type RoleKey = "owner" | "renter" | "center" | "vendor" | "delivery" | "fleet";

const ROLES: Array<{
  key: RoleKey;
  label: string;
  blurb: string;
  icon: typeof Car;
}> = [
  { key: "owner", label: "Car owner", blurb: "Track services and book maintenance for your vehicles.", icon: Car },
  { key: "renter", label: "Renter", blurb: "Rent cars from owners across the platform.", icon: Users },
  { key: "center", label: "Service centre", blurb: "Accept jobs from owners and grow your workshop.", icon: WrenchIcon },
  { key: "vendor", label: "Parts vendor", blurb: "List and sell parts to service centres and owners.", icon: Store },
  { key: "delivery", label: "Delivery agent", blurb: "Run last-mile parts deliveries for vendors.", icon: Truck },
  { key: "fleet", label: "Fleet / institution", blurb: "Manage a fleet of vehicles for your organisation.", icon: Building2 },
];

type FormState = {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
  // role-specific
  businessName: string;
  city: string;
  region: string;
  address: string;
  specialty: string;
  vehicleType: string;
  orgName: string;
  industry: string;
  notes: string;
};

const EMPTY: FormState = {
  name: "",
  email: "",
  phone: "",
  password: "",
  confirm: "",
  businessName: "",
  city: "",
  region: "",
  address: "",
  specialty: "",
  vehicleType: "motorbike",
  orgName: "",
  industry: "",
  notes: "",
};

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const [role, setRole] = useState<RoleKey | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!role) return;
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
      toast.error("Name, email and phone are required.");
      return;
    }
    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (form.password !== form.confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    const applicantData: Record<string, unknown> = { notes: form.notes.trim() || undefined };
    if (role === "center") {
      applicantData["businessName"] = form.businessName.trim();
      applicantData["address"] = form.address.trim();
      applicantData["city"] = form.city.trim();
      applicantData["specialty"] = form.specialty.trim();
    } else if (role === "vendor") {
      applicantData["businessName"] = form.businessName.trim();
      applicantData["city"] = form.city.trim();
      applicantData["region"] = form.region.trim();
    } else if (role === "delivery") {
      applicantData["city"] = form.city.trim();
      applicantData["region"] = form.region.trim();
      applicantData["vehicleType"] = form.vehicleType;
    } else if (role === "fleet") {
      applicantData["orgName"] = form.orgName.trim();
      applicantData["industry"] = form.industry.trim();
      applicantData["city"] = form.city.trim();
      applicantData["region"] = form.region.trim();
    }
    setSubmitting(true);
    try {
      await signupApi({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
        requestedRole: role,
        applicantData,
      });
      setSubmitted(true);
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Could not submit your application.";
      toast.error(
        msg.includes("already exists")
          ? msg
          : "Could not submit your application. The email may already be in use.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Shell>
        <Card className="max-w-xl mx-auto">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              Application received
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              Thanks, {form.name.split(" ")[0] || "there"}. Our team will review
              your application and you'll be able to sign in as soon as you're
              approved.
            </p>
            <p className="text-muted-foreground">
              You won't be able to sign in until then. We'll surface the result
              the next time you try to log in.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <Button onClick={() => setLocation("/login")}>Back to sign in</Button>
              <Button variant="ghost" onClick={() => setLocation("/")}>Home</Button>
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (!role) {
    return (
      <Shell>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Apply to use AutoCare</h1>
            <p className="text-sm text-muted-foreground">
              Pick the role that best describes you. Each application is
              reviewed before your account is activated.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ROLES.map((r) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRole(r.key)}
                  className="text-left rounded-lg border bg-card hover:bg-muted/40 hover:border-primary/40 transition-colors p-5 space-y-3"
                >
                  <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-semibold">{r.label}</div>
                    <div className="text-xs text-muted-foreground mt-1">{r.blurb}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </Shell>
    );
  }

  const meta = ROLES.find((r) => r.key === role)!;
  const Icon = meta.icon;

  return (
    <Shell>
      <Card className="max-w-2xl mx-auto">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-2xl flex items-center gap-2">
              <Icon className="h-5 w-5 text-primary" /> Apply as {meta.label.toLowerCase()}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{meta.blurb}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRole(null)}
            className="gap-1"
          >
            <ArrowLeft className="h-4 w-4" /> Change role
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Your full name" required>
                <Input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Kojo Mensah" />
              </Field>
              <Field label="Phone" required>
                <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+233 ..." />
              </Field>
              <Field label="Email" required>
                <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="you@example.com" />
              </Field>
              <Field label="Password" required>
                <Input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} />
              </Field>
              <Field label="Confirm password" required>
                <Input type="password" value={form.confirm} onChange={(e) => update("confirm", e.target.value)} />
              </Field>
            </div>

            {(role === "center" || role === "vendor") && (
              <Field label="Business name" required>
                <Input value={form.businessName} onChange={(e) => update("businessName", e.target.value)} placeholder="Apex Auto Works" />
              </Field>
            )}
            {role === "fleet" && (
              <Field label="Organisation name" required>
                <Input value={form.orgName} onChange={(e) => update("orgName", e.target.value)} placeholder="MTN Ghana" />
              </Field>
            )}
            {(role === "center" || role === "vendor" || role === "delivery" || role === "fleet") && (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="City">
                  <Input value={form.city} onChange={(e) => update("city", e.target.value)} placeholder="Accra" />
                </Field>
                {role !== "center" && (
                  <Field label="Region">
                    <Input value={form.region} onChange={(e) => update("region", e.target.value)} placeholder="Greater Accra" />
                  </Field>
                )}
              </div>
            )}
            {role === "center" && (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Address">
                  <Input value={form.address} onChange={(e) => update("address", e.target.value)} placeholder="12 Industrial Ave" />
                </Field>
                <Field label="Primary specialty">
                  <Input value={form.specialty} onChange={(e) => update("specialty", e.target.value)} placeholder="Diesel engines" />
                </Field>
              </div>
            )}
            {role === "delivery" && (
              <Field label="Vehicle type">
                <Input value={form.vehicleType} onChange={(e) => update("vehicleType", e.target.value)} placeholder="motorbike" />
              </Field>
            )}
            {role === "fleet" && (
              <Field label="Industry">
                <Input value={form.industry} onChange={(e) => update("industry", e.target.value)} placeholder="Telecoms" />
              </Field>
            )}

            <Field label="Anything else we should know? (optional)">
              <Textarea
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                rows={3}
                placeholder="Number of vehicles, years in business, etc."
              />
            </Field>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Submitting…" : "Submit application"}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              You'll upload your KYC documents (ID, business reg, etc.) after
              your application is approved.
            </p>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2 text-primary font-bold text-xl cursor-pointer">
              <Wrench className="h-6 w-6" />
              <span>AutoCare</span>
            </div>
          </Link>
          <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Apply for access
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10">{children}</main>
    </div>
  );
}
