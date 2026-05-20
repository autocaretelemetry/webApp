import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { signup as signupApi } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench, UserPlus, Car, ShieldCheck, IdCard } from "lucide-react";
import { toast } from "sonner";

/**
 * Public "Sign up to rent" entry point. Creates an `owner` account (renters
 * live under the owner role), seeds the local renter-profile cache with the
 * details they just typed so the next page is pre-filled, and forwards them
 * straight into the KYC form. The optional `?next=` query param is preserved
 * so we can deep-link from "Book this car" → signup → finish booking.
 */
export default function RentalsSignup() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { user, loading, refresh } = useAuth();
  const next = new URLSearchParams(search).get("next");
  const profileNext = `/rentals/profile${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirm: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Skip straight to the KYC step.
  useEffect(() => {
    if (!loading && user) setLocation(profileNext, { replace: true });
  }, [loading, user, profileNext, setLocation]);

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.phone.trim()) {
      toast.error("Name, email and phone are all required.");
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
    setSubmitting(true);
    try {
      await signupApi({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
      });
      // Refresh auth so the KYC page sees the freshly created user — the
      // page's phone-keyed lookup and prefilled fields read straight from
      // `useAuth()` now, no local mirror needed.
      await refresh();
      toast.success("Account created. Let's finish your renter profile.");
      setLocation(profileNext, { replace: true });
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Could not create your account.";
      toast.error(msg.includes("already exists") ? msg : "Could not create your account. The email may already be in use.");
    } finally {
      setSubmitting(false);
    }
  };

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
          <div className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 grid md:grid-cols-2 gap-8 max-w-6xl w-full mx-auto px-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" /> Sign up to rent a car
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="su-name">Full name</Label>
                <Input
                  id="su-name"
                  value={form.name}
                  autoComplete="name"
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Marcus Hale"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="su-email">Email</Label>
                <Input
                  id="su-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="su-phone">Phone</Label>
                <Input
                  id="su-phone"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  placeholder="+233 ..."
                />
                <p className="text-[11px] text-muted-foreground">
                  Used by car owners to reach you and as your unique renter ID.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="su-pw">Password</Label>
                  <Input
                    id="su-pw"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-confirm">Confirm password</Label>
                  <Input
                    id="su-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={form.confirm}
                    onChange={(e) => update("confirm", e.target.value)}
                  />
                </div>
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Creating account…" : "Create account & continue"}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Next step: upload your driver's licence and ID so owners can approve bookings.
              </p>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-sidebar border-border/60">
          <CardHeader>
            <CardTitle className="text-lg">How renting works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Step
              icon={UserPlus}
              title="Create your account"
              body="Takes about a minute. Email + password to sign in next time."
            />
            <Step
              icon={IdCard}
              title="Upload your KYC"
              body="Driver's licence and an ID document. Owners review these before approving."
            />
            <Step
              icon={Car}
              title="Browse and request a car"
              body="Pick a car, pick dates, and send a booking request to the owner."
            />
            <Step
              icon={ShieldCheck}
              title="Drive once approved"
              body="The owner confirms, and you pick up the car on the agreed date."
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Step({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof UserPlus;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-muted-foreground">{body}</div>
      </div>
    </div>
  );
}
