import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListServiceCenters,
  useListCenterStaff,
  useCreateCenterStaff,
  useUpdateCenterStaff,
  useDeleteCenterStaff,
} from "@workspace/api-client-react";
import { getListCenterStaffQueryKey } from "@workspace/api-client-react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { UserCog, Plus, Mail, Phone, ShieldCheck, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { resolveImageUrl } from "@/lib/format";

// Service-center-scoped permissions. Each one maps to a section of the
// center workspace; the server stores them as a string[] on center_staff.
const ALL_PERMS: { key: string; label: string; hint: string }[] = [
  { key: "manage_jobs", label: "Jobs", hint: "Accept requests, run jobs, mark complete" },
  { key: "manage_mechanics", label: "Mechanics", hint: "Add and assign workshop mechanics" },
  { key: "manage_invoices", label: "Invoices", hint: "Create and send invoices for completed work" },
  { key: "manage_retainers", label: "Retainer plans", hint: "Configure and sell retainer plans" },
  { key: "manage_parts_orders", label: "Parts orders", hint: "Buy parts from the marketplace" },
  { key: "manage_staff", label: "Staff", hint: "Invite and edit other staff members" },
];

type Role = "manager" | "staff";

type Draft = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: Role;
  permissions: string[];
};

type EditState = Omit<Draft, "password"> & { id: string };

const emptyDraft = (): Draft => ({
  name: "",
  email: "",
  phone: "",
  password: "",
  role: "staff",
  permissions: [],
});

