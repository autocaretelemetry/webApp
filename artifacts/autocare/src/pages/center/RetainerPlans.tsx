import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListServiceCenters,
  useListRetainerPlans,
  useListRetainers,
  useCreateRetainerPlan,
  useUpdateRetainerPlan,
  useDeleteRetainerPlan,
  type RetainerPlan,
} from "@workspace/api-client-react";
import {
  getListRetainerPlansQueryKey,
  getListRetainersQueryKey,
} from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { formatCurrency, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ShieldCheck, Plus, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

const CADENCES = ["monthly", "quarterly", "annual"] as const;
type Cadence = (typeof CADENCES)[number];

const CADENCE_NOUN: Record<Cadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

const CADENCE_SUFFIX: Record<Cadence, string> = {
  monthly: "/ month",
  quarterly: "/ quarter",
  annual: "/ year",
};

export default function RetainerPlansPage() {
  const { data: centers, isLoading: loadingCenters } = useListServiceCenters();
  const [centerId, setCenterId] = useState<string>("");

  // Pin to the first available center on first load so the page is useful
  // without forcing the operator to interact with the dropdown.
  useEffect(() => {
    if (!centerId && centers && centers.length > 0) setCenterId(centers[0].id);
  }, [centers, centerId]);

  const center = centers?.find((c) => c.id === centerId);

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Retainer Plans"
        description="Define the monthly, quarterly, and annual retainers you offer customers."
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="center" className="text-xs text-muted-foreground">
              Center
            </Label>
            <Select value={centerId} onValueChange={setCenterId}>
              <SelectTrigger id="center" className="w-[220px]">
                <SelectValue placeholder="Select a center" />
              </SelectTrigger>
              <SelectContent>
                {(centers ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {loadingCenters ? (
        <div className="h-40 bg-muted animate-pulse rounded-lg" />
      ) : !center ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pick a service center to manage its retainer plans.
          </CardContent>
        </Card>
      ) : (
        <CenterRetainerView centerId={center.id} centerName={center.name} />
      )}
    </div>
  );
}

function CenterRetainerView({
  centerId,
  centerName,
}: {
  centerId: string;
  centerName: string;
}) {
  const queryClient = useQueryClient();

  const { data: plans, isLoading } = useListRetainerPlans(centerId, {
    query: { queryKey: getListRetainerPlansQueryKey(centerId) },
  });

  const subscribersParams = useMemo(
    () => ({ serviceCenterId: centerId, status: "active" as const }),
    [centerId],
  );
  const { data: subscribers } = useListRetainers(subscribersParams, {
    query: { queryKey: getListRetainersQueryKey(subscribersParams) },
  });

  const [editing, setEditing] = useState<RetainerPlan | "new" | null>(null);
  const [deleting, setDeleting] = useState<RetainerPlan | null>(null);
  const deletePlan = useDeleteRetainerPlan();

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["listRetainerPlans"] });
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deletePlan.mutateAsync({ planId: deleting.id });
      await invalidate();
      toast.success("Plan removed.");
      setDeleting(null);
    } catch (err) {
      toast.error(describeMutationError(err, "Couldn't remove the plan."));
    }
  }

  const takenCadences = new Set((plans ?? []).map((p) => p.cadence));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Plans for {centerName}</h2>
          <Button size="sm" onClick={() => setEditing("new")} disabled={takenCadences.size >= 3}>
            <Plus className="h-4 w-4 mr-1" /> Add plan
          </Button>
        </div>

        {isLoading ? (
          <div className="h-40 bg-muted animate-pulse rounded-lg" />
        ) : (plans ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium">No retainer plans yet</p>
              <p className="text-xs text-muted-foreground">
                Add a monthly, quarterly, or annual plan to start offering retainers.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(plans ?? []).map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                onEdit={() => setEditing(plan)}
                onDelete={() => setDeleting(plan)}
              />
            ))}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Users className="h-4 w-4" /> Active subscribers
          </h2>
          <p className="text-xs text-muted-foreground">
            Customers currently on retainer with this center.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {!subscribers ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : subscribers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active retainers yet.</p>
          ) : (
            subscribers.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-md border p-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{s.ownerName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {s.ownerPhone} · renews {formatDate(s.currentPeriodEnd)}
                  </p>
                </div>
                <Badge variant="secondary" className="capitalize">
                  {s.cadence}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {editing && (
        <PlanFormDialog
          centerId={centerId}
          plan={editing === "new" ? null : editing}
          takenCadences={takenCadences}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete plan?</DialogTitle>
            <DialogDescription>
              This removes the {deleting ? CADENCE_NOUN[deleting.cadence as Cadence].toLowerCase() : ""}{" "}
              plan from your offerings. Existing subscribers keep their snapshotted
              price and cadence, so nothing changes for them — but new owners
              won't see this option until you add it back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Keep plan
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deletePlan.isPending}
            >
              {deletePlan.isPending ? "Deleting…" : "Delete plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanRow({
  plan,
  onEdit,
  onDelete,
}: {
  plan: RetainerPlan;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className={plan.active ? "" : "opacity-60"}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {CADENCE_NOUN[plan.cadence as Cadence] ?? plan.cadence}
            </p>
            <p className="text-2xl font-bold text-primary leading-none mt-1">
              {formatCurrency(plan.price)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {CADENCE_SUFFIX[plan.cadence as Cadence]}
            </p>
          </div>
          {plan.active ? (
            <Badge variant="secondary">Active</Badge>
          ) : (
            <Badge variant="outline">Paused</Badge>
          )}
        </div>
        {plan.perks.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
            {plan.perks.slice(0, 3).map((p, i) => (
              <li key={i} className="line-clamp-1">
                {p}
              </li>
            ))}
            {plan.perks.length > 3 && (
              <li className="list-none text-muted-foreground/70">
                +{plan.perks.length - 3} more
              </li>
            )}
          </ul>
        )}
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="flex-1" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanFormDialog({
  centerId,
  plan,
  takenCadences,
  onClose,
  onSaved,
}: {
  centerId: string;
  plan: RetainerPlan | null;
  takenCadences: Set<string>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = !!plan;
  const availableCadences = CADENCES.filter(
    (c) => !takenCadences.has(c) || plan?.cadence === c,
  );

  const [cadence, setCadence] = useState<Cadence>(
    (plan?.cadence as Cadence) ?? availableCadences[0] ?? "monthly",
  );
  const [price, setPrice] = useState<string>(plan ? String(plan.price) : "");
  const [perksText, setPerksText] = useState<string>(plan?.perks.join("\n") ?? "");
  const [active, setActive] = useState<boolean>(plan?.active ?? true);

  const create = useCreateRetainerPlan();
  const update = useUpdateRetainerPlan();

  async function save() {
    const priceNum = parseFloat(price);
    if (!isFinite(priceNum) || priceNum < 0) {
      toast.error("Enter a valid price.");
      return;
    }
    const perks = perksText
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    try {
      if (isEdit && plan) {
        await update.mutateAsync({
          planId: plan.id,
          data: { price: priceNum, perks, active },
        });
      } else {
        await create.mutateAsync({
          centerId,
          data: { cadence, price: priceNum, perks, active },
        });
      }
      await onSaved();
      toast.success(isEdit ? "Plan updated." : "Plan added.");
      onClose();
    } catch (err) {
      toast.error(describeMutationError(err, "Couldn't save the plan."));
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit retainer plan" : "New retainer plan"}</DialogTitle>
          <DialogDescription>
            Set the billing cadence, price, and what subscribers get.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Cadence</Label>
            <Select
              value={cadence}
              onValueChange={(v) => setCadence(v as Cadence)}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableCadences.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CADENCE_NOUN[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Cadence is locked after creation so existing subscribers keep a stable plan.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="price">Price ({CADENCE_SUFFIX[cadence]})</Label>
            <Input
              id="price"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="perks">Perks (one per line)</Label>
            <Textarea
              id="perks"
              rows={4}
              value={perksText}
              onChange={(e) => setPerksText(e.target.value)}
              placeholder={"Priority booking\n10% off labour\nFree oil change every quarter"}
            />
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Plan is active (visible to owners)
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Add plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
