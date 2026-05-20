import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useCreateFleetOrg } from "@/lib/fleet-api";
import { setFleetOrgId, setRole } from "@/lib/role";

/**
 * Public "Register your fleet" page reachable from the marketing landing.
 * Requires the user to already be signed in (we route them to the regular
 * login first and bring them back). Once submitted, we set the fleet org
 * ID + role and hand off to the fleet dashboard.
 */
export default function RegisterFleet() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const create = useCreateFleetOrg();

  const [form, setForm] = useState({
    name: "",
    industry: "",
    contactName: user?.name ?? "",
    contactPhone: user?.phone ?? "",
    contactEmail: user?.email ?? "",
    city: "",
    region: "",
  });

  if (loading) return <div className="p-8">Loading...</div>;

  if (!user) {
    return (
      <div className="max-w-md mx-auto p-8 text-center space-y-4">
        <Building2 className="h-10 w-10 mx-auto text-muted-foreground" />
        <h2 className="text-2xl font-semibold">Sign in to register a fleet</h2>
        <p className="text-muted-foreground">
          We tie fleet ownership to your AutoCare account so you can invite drivers
          right after.
        </p>
        <Link href={`/login?next=${encodeURIComponent("/register-fleet")}`}>
          <Button>Sign in or create account</Button>
        </Link>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const org = await create.mutateAsync({
        name: form.name,
        industry: form.industry || undefined,
        contactName: form.contactName,
        contactPhone: form.contactPhone,
        contactEmail: form.contactEmail || undefined,
        city: form.city || undefined,
        region: form.region || undefined,
      });
      setFleetOrgId(org.id);
      setRole("fleet");
      toast.success(`${org.name} registered. Welcome aboard.`);
      setLocation("/");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-primary" />
            <CardTitle>Register your fleet</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Organisation name">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. MTN Ghana"
                  required
                />
              </Field>
              <Field label="Industry (optional)">
                <Input
                  value={form.industry}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}
                  placeholder="Telecommunications"
                />
              </Field>
              <Field label="Contact name">
                <Input
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  required
                />
              </Field>
              <Field label="Contact phone">
                <Input
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  required
                />
              </Field>
              <Field label="Contact email (optional)">
                <Input
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                />
              </Field>
              <Field label="City">
                <Input
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
              <Field label="Region">
                <Input
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              You'll start on the free tier (3 vehicles). Upgrade to Fleet Starter or
              Fleet Pro any time from your dashboard.
            </p>
            <div className="flex justify-end gap-2">
              <Link href="/">
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating..." : "Create fleet"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