function describeErr(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function CenterStaffPage() {
  const queryClient = useQueryClient();
  // For the MVP the operator is pinned to the first service center, mirroring
  // how the vendor staff page picks `vendors[0]`. Once we have real auth-to-
  // center membership we'll swap this for the logged-in user's center.
  const { data: centers, isLoading: centersLoading } = useListServiceCenters();
  const center = centers?.[0];
  const centerId = center?.id ?? "";

  const { data: staff, isLoading } = useListCenterStaff(centerId, {
    query: {
      enabled: !!center,
      queryKey: getListCenterStaffQueryKey(centerId),
    },
  });

  const create = useCreateCenterStaff();
  const update = useUpdateCenterStaff();
  const remove = useDeleteCenterStaff();

  const [openNew, setOpenNew] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [edit, setEdit] = useState<EditState | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCenterStaffQueryKey(centerId) });

  const allPermKeys = ALL_PERMS.map((p) => p.key);
  // Managers always carry the full permission set so the role badge can't
  // diverge from what they can actually do. Staff only get what's ticked.
  const permsFor = (role: Role, perms: string[]): string[] =>
    role === "manager" ? allPermKeys : perms;

  const submitNew = async () => {
    if (!center) return;
    if (!draft.name.trim() || !draft.email.trim()) {
      toast.error("Name and email are required.");
      return;
    }
    if (draft.password.length < 8) {
      toast.error("Initial password must be at least 8 characters.");
      return;
    }
    if (draft.role === "staff" && draft.permissions.length === 0) {
      toast.error("Pick at least one permission, or set role to Manager for full access.");
      return;
    }
    try {
      await create.mutateAsync({
        centerId: center.id,
        data: {
          name: draft.name.trim(),
          email: draft.email.trim(),
          password: draft.password,
          phone: draft.phone.trim() || null,
          role: draft.role,
          permissions: permsFor(draft.role, draft.permissions),
        },
      });
      await invalidate();
      toast.success(`${draft.name.trim()} added.`);
      setOpenNew(false);
      setDraft(emptyDraft());
    } catch (err) {
      toast.error(describeErr(err, "Failed to add staff."));
    }
  };

  const saveEdit = async () => {
    if (!edit || !center) return;
    if (!edit.name.trim() || !edit.email.trim()) {
      toast.error("Name and email are required.");
      return;
    }
    try {
      await update.mutateAsync({
        centerId: center.id,
        staffId: edit.id,
        data: {
          name: edit.name.trim(),
          email: edit.email.trim(),
          phone: edit.phone.trim() || null,
          role: edit.role,
          permissions: permsFor(edit.role, edit.permissions),
        },
      });
      await invalidate();
      toast.success("Staff updated.");
      setEdit(null);
    } catch (err) {
      toast.error(describeErr(err, "Failed to update staff."));
    }
  };

  const toggleActive = async (id: string, next: boolean) => {
    if (!center) return;
    try {
      await update.mutateAsync({
        centerId: center.id,
        staffId: id,
        data: { active: next },
      });
      await invalidate();
      toast.success(next ? "Reactivated." : "Suspended.");
    } catch (err) {
      toast.error(describeErr(err, "Failed to update staff."));
    }
  };

  const deleteStaff = async (id: string, name: string) => {
    if (!center) return;
    try {
      await remove.mutateAsync({ centerId: center.id, staffId: id });
      await invalidate();
      toast.success(`${name} removed.`);
    } catch (err) {
      toast.error(describeErr(err, "Failed to delete staff."));
    }
  };

  if (centersLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!center) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No service center is linked to this account yet.
      </div>
    );
  }

  const busy = create.isPending || update.isPending || remove.isPending;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="My staff"
          description={`${staff?.length ?? 0} team members at ${center.name}. Managers have full access; staff get only the permissions you tick.`}
        />
        <Button onClick={() => setOpenNew(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add staff
        </Button>
      </div>

      {isLoading && (
        <div className="p-6 text-sm text-muted-foreground">Loading team…</div>
      )}

      <div className="grid gap-3">
        {staff?.map((s) => {
          const isManager = s.role === "manager";
          const permLabels = isManager
            ? ["Full access"]
            : ALL_PERMS.filter((p) => s.permissions.includes(p.key)).map((p) => p.label);
          return (
            <Card key={s.id} className={s.active ? "" : "opacity-60"}>
              <CardContent className="p-4 flex items-center gap-4">
                <div
                  className={`h-11 w-11 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0 ${
                    isManager
                      ? "bg-primary/10 text-primary"
                      : "bg-secondary/30 text-secondary-foreground"
                  }`}
                >
                  {s.avatarUrl ? (
                    <img
                      src={resolveImageUrl(s.avatarUrl)}
                      alt={s.name}
                      className="h-full w-full object-cover"
                    />
                  ) : isManager ? (
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
                        isManager
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
                  <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {s.email}
                    </span>
                    {s.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {s.phone}
                      </span>
                    )}
                  </div>
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
                        phone: s.phone ?? "",
                        role: (s.role as Role) ?? "staff",
                        permissions: s.permissions,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => toggleActive(s.id, !s.active)}
                    >
                      {s.active ? "Suspend" : "Reactivate"}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {s.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            They will lose all access immediately. This can't be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteStaff(s.id, s.name)}>
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
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

      <Dialog
        open={openNew}
        onOpenChange={(o) => {
          setOpenNew(o);
          if (!o) setDraft(emptyDraft());
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add staff member</DialogTitle>
            <DialogDescription>
              Managers automatically get every permission. Staff get exactly what you tick.
            </DialogDescription>
          </DialogHeader>
          <StaffForm draft={draft} setDraft={setDraft} showPassword />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNew(false)}>
              Cancel
            </Button>
            <Button onClick={submitNew} disabled={create.isPending} className="gap-2">
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit staff member</DialogTitle>
            <DialogDescription>Update details, role, or permissions.</DialogDescription>
          </DialogHeader>
          {edit && (
            <StaffForm
              draft={edit}
              setDraft={(d) =>
                setEdit((prev) => (prev ? { ...prev, ...(typeof d === "function" ? d(prev) : d) } : prev))
              }
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={update.isPending} className="gap-2">
              {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StaffForm<T extends Omit<Draft, "password"> & { password?: string }>({
  draft,
  setDraft,
  showPassword,
}: {
  draft: T;
  setDraft: (updater: T | ((prev: T) => T)) => void;
  showPassword?: boolean;
}) {
  const patch = (p: Partial<T>) =>
    setDraft((prev) => ({ ...prev, ...p }) as T);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cs-name">Name</Label>
        <Input
          id="cs-name"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value } as Partial<T>)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cs-email">Email</Label>
          <Input
            id="cs-email"
            type="email"
            value={draft.email}
            onChange={(e) => patch({ email: e.target.value } as Partial<T>)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cs-phone">Phone (optional)</Label>
          <Input
            id="cs-phone"
            value={draft.phone}
            placeholder="+233 ..."
            onChange={(e) => patch({ phone: e.target.value } as Partial<T>)}
          />
        </div>
      </div>
      {showPassword && (
        <div className="space-y-1.5">
          <Label htmlFor="cs-password">Initial password</Label>
          <Input
            id="cs-password"
            type="password"
            autoComplete="new-password"
            value={draft.password ?? ""}
            onChange={(e) => patch({ password: e.target.value } as Partial<T>)}
          />
          <p className="text-[11px] text-muted-foreground">
            Share this with the staff member. They can change it from their profile after they sign in.
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Role</Label>
        <Select
          value={draft.role}
          onValueChange={(v) => patch({ role: v as Role } as Partial<T>)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manager">Manager (full access)</SelectItem>
            <SelectItem value="staff">Staff (custom permissions)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {draft.role === "staff" && (
        <div className="space-y-2">
          <Label>Permissions</Label>
          <div className="grid grid-cols-1 gap-1.5">
            {ALL_PERMS.map((p) => {
              const checked = draft.permissions.includes(p.key);
              return (
                <label
                  key={p.key}
                  className="flex items-start gap-2 text-sm cursor-pointer rounded-md border p-2 hover:bg-accent"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    onCheckedChange={(c) =>
                      patch({
                        permissions: c
                          ? [...draft.permissions, p.key]
                          : draft.permissions.filter((x) => x !== p.key),
                      } as Partial<T>)
                    }
                  />
                  <span className="flex-1">
                    <span className="font-medium">{p.label}</span>
                    <span className="block text-xs text-muted-foreground">{p.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
