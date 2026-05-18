import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPlatformStaff,
  useCreatePlatformStaff,
  useUpdatePlatformStaff,
  useDeletePlatformStaff,
} from "@workspace/api-client-react";
import { getListPlatformStaffQueryKey } from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminEntityActions } from "@/components/admin/AdminEntityActions";
import { UserCog, Plus, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const ALL_PERMS: { key: string; label: string }[] = [
  { key: "manage_centers", label: "Service Centers" },
  { key: "manage_vendors", label: "Vendors" },
  { key: "manage_mechanics", label: "Mechanics" },
  { key: "manage_agents", label: "Delivery Agents" },
  { key: "manage_subscriptions", label: "Subscriptions" },
  { key: "manage_finance", label: "Finance & Revenue" },
  { key: "manage_staff", label: "Other Staff" },
];

type EditState = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  permissions: string[];
};

export default function AdminStaff() {
  const queryClient = useQueryClient();
  const params = { includeInactive: true };
  const { data: staff, isLoading } = useListPlatformStaff(params, {
    query: { queryKey: getListPlatformStaffQueryKey(params) },
  });

  const create = useCreatePlatformStaff();
  const update = useUpdatePlatformStaff();
  const remove = useDeletePlatformStaff();

  const [openNew, setOpenNew] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    email: string;
    role: "admin" | "staff";
    permissions: string[];
  }>({ name: "", email: "", role: "staff", permissions: [] });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListPlatformStaffQueryKey() });

  const submitNew = async () => {
    if (!draft.name.trim() || !draft.email.trim()) {
      toast.error("Name and email are required.");
      return;
    }
    try {
      await create.mutateAsync({
        data: {
          name: draft.name.trim(),
          email: draft.email.trim(),
          role: draft.role,
          permissions: draft.role === "admin" ? ALL_PERMS.map((p) => p.key) : draft.permissions,
        },
      });
      await invalidate();
      toast.success(`${draft.name} added.`);
      setOpenNew(false);
      setDraft({ name: "", email: "", role: "staff", permissions: [] });
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to add staff."));
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    try {
      await update.mutateAsync({
        staffId: edit.id,
        data: {
          name: edit.name,
          email: edit.email,
          role: edit.role,
          permissions: edit.role === "admin" ? ALL_PERMS.map((p) => p.key) : edit.permissions,
        },
      });
      await invalidate();
      toast.success("Permissions updated.");
      setEdit(null);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update staff."));
    }
  };

  const toggleActive = async (id: string, next: boolean) => {
    try {
      await update.mutateAsync({ staffId: id, data: { active: next } });
      await invalidate();
      toast.success(next ? "Reactivated." : "Suspended.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update staff."));
    }
  };

  const deleteStaff = async (id: string, name: string) => {
    try {
      await remove.mutateAsync({ staffId: id });
      await invalidate();
      toast.success(`${name} deleted.`);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to delete staff."));
    }
  };

  const busy = update.isPending || remove.isPending || create.isPending;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Platform Staff"
          description={`${staff?.length ?? 0} team members. Admins always have every permission; staff get exactly what you tick.`}
        />
        <Button onClick={() => setOpenNew(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add staff
        </Button>
      </div>

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-3">
        {staff?.map((s) => {
          const isAdmin = s.role === "admin";
          const permLabels = isAdmin
            ? ["Full access"]
            : ALL_PERMS.filter((p) => s.permissions.includes(p.key)).map((p) => p.label);
          return (
            <Card key={s.id} className={s.active ? "" : "opacity-60"}>
              <CardContent className="p-4 flex items-center gap-4">
                <div
                  className={`h-11 w-11 rounded-md flex items-center justify-center flex-shrink-0 ${
                    isAdmin
                      ? "bg-primary/10 text-primary"
                      : "bg-secondary/30 text-secondary-foreground"
                  }`}
                >
                  {isAdmin ? (
                    <ShieldCheck className="h-5 w-5" />
                  ) : (
                    <UserCog className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold truncate">{s.name}</p>
                    <span
                      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                        isAdmin
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s.role}
                    </span>
                    {!s.active && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                        Suspended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground inline-flex items-center gap-1 mt-1">
                    <Mail className="h-3 w-3" /> {s.email}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {permLabels.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground italic">
                        No permissions granted yet
                      </span>
                    ) : (
                      permLabels.map((p) => (
                        <span
                          key={p}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-foreground/80"
                        >
                          {p}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setEdit({
                        id: s.id,
                        name: s.name,
                        email: s.email,
                        role: s.role as "admin" | "staff",
                        permissions: s.permissions,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <AdminEntityActions
                    entityLabel="Staff Member"
                    active={s.active}
                    busy={busy}
                    onToggleActive={(next) => toggleActive(s.id, next)}
                    onDelete={() => deleteStaff(s.id, s.name)}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
        {staff && staff.length === 0 && (
          <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            No staff added yet.
          </div>
        )}
      </div>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add platform staff</DialogTitle>
            <DialogDescription>
              Admins automatically receive every permission. For staff, pick exactly what they can manage.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="staff-name">Name</Label>
              <Input
                id="staff-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">Email</Label>
              <Input
                id="staff-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={draft.role}
                onValueChange={(v) => setDraft({ ...draft, role: v as "admin" | "staff" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin (full access)</SelectItem>
                  <SelectItem value="staff">Staff (custom permissions)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.role === "staff" && (
              <div className="space-y-2">
                <Label>Permissions</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_PERMS.map((p) => {
                    const checked = draft.permissions.includes(p.key);
                    return (
                      <label
                        key={p.key}
                        className="flex items-center gap-2 text-sm cursor-pointer rounded-md border p-2 hover:bg-accent"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) =>
                            setDraft({
                              ...draft,
                              permissions: c
                                ? [...draft.permissions, p.key]
                                : draft.permissions.filter((x) => x !== p.key),
                            })
                          }
                        />
                        <span>{p.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNew(false)}>
              Cancel
            </Button>
            <Button onClick={submitNew} disabled={create.isPending}>
              Add staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit staff</DialogTitle>
            <DialogDescription>Update name, role, or specific permissions.</DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={edit.email}
                  onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select
                  value={edit.role}
                  onValueChange={(v) => setEdit({ ...edit, role: v as "admin" | "staff" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin (full access)</SelectItem>
                    <SelectItem value="staff">Staff (custom permissions)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {edit.role === "staff" && (
                <div className="space-y-2">
                  <Label>Permissions</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_PERMS.map((p) => {
                      const checked = edit.permissions.includes(p.key);
                      return (
                        <label
                          key={p.key}
                          className="flex items-center gap-2 text-sm cursor-pointer rounded-md border p-2 hover:bg-accent"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) =>
                              setEdit({
                                ...edit,
                                permissions: c
                                  ? [...edit.permissions, p.key]
                                  : edit.permissions.filter((x) => x !== p.key),
                              })
                            }
                          />
                          <span>{p.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
