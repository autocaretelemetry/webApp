import { useState, useEffect, useMemo } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Wrench, LogIn, Clock, XCircle, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { ApiError } from "@workspace/api-client-react";

export default function Login() {
  const { user, login, loading } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();
  // Honour `?next=` so flows like the public share link can bring the
  // user back to the page they were trying to reach (e.g. the booking
  // page for a specific car) after a successful sign-in. Defaults to
  // the home route.
  const nextHref = useMemo(() => {
    const raw = new URLSearchParams(search).get("next");
    // Only accept same-app relative paths — never an absolute URL —
    // so a malicious share link can't redirect the user off-platform.
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
    return "/";
  }, [search]);
  const signupHref = useMemo(
    () => (nextHref === "/" ? "/signup" : `/signup?next=${encodeURIComponent(nextHref)}`),
    [nextHref],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusBanner, setStatusBanner] = useState<
    | { kind: "pending" }
    | { kind: "rejected"; note: string | null }
    | null
  >(null);

  useEffect(() => {
    if (!loading && user) navigate(nextHref, { replace: true });
  }, [loading, user, navigate, nextHref]);

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
      navigate(nextHref, { replace: true });
    } catch (err) {
      const data =
        err instanceof ApiError && err.data && typeof err.data === "object"
          ? (err.data as { reason?: string; note?: string | null })
          : null;
      if (data?.reason === "pending") {
        setStatusBanner({ kind: "pending" });
      } else if (data?.reason === "rejected") {
        setStatusBanner({ kind: "rejected", note: data.note ?? null });
      } else {
        toast.error("Invalid email or password");
      }
    } finally {
      setSubmitting(false);
    }
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

      <main className="flex-1 flex items-start justify-center max-w-md w-full mx-auto px-6 py-12">
        <Card className="w-full">
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
                  placeholder="you@example.com"
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
                  <Link href={signupHref} className="text-primary font-medium hover:underline inline-flex items-center gap-1">
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
      </main>
    </div>
  );
}
