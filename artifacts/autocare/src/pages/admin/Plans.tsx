import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSubscriptionPlans,
  useCreateSubscriptionPlan,
  useUpdateSubscriptionPlan,
  useDeleteSubscriptionPlan,
} from "@workspace/api-client-react";
import { getListSubscriptionPlansQueryKey } from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminEntityActions } from "@/components/admin/AdminEntityActions";
import { formatCurrency } from "@/lib/format";
import { Layers, Plus, Check } from "lucide-react";
import { toast } from "sonner";

type Audience = "all" | "center" | "vendor" | "owner";
type PlanAudience = "center" | "vendor" | "owner";

const AUDIENCE_LABEL: Record<PlanAudience, string> = {
  center: "Service Centers",
  vendor: "Vendors",
  owner: "Vehicle Owners",
};

type EditState = {
  id: string;
  name: string;
  priceMonthly: number;
  features: string;
};

export default function AdminPlans() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Audience>("all");
  const params = {
    includeInactive: true,
    ...(filter !== "all" ? { audience: filter } : {}),
  };
  const { data: plans, isLoading } = useListSubscriptionPlans(params, {
    query: { queryKey: getListSubscriptionPlansQueryKey(params) },
  });

  const create = useCreateSubscriptionPlan();
  const update = useUpdateSubscriptionPlan();
  const remove = useDeleteSubscriptionPlan();

  const [openNew, setOpenNew] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    audience: PlanAudience;
    priceMonthly: string;
    features: string;
  }>({ name: "", audience: "center", priceMonthly: "", features: "" });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListSubscriptionPlansQueryKey() });

  const submitNew = async () => {
    const price = Number(draft.priceMonthly);
    if (!draft.name.trim() || !Number.isFinite(price) || price < 0) {
      toast.error("Name and a valid price are required.");
      return;
    }
    try {
      await create.mutateAsync({
        data: {
          name: draft.name.trim(),
          audience: draft.audience,
          priceMonthly: price,
          features: draft.features
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean),
        },
      });
      await invalidate();
      toast.success("Plan created.");
      setOpenNew(false);
      setDraft({ name: "", audience: "center", priceMonthly: "", features: "" });
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to create plan."));
    }
  };

  const saveEdit = async () => {
    if (!edit) return;
    try {
      await update.mutateAsync({
        planId: edit.id,
        data: {
          name: edit.name,
          priceMonthly: edit.priceMonthly,
          features: edit.features
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean),
        },
      });
      await invalidate();
      toast.success("Plan updated.");
      setEdit(null);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update plan."));
    }
  };

  const toggleActive = async (id: string, next: boolean) => {
    try {
      await update.mutateAsync({ planId: id, data: { active: next } });
      await invalidate();
      toast.success(next ? "Plan reactivated." : "Plan archived.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update plan."));
    }
  };

  const deletePlan = async (id: string, name: string) => {
    try {
      await remove.mutateAsync({ planId: id });
      await invalidate();
      toast.success(`${name} deleted.`);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to delete plan."));
    }
  };

  const busy = create.isPending || update.isPending || remove.isPending;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Subscription Plans"
          description="Pricing tiers offered to service centers, vendors, and vehicle owners."
        />
        <Button onClick={() => setOpenNew(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New plan
        </Button>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Audience)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="center">Centers</TabsTrigger>
          <TabsTrigger value="vendor">Vendors</TabsTrigger>
          <TabsTrigger value="owner">Owners</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {plans?.map((p) => (
          <Card key={p.id} className={p.active ? "" : "opacity-60"}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <Layers className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold truncate">{p.name}</p>
                      {!p.active && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {AUDIENCE_LABEL[p.audience as PlanAudience]}
                    </p>
                    <p className="text-lg font-bold mt-1">
                      {formatCurrency(p.priceMonthly)}
                      <span className="text-xs text-muted-foreground font-normal"> / month</span>
                    </p>
                  </div>
                </div>
                <AdminEntityActions
                  entityLabel="Plan"
                  active={p.active}
                  busy={busy}
                  onToggleActive={(next) => toggleActive(p.id, next)}
                  onDelete={() => deletePlan(p.id, p.name)}
                />
              </div>
              {p.features.length > 0 && (
                <ul className="space-y-1 text-sm pl-1">
                  {p.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setEdit({
                    id: p.id,
                    name: p.name,
                    priceMonthly: p.priceMonthly,
                    features: p.features.join("\n"),
                  })
                }
              >
                Edit
              </Button>
            </CardContent>
          </Card>
        ))}
        {plans && plans.length === 0 && (
          <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed md:col-span-2">
            No plans match this filter.
          </div>
        )}
      </div>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create plan</DialogTitle>
            <DialogDescription>List one feature per line.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Audience</Label>
                <Select
                  value={draft.audience}
                  onValueChange={(v) => setDraft({ ...draft, audience: v as PlanAudience })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="center">Service Centers</SelectItem>
                    <SelectItem value="vendor">Vendors</SelectItem>
                    <SelectItem value="owner">Vehicle Owners</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Price / month</Label>
                <Input
                  type="number"
                  min="0"
                  value={draft.priceMonthly}
                  onChange={(e) => setDraft({ ...draft, priceMonthly: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Features (one per line)</Label>
              <textarea
                rows={4}
                className="w-full rounded-md border bg-background p-2 text-sm"
                value={draft.features}
                onChange={(e) => setDraft({ ...draft, features: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNew(false)}>
              Cancel
            </Button>
            <Button onClick={submitNew} disabled={create.isPending}>
              Create plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit plan</DialogTitle>
            <DialogDescription>Audience can't change after creation.</DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Price / month</Label>
                <Input
                  type="number"
                  min="0"
                  value={edit.priceMonthly}
                  onChange={(e) => setEdit({ ...edit, priceMonthly: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Features (one per line)</Label>
                <textarea
                  rows={4}
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  value={edit.features}
                  onChange={(e) => setEdit({ ...edit, features: e.target.value })}
                />
              </div>
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
