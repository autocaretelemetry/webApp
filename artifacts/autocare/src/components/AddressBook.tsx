import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
} from "@/components/ui/alert-dialog";
import {
  useMyAddresses,
  useCreateAddress,
  useUpdateAddress,
  useDeleteAddress,
  type SavedAddress,
  type SavedAddressInput,
} from "@/lib/addresses-api";
import { Loader2, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

type FormState = SavedAddressInput;

const EMPTY: FormState = {
  label: "",
  recipientName: "",
  recipientPhone: "",
  addressLine: "",
  city: "",
  region: "",
  isDefault: false,
};

export function AddressBook() {
  const { data: addresses, isLoading } = useMyAddresses();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const del = useDeleteAddress();

  const [editing, setEditing] = useState<SavedAddress | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState<SavedAddress | null>(null);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  };

  const openEdit = (a: SavedAddress) => {
    setEditing(a);
    setForm({
      label: a.label,
      recipientName: a.recipientName,
      recipientPhone: a.recipientPhone,
      addressLine: a.addressLine,
      city: a.city,
      region: a.region,
      isDefault: a.isDefault,
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    if (
      !form.label.trim() ||
      !form.recipientName.trim() ||
      !form.recipientPhone.trim() ||
      !form.addressLine.trim()
    ) {
      toast.error("Label, name, phone, and address are required.");
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: form });
        toast.success("Address updated.");
      } else {
        await create.mutateAsync(form);
        toast.success("Address saved.");
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save address.");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await del.mutateAsync(confirmDelete.id);
      toast.success("Address removed.");
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove address.");
    }
  };

  const setDefault = async (a: SavedAddress) => {
    try {
      await update.mutateAsync({ id: a.id, data: { isDefault: true } });
      toast.success(`${a.label} is now your default.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set default.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" /> Shipping addresses
        </CardTitle>
        <Button size="sm" variant="outline" onClick={openAdd} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add address
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Save the places you ship to (home, garage, workshop) so checkout is a
          one-click pick. The default address is preselected automatically.
        </p>
        {isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !addresses || addresses.length === 0 ? (
          <div className="border border-dashed rounded-md p-4 text-sm text-muted-foreground text-center">
            No saved addresses yet.
          </div>
        ) : (
          <div className="space-y-2">
            {addresses.map((a) => (
              <div
                key={a.id}
                className="border rounded-md p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{a.label}</span>
                    {a.isDefault && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        <Star className="h-3 w-3" /> Default
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    {a.recipientName} · {a.recipientPhone}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {a.addressLine}
                    {a.city ? `, ${a.city}` : ""}
                    {a.region ? `, ${a.region}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!a.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDefault(a)}
                      title="Set as default"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(a)}
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(a)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit address" : "Add address"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="addr-label">Label</Label>
              <Input
                id="addr-label"
                placeholder="Home, Garage, Workshop…"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="addr-name">Recipient name</Label>
                <Input
                  id="addr-name"
                  value={form.recipientName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recipientName: e.target.value }))
                  }
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="addr-phone">Phone</Label>
                <Input
                  id="addr-phone"
                  value={form.recipientPhone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, recipientPhone: e.target.value }))
                  }
                  className="mt-1.5"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="addr-line">Street address</Label>
              <Textarea
                id="addr-line"
                rows={2}
                value={form.addressLine}
                onChange={(e) =>
                  setForm((f) => ({ ...f, addressLine: e.target.value }))
                }
                className="mt-1.5"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="addr-city">City</Label>
                <Input
                  id="addr-city"
                  value={form.city ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, city: e.target.value }))
                  }
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="addr-region">Region / State</Label>
                <Input
                  id="addr-region"
                  value={form.region ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, region: e.target.value }))
                  }
                  className="mt-1.5"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={form.isDefault === true}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, isDefault: v === true }))
                }
              />
              Use as my default shipping address
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={create.isPending || update.isPending}
              className="gap-2"
            >
              {(create.isPending || update.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {editing ? "Save changes" : "Save address"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this address?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.label} will no longer appear at checkout.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
