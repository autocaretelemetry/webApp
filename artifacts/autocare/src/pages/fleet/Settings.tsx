import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { MapPin, Pencil, Star, Trash2 } from "lucide-react";
import { useFleetOrgId } from "@/lib/role";
import {
  useMyFleetOrgs,
  useUpdateFleetOrg,
  useFleetAddresses,
  useCreateFleetAddress,
  useUpdateFleetAddress,
  useDeleteFleetAddress,
  type FleetOrg,
  type FleetAddress,
  type FleetAddressInput,
} from "@/lib/fleet-api";

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

      {(org.myRole === "admin" ||
        org.myRole === "finance" ||
        org.myRole === "manager") && (
        <FleetAddressBookCard orgId={orgId} myRole={org.myRole} />
      )}

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

const EMPTY_ADDRESS_FORM: FleetAddressInput = {
  label: "",
  recipientName: "",
  recipientPhone: "",
  addressLine: "",
  city: "",
  region: "",
};

function FleetAddressBookCard({
  orgId,
  myRole,
}: {
  orgId: string;
  myRole: "admin" | "finance" | "manager" | "driver";
}) {
  const { data } = useFleetAddresses(orgId);
  const create = useCreateFleetAddress(orgId);
  const update = useUpdateFleetAddress(orgId);
  const del = useDeleteFleetAddress(orgId);

  const addresses = data?.addresses ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<FleetAddressInput>(EMPTY_ADDRESS_FORM);
  const busy = create.isPending || update.isPending || del.isPending;

  const beginEdit = (a: FleetAddress) => {
    setEditingId(a.id);
    setShowAdd(false);
    setForm({
      label: a.label,
      recipientName: a.recipientName,
      recipientPhone: a.recipientPhone,
      addressLine: a.addressLine,
      city: a.city,
      region: a.region,
      isDefault: a.isDefault,
    });
  };

  const beginAdd = () => {
    setEditingId(null);
    setShowAdd(true);
    setForm(EMPTY_ADDRESS_FORM);
  };

  const cancel = () => {
    setEditingId(null);
    setShowAdd(false);
    setForm(EMPTY_ADDRESS_FORM);
  };

  const validate = (): boolean => {
    if (!form.label.trim() || !form.recipientName.trim() ||
        !form.recipientPhone.trim() || !form.addressLine.trim()) {
      toast.error("Label, recipient, phone, and address are required.");
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, data: form });
        toast.success("Address updated.");
      } else {
        await create.mutateAsync(form);
        toast.success("Address added to the fleet book.");
      }
      cancel();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const makeDefault = async (a: FleetAddress) => {
    try {
      await update.mutateAsync({ id: a.id, data: { isDefault: true } });
      toast.success(`${a.label} is now the default.`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async (a: FleetAddress) => {
    if (!confirm(`Remove "${a.label}" from the address book?`)) return;
    try {
      await del.mutateAsync(a.id);
      toast.success("Address removed.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Shipping address book</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Entries here appear in the dropdown at parts-order checkout for
          every fleet member. {myRole === "manager"
            ? "Managers, finance, and admins can edit this list."
            : "Admins, finance, and managers can edit this list."}
        </p>

        {addresses.length === 0 && !showAdd && (
          <p className="text-sm text-muted-foreground border rounded-md p-4 bg-muted/30">
            No saved addresses yet. Add your HQ, branch garages, or off-site
            workshops to make fleet checkout one click.
          </p>
        )}

        <ul className="divide-y rounded-md border">
          {addresses.map((a) => (
            <li key={a.id} className="p-3 flex items-start gap-3">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{a.label}</span>
                  {a.isDefault && (
                    <span className="text-[10px] uppercase tracking-wide rounded bg-primary/10 text-primary px-1.5 py-0.5">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {a.recipientName} · {a.recipientPhone}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.addressLine}
                  {a.city ? `, ${a.city}` : ""}
                  {a.region ? `, ${a.region}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {!a.isDefault && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => makeDefault(a)}
                    disabled={busy}
                    title="Make default"
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => beginEdit(a)}
                  disabled={busy}
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(a)}
                  disabled={busy}
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>

        {(showAdd || editingId) && (
          <div className="rounded-md border p-4 space-y-3 bg-muted/30">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Label">
                <Input
                  placeholder="HQ, Tema branch, …"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </Field>
              <Field label="Recipient name">
                <Input
                  value={form.recipientName}
                  onChange={(e) => setForm({ ...form, recipientName: e.target.value })}
                />
              </Field>
              <Field label="Recipient phone">
                <Input
                  value={form.recipientPhone}
                  onChange={(e) => setForm({ ...form, recipientPhone: e.target.value })}
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
            <Field label="Street address">
              <Textarea
                rows={2}
                value={form.addressLine}
                onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
              />
              Make this the default at checkout
            </label>
            <div className="flex items-center gap-2">
              <Button onClick={submit} disabled={busy} size="sm">
                {editingId ? "Save changes" : "Add address"}
              </Button>
              <Button onClick={cancel} disabled={busy} size="sm" variant="ghost">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!showAdd && !editingId && (
          <div>
            <Button onClick={beginAdd} size="sm" variant="outline">
              Add address
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
