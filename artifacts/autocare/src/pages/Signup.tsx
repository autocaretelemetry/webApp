import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  signup as signupApi,
  verifySignupCode as verifySignupCodeApi,
  resendSignupVerification as resendSignupVerificationApi,
  ApiError,
} from "@workspace/api-client-react";
import type {
  AuthedUser,
  SignupVerificationStatus,
  VerifySignupCodeInputChannel,
} from "@workspace/api-client-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const NOTIFICATION_CHANNELS = ["email", "whatsapp"] as const;
type NotifChannel = (typeof NOTIFICATION_CHANNELS)[number];

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
  // Allow the page to be deep-linked with a pre-selected role,
  // e.g. the share-link "Create a renter account" CTA points at
  // `/signup?role=renter`. (We don't honour `?next=` here — applicants
  // must wait for super-admin approval before they can use the
  // destination, so we drop the user on the standard "application
  // submitted" screen.)
  const search = useSearch();
  const initialRole = useMemo<RoleKey | null>(() => {
    const raw = new URLSearchParams(search).get("role");
    if (!raw) return null;
    return ROLES.find((r) => r.key === raw)?.key ?? null;
  }, [search]);
  const [role, setRole] = useState<RoleKey | null>(initialRole);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [verification, setVerification] = useState<{
    userId: string;
    pending: VerifySignupCodeInputChannel[];
    verified: VerifySignupCodeInputChannel[];
  } | null>(null);
  const [channels, setChannels] = useState<NotifChannel[]>(() => [
    ...NOTIFICATION_CHANNELS,
  ]);

  const update = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleChannel = (channel: NotifChannel, on: boolean) => {
    setChannels((prev) => {
      const next = new Set(prev);
      if (on) next.add(channel);
      else next.delete(channel);
      return NOTIFICATION_CHANNELS.filter((c) => next.has(c));
    });
  };

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
    if (channels.length === 0) {
      toast.error("Pick at least one notification channel so we can reach you.");
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
      const created = (await signupApi({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
        requestedRole: role,
        applicantData,
        notificationChannels: channels,
      })) as AuthedUser;
      const pendingFromServer =
        (created.pendingVerificationChannels ?? []) as VerifySignupCodeInputChannel[];
      // Server tells us exactly which channels need a code. If both came
      // back already verified (e.g. user has no phone and only picked
      // email and somehow it pre-verified — defensive fallback), skip
      // straight to the success screen.
      if (pendingFromServer.length === 0) {
        setSubmitted(true);
      } else {
        setVerification({
          userId: created.id,
          pending: pendingFromServer,
          verified: channels.filter(
            (c) =>
              !pendingFromServer.includes(c as VerifySignupCodeInputChannel),
          ) as VerifySignupCodeInputChannel[],
        });
      }
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

  if (verification) {
    return (
      <Shell>
        <VerificationStep
          state={verification}
          contactFor={(c) =>
            c === "email" ? form.email.trim() : form.phone.trim()
          }
          onAllVerified={() => {
            setVerification(null);
            setSubmitted(true);
          }}
          onUpdate={(next) => setVerification(next)}
        />
      </Shell>
    );
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

            <div className="space-y-2 rounded-md border bg-muted/30 p-4">
              <Label>How should we reach you with the decision?</Label>
              <p className="text-xs text-muted-foreground">
                We'll send updates about your application and KYC review on the
                channels you tick. You can change this later from your profile.
              </p>
              <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={channels.includes("email")}
                    onCheckedChange={(v) => toggleChannel("email", v === true)}
                  />
                  Email
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={channels.includes("whatsapp")}
                    onCheckedChange={(v) => toggleChannel("whatsapp", v === true)}
                  />
                  WhatsApp
                </label>
              </div>
            </div>

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

function VerificationStep({
  state,
  contactFor,
  onAllVerified,
  onUpdate,
}: {
  state: {
    userId: string;
    pending: VerifySignupCodeInputChannel[];
    verified: VerifySignupCodeInputChannel[];
  };
  contactFor: (channel: VerifySignupCodeInputChannel) => string;
  onAllVerified: () => void;
  onUpdate: (
    next: {
      userId: string;
      pending: VerifySignupCodeInputChannel[];
      verified: VerifySignupCodeInputChannel[];
    },
  ) => void;
}) {
  return (
    <Card className="max-w-xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl flex items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          Confirm your contact details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <p className="text-muted-foreground">
          We sent a 6-digit code to each channel you ticked. Enter the codes
          below so we know how to reach you with your application result.
        </p>
        {state.verified.length > 0 && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-900 px-3 py-2 text-xs">
            Verified: {state.verified.map(channelLabel).join(", ")}
          </div>
        )}
        {state.pending.map((channel) => (
          <ChannelVerifier
            key={channel}
            userId={state.userId}
            channel={channel}
            recipient={contactFor(channel)}
            onVerified={() => {
              const nextPending = state.pending.filter((c) => c !== channel);
              const nextVerified = [...state.verified, channel];
              if (nextPending.length === 0) {
                onAllVerified();
              } else {
                onUpdate({
                  userId: state.userId,
                  pending: nextPending,
                  verified: nextVerified,
                });
              }
            }}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function channelLabel(c: VerifySignupCodeInputChannel): string {
  return c === "email" ? "Email" : "WhatsApp";
}

function ChannelVerifier({
  userId,
  channel,
  recipient,
  onVerified,
}: {
  userId: string;
  channel: VerifySignupCodeInputChannel;
  recipient: string;
  onVerified: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the resend cooldown locally. The server is the source of truth
  // (it returns retryAfterSeconds and 429 on repeat), but a ticking
  // countdown makes the UX obvious. Initial value matches the server-side
  // cooldown so the freshly-issued signup code can't be re-requested for
  // 60s after the page loads.
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const clean = code.trim();
    if (clean.length < 4) {
      setError("Enter the code we sent you.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = (await verifySignupCodeApi({
        userId,
        channel,
        code: clean,
      })) as SignupVerificationStatus;
      if (
        result.verifiedChannels.includes(
          channel as unknown as SignupVerificationStatus["verifiedChannels"][number],
        )
      ) {
        onVerified();
      } else {
        setError("That code didn't match. Please try again.");
      }
    } catch (err) {
      const msg =
        err instanceof ApiError && err.data && typeof err.data === "object"
          ? (err.data as { error?: string }).error
          : err instanceof Error
            ? err.message
            : null;
      setError(msg || "Could not verify that code.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = (await resendSignupVerificationApi({
        userId,
        channel,
      })) as SignupVerificationStatus & { retryAfterSeconds?: number | null };
      setCooldown(result.retryAfterSeconds ?? 60);
      toast.success(`New code sent to your ${channelLabel(channel).toLowerCase()}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const data = (err.data as { retryAfterSeconds?: number } | null) ?? null;
        const wait = data?.retryAfterSeconds ?? 60;
        setCooldown(wait);
        setError(`Please wait ${wait}s before requesting another code.`);
      } else {
        const msg =
          err instanceof ApiError && err.data && typeof err.data === "object"
            ? (err.data as { error?: string }).error
            : err instanceof Error
              ? err.message
              : null;
        setError(msg || "Could not resend that code.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <div className="font-medium">{channelLabel(channel)}</div>
        <div className="text-xs text-muted-foreground truncate ml-3 max-w-[60%]">
          {recipient}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label={`${channelLabel(channel)} verification code`}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Verify"}
        </Button>
      </div>
      <div className="flex items-center justify-between text-xs">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-1 py-0.5 text-xs"
          disabled={busy || cooldown > 0}
          onClick={resend}
        >
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Button>
        {error && <span className="text-destructive">{error}</span>}
      </div>
    </form>
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
