import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, Trash2, UserCircle2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useFleetOrgId } from "@/lib/role";
import {
  useFleetMembers,
  useUpsertFleetMember,
  useRemoveFleetMember,
  useMyFleetOrgs,
  type FleetMemberRole,
} from "@/lib/fleet-api";

const ROLE_LABEL: Record<FleetMemberRole, string> = {
  admin: "Admin",
  finance: "Finance",
  manager: "Manager",
  driver: "Driver",
};

const ROLE_HINT: Record<FleetMemberRole, string> = {
  admin: "Full control — manage team, fleet, billing.",
  finance: "Approves & pays parts orders, sees billing.",
  manager: "Places parts orders for the team.",
  driver: "Requests parts for their assigned vehicle.",
};

const ROLE_BADGE_VARIANT: Record<FleetMemberRole, "default" | "secondary" | "outline"> = {
  admin: "default",
  finance: "default",
  manager: "secondary",
  driver: "outline",
};

export default function FleetDriversPage() {
  const orgId = useFleetOrgId();
  const { data: mine } = useMyFleetOrgs();
  const org = mine?.organizations.find((o) => o.id === orgId) ?? null;
  const { data, isLoading } = useFleetMembers(orgId);
  const upsert = useUpsertFleetMember(orgId);
  const remove = useRemoveFleetMember(orgId);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    phone: string;
    role: FleetMemberRole;
    canCheckoutDirectly: boolean;
  }>({ name: "", phone: "", role: "driver", canCheckoutDirectly: false });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await upsert.mutateAsync({
        name: form.name,
        phone: form.phone,
        role: form.role,
        canCheckoutDirectly: form.canCheckoutDirectly,
      });
      toast.success(`${ROLE_LABEL[form.role]} added.`);
      setForm({ name: "", phone: "", role: "driver", canCheckoutDirectly: false });
      setOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const toggleCheckout = async (
    phone: string,
    name: string,
    role: FleetMemberRole,
    next: boolean,
  ) => {
    try {
      await upsert.mutateAsync({ phone, name, role, canCheckoutDirectly: next });
      toast.success(
        next ? `${name} can now checkout directly.` : `${name} must submit orders for approval.`,
      );
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onRemove = async (phone: string, name: string) => {
    if (!confirm(`Remove ${name} from this fleet?`)) return;
    try {
      await remove.mutateAsync(phone);
      toast.success("Removed.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!orgId) return <div className="p-8 text-sm text-muted-foreground">No org selected.</div>;
  if (isLoading) return <div className="p-8">Loading team...</div>;

  const members = data?.members ?? [];
  const requireApproval = org?.requireFinanceApproval ?? false;
  const myRole = org?.myRole;
  const canManage = myRole === "admin";

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <PageHeader
        title="Team & roles"
        description="Invite admins, finance, managers, and drivers. Roles control what each person can do."
        actions={
          canManage ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <UserPlus className="h-4 w-4 mr-2" /> Invite member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite team member</DialogTitle>
                </DialogHeader>
                <form onSubmit={onSubmit} className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Full name</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Phone number</Label>
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="+233 24 100 0002"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Role</Label>
                    <Select
                      value={form.role}
                      onValueChange={(v) =>
                        setForm({ ...form, role: v as FleetMemberRole })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="finance">Finance</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="driver">Driver</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{ROLE_HINT[form.role]}</p>
                  </div>
                  {requireApproval &&
                    (form.role === "manager" || form.role === "driver") && (
                      <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/40 p-3">
                        <div className="text-xs">
                          <div className="font-medium">Allow direct checkout</div>
                          <div className="text-muted-foreground">
                            Bypass the finance approval queue for this person.
                          </div>
                        </div>
                        <Switch
                          checked={form.canCheckoutDirectly}
                          onCheckedChange={(v) =>
                            setForm({ ...form, canCheckoutDirectly: v })
                          }
                        />
                      </div>
                    )}
                  <DialogFooter>
                    <Button type="submit" disabled={upsert.isPending}>
                      {upsert.isPending ? "Saving..." : "Invite"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      {requireApproval && (
        <Card className="border-amber-200 bg-amber-50/60 dark:bg-amber-950/20">
          <CardContent className="py-3 px-4 text-xs flex items-center gap-2 text-amber-900 dark:text-amber-200">
            <ShieldCheck className="h-4 w-4" />
            Finance approval is on. Managers and drivers submit parts orders for
            approval unless given the direct-checkout override.
          </CardContent>
        </Card>
      )}

      {members.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No team members yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {members.map((m) => {
            const role = m.role as FleetMemberRole;
            const showOverride =
              requireApproval && (role === "manager" || role === "driver");
            return (
              <Card key={m.phone}>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full bg-muted h-10 w-10 flex items-center justify-center">
                      <UserCircle2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.phone}</div>
                    </div>
                    <Badge variant={ROLE_BADGE_VARIANT[role] ?? "secondary"}>
                      {ROLE_LABEL[role] ?? role}
                    </Badge>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(m.phone, m.name)}
                        aria-label="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {showOverride && (
                    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                      <div className="text-xs">
                        <div className="font-medium">Direct checkout</div>
                        <div className="text-muted-foreground">
                          {m.canCheckoutDirectly
                            ? "Skips the finance queue."
                            : "Orders go to finance for approval."}
                        </div>
                      </div>
                      <Switch
                        checked={m.canCheckoutDirectly}
                        disabled={!canManage || upsert.isPending}
                        onCheckedChange={(v) => toggleCheckout(m.phone, m.name, role, v)}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
