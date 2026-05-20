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
import { UserPlus, Trash2, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useFleetOrgId } from "@/lib/role";
import {
  useFleetMembers,
  useUpsertFleetMember,
  useRemoveFleetMember,
} from "@/lib/fleet-api";

export default function FleetDriversPage() {
  const orgId = useFleetOrgId();
  const { data, isLoading } = useFleetMembers(orgId);
  const upsert = useUpsertFleetMember(orgId);
  const remove = useRemoveFleetMember(orgId);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", role: "driver" as "admin" | "driver" });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await upsert.mutateAsync({
        name: form.name,
        phone: form.phone,
        role: form.role,
      });
      toast.success(`${form.role === "admin" ? "Admin" : "Driver"} added.`);
      setForm({ name: "", phone: "", role: "driver" });
      setOpen(false);
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

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <PageHeader
        title="Team & drivers"
        description="Invite drivers by phone number. Admins can manage the whole fleet."
        actions={
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
                    onValueChange={(v) => setForm({ ...form, role: v as "admin" | "driver" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="driver">Driver</SelectItem>
                      <SelectItem value="admin">Fleet admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={upsert.isPending}>
                    {upsert.isPending ? "Saving..." : "Invite"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {members.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No team members yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {members.map((m) => (
            <Card key={m.phone}>
              <CardContent className="py-4 flex items-center gap-3">
                <div className="rounded-full bg-muted h-10 w-10 flex items-center justify-center">
                  <UserCircle2 className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.phone}</div>
                </div>
                <Badge variant={m.role === "admin" ? "default" : "secondary"}>
                  {m.role === "admin" ? "Admin" : "Driver"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemove(m.phone, m.name)}
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
