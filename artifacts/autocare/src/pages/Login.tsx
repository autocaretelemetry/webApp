import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Wrench, LogIn, KeyRound, Clock, XCircle, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const DEMO = [
  { label: "Owner / Renter", email: "owner@autocare.test", password: "owner1234" },
  { label: "Service center", email: "center@autocare.test", password: "center1234" },
  { label: "Vendor", email: "vendor@autocare.test", password: "vendor1234" },
  { label: "Delivery", email: "delivery@autocare.test", password: "delivery1234" },
  { label: "Fleet admin", email: "fleet@autocare.test", password: "fleet1234" },
  { label: "Fleet finance", email: "finance@autocare.test", password: "finance1234" },
  { label: "Fleet driver", email: "driver@autocare.test", password: "driver1234" },
  { label: "Admin", email: "admin@autocare.test", password: "admin1234" },
  { label: "Super admin", email: "superadmin@autocare.test", password: "super1234" },
];

export default function Login() {
  const { user, login, loading } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<
    | { kind: "pending" }
    | { kind: "rejected"; note: string | null }
    | null
  >(null);

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [loading, user, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Enter your email and password");
      return;
    }
    setSubmitting(true);
    setStatusBanner(null);
    try {
      await login(email.trim(), password);
      toast.success("Welcome back");
      navigate("/", { replace: true });
    } catch (err) {
      // The generated client serializes the JSON body into the error message.
      // Try to parse a structured `{ reason, note }` payload before falling
      // back to the generic toast.
      const raw = err instanceof Error ? err.message : String(err);
      let parsed: { reason?: string; note?: string | null; error?: string } | null = null;
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {
        /* not JSON */
      }
      if (parsed?.reason === "pending") {
        setStatusBanner({ kind: "pending" });
      } else if (parsed?.reason === "rejected") {
        setStatusBanner({ kind: "rejected", note: parsed.note ?? null });
      } else {
        toast.error("Invalid email or password");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fill(seed: (typeof DEMO)[number]) {
    setEmail(seed.email);
    setPassword(seed.password);
  }

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
          <Link href="/">
            <Button variant="ghost" size="sm">
              Back to home
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 grid md:grid-cols-2 gap-8 max-w-6xl w-full mx-auto px-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <LogIn className="h-5 w-5 text-primary" />
              Sign in
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusBanner?.kind === "pending" && (
              <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3 text-sm flex items-start gap-2">
                <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold">Application under review</div>
                  <div className="text-xs">
                    Your account is waiting for super-admin approval. We'll
                    unlock sign-in as soon as it's reviewed.
                  </div>
                </div>
              </div>
            )}
            {statusBanner?.kind === "rejected" && (
              <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 text-destructive p-3 text-sm flex items-start gap-2">
                <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-semibold">Application not approved</div>
                  {statusBanner.note && (
                    <div className="text-xs mt-1">{statusBanner.note}</div>
                  )}
                </div>
              </div>
            )}
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@autocare.test"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Signing in..." : "Sign in"}
              </Button>
              <div className="text-xs text-muted-foreground text-center space-y-1">
                <p>
                  New to AutoCare?{" "}
                  <Link href="/signup" className="text-primary font-medium hover:underline inline-flex items-center gap-1">
                    <UserPlus className="h-3 w-3" /> Apply for access
                  </Link>
                </p>
                <p>
                  Just want to rent a car?{" "}
                  <Link href="/rentals/signup" className="text-primary font-medium hover:underline">
                    Quick renter signup
                  </Link>
                </p>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-sidebar border-border/60">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Demo accounts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Tap a role to autofill the form, then press Sign in.
            </p>
            <div className="divide-y rounded-md border bg-card">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-muted/60 flex items-center justify-between gap-3"
                  onClick={() => fill(d)}
                >
                  <span className="text-sm font-medium">{d.label}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {d.email}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
