import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useFleetOrgId } from "@/lib/role";
import { useMyFleetOrgs, useUpdateFleetOrg, type FleetOrg } from "@/lib/fleet-api";

export default function FleetSettingsPage() {
  const orgId = useFleetOrgId();
  const { data: mine } = useMyFleetOrgs();
  const update = useUpdateFleetOrg(orgId);
  const org = mine?.organizations.find((o) => o.id === orgId) ?? null;

  const [form, setForm] = useState<Partial<FleetOrg>>({});

  useEffect(() => {
    if (org) {
      setForm({
        name: org.name,
        industry: org.industry ?? "",
        contactName: org.contactName,
        contactPhone: org.contactPhone,
        contactEmail: org.contactEmail ?? "",
        billingAddress: org.billingAddress ?? "",
        city: org.city ?? "",
        region: org.region ?? "",
        logoUrl: org.logoUrl ?? "",
      });
    }
  }, [org]);

  if (!orgId || !org) {
    return <div className="p-8 text-sm text-muted-foreground">No org selected.</div>;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({
        ...form,
        // Strip empty strings so optional fields go back as null on the server.
        industry: form.industry || undefined,
        contactEmail: form.contactEmail || undefined,
        billingAddress: form.billingAddress || undefined,
        city: form.city || undefined,
        region: form.region || undefined,
        logoUrl: form.logoUrl || undefined,
      });
      toast.success("Fleet profile updated.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <PageHeader
        title="Fleet settings"
        description="Update your organisation's profile and billing contact."
      />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Parts order approvals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 p-4">
            <div className="space-y-1">
              <div className="font-medium text-sm">Require finance approval</div>
              <p className="text-xs text-muted-foreground max-w-md">
                When on, parts orders submitted by managers and drivers land in
                the finance queue for approval and payment. Admins, finance, and
                members with the direct-checkout override can still pay
                immediately.
              </p>
            </div>
            <Switch
              checked={!!org.requireFinanceApproval}
              disabled={update.isPending}
              onCheckedChange={async (v) => {
                try {
                  await update.mutateAsync({ requireFinanceApproval: v });
                  toast.success(
                    v ? "Finance approval is now required." : "Finance approval turned off.",
                  );
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Organisation profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Organisation name">
                <Input
                  value={form.name ?? ""}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </Field>
              <Field label="Industry">
                <Input
                  value={form.industry ?? ""}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}
                />
              </Field>
              <Field label="Contact name">
                <Input
                  value={form.contactName ?? ""}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  required
                />
              </Field>
              <Field label="Contact phone">
                <Input
                  value={form.contactPhone ?? ""}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
                  required
                />
              </Field>
              <Field label="Contact email">
                <Input
                  type="email"
                  value={form.contactEmail ?? ""}
                  onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                />
              </Field>
              <Field label="Logo URL">
                <Input
                  type="url"
                  value={form.logoUrl ?? ""}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                />
              </Field>
              <Field label="City">
                <Input
                  value={form.city ?? ""}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </Field>
              <Field label="Region">
                <Input
                  value={form.region ?? ""}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Billing address">
              <Textarea
                value={form.billingAddress ?? ""}
                onChange={(e) => setForm({ ...form, billingAddress: e.target.value })}
                rows={3}
              />
            </Field>
            <div>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "Saving..." : "Save changes"}
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
