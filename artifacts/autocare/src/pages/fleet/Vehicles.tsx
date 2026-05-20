import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { Car, Plus, User } from "lucide-react";
import { toast } from "sonner";
import { useFleetOrgId } from "@/lib/role";
import {
  useFleetVehicles,
  useFleetMembers,
  useCreateFleetVehicle,
  useUpdateFleetVehicle,
} from "@/lib/fleet-api";

const EMPTY_FORM = {
  brand: "",
  model: "",
  year: new Date().getFullYear(),
  plateNumber: "",
  color: "",
  mileage: 0,
  assignedDriverPhone: "",
};

export default function FleetVehiclesPage() {
  const orgId = useFleetOrgId();
  const { data, isLoading } = useFleetVehicles(orgId);
  const { data: members } = useFleetMembers(orgId);
  const create = useCreateFleetVehicle(orgId);
  const update = useUpdateFleetVehicle(orgId);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const drivers = (members?.members ?? []).filter((m) => m.role === "driver");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({
        brand: form.brand,
        model: form.model,
        year: Number(form.year),
        plateNumber: form.plateNumber,
        color: form.color,
        mileage: Number(form.mileage) || 0,
        assignedDriverPhone: form.assignedDriverPhone || undefined,
      });
      toast.success("Vehicle added to fleet.");
      setForm(EMPTY_FORM);
      setOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const reassign = async (vehicleId: string, phone: string) => {
    try {
      await update.mutateAsync({
        vehicleId,
        body: { assignedDriverPhone: phone === "__unassigned" ? null : phone },
      });
      toast.success("Driver updated.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!orgId) return <div className="p-8 text-sm text-muted-foreground">No org selected.</div>;
  if (isLoading) return <div className="p-8">Loading vehicles...</div>;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <PageHeader
        title="Fleet vehicles"
        description="Every vehicle attached to your organisation, and who's driving it."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Add vehicle
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add fleet vehicle</DialogTitle>
              </DialogHeader>
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Brand">
                    <Input
                      value={form.brand}
                      onChange={(e) => setForm({ ...form, brand: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Model">
                    <Input
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Year">
                    <Input
                      type="number"
                      value={form.year}
                      onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
                      required
                    />
                  </Field>
                  <Field label="Plate number">
                    <Input
                      value={form.plateNumber}
                      onChange={(e) => setForm({ ...form, plateNumber: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Colour">
                    <Input
                      value={form.color}
                      onChange={(e) => setForm({ ...form, color: e.target.value })}
                      required
                    />
                  </Field>
                  <Field label="Mileage (km)">
                    <Input
                      type="number"
                      value={form.mileage}
                      onChange={(e) => setForm({ ...form, mileage: Number(e.target.value) })}
                    />
                  </Field>
                </div>
                <Field label="Assign driver (optional)">
                  <Select
                    value={form.assignedDriverPhone || "__none"}
                    onValueChange={(v) =>
                      setForm({ ...form, assignedDriverPhone: v === "__none" ? "" : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— None —</SelectItem>
                      {drivers.map((d) => (
                        <SelectItem key={d.phone} value={d.phone}>
                          {d.name} ({d.phone})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <DialogFooter>
                  <Button type="submit" disabled={create.isPending}>
                    {create.isPending ? "Adding..." : "Add vehicle"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {(data?.vehicles ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No vehicles in the fleet yet. Use the button above to add one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(data?.vehicles ?? []).map((v) => {
            const assigned = drivers.find((d) => d.phone === v.assignedDriverPhone);
            return (
              <Card key={v.id}>
                <CardContent className="py-4 flex items-center gap-4">
                  <div className="rounded-md bg-muted h-12 w-12 flex items-center justify-center">
                    <Car className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {v.year} {v.brand} {v.model}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {v.plateNumber} · {v.color} · {v.mileage.toLocaleString()} km
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={assigned ? "secondary" : "outline"} className="gap-1">
                        <User className="h-3 w-3" />
                        {assigned ? assigned.name : "Unassigned"}
                      </Badge>
                    </div>
                  </div>
                  <Select
                    value={v.assignedDriverPhone ?? "__unassigned"}
                    onValueChange={(val) => reassign(v.id, val)}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="Assign" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned">— Unassign —</SelectItem>
                      {drivers.map((d) => (
                        <SelectItem key={d.phone} value={d.phone}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
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
