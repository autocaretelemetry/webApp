import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Wrench, LogIn, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const DEMO = [
  { label: "Owner", email: "owner@autocare.test", password: "owner1234" },
  { label: "Service center", email: "center@autocare.test", password: "center1234" },
  { label: "Vendor", email: "vendor@autocare.test", password: "vendor1234" },
  { label: "Delivery", email: "delivery@autocare.test", password: "delivery1234" },
  { label: "Admin", email: "admin@autocare.test", password: "admin1234" },
  { label: "Super admin", email: "superadmin@autocare.test", password: "super1234" },
];

export default function Login() {
  const { user, login, loading } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    try {
      await login(email.trim(), password);
      toast.success("Welcome back");
      navigate("/", { replace: true });
    } catch {
      toast.error("Invalid email or password");
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
              <p className="text-xs text-muted-foreground text-center">
                New here and want to rent a car?{" "}
                <Link href="/rentals/signup" className="text-primary font-medium hover:underline">
                  Create an account
                </Link>
              </p>
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
