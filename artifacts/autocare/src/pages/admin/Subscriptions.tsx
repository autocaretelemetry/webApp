import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSubscriptions,
  useListSubscriptionPlans,
  useListServiceCenters,
  useListVendors,
  useCreateSubscription,
  useUpdateSubscription,
  useDeleteSubscription,
} from "@workspace/api-client-react";
import {
  getListSubscriptionsQueryKey,
  getListSubscriptionPlansQueryKey,
  getListServiceCentersQueryKey,
  getListVendorsQueryKey,
} from "@/lib/queryKeys";
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
import { formatCurrency, formatDate } from "@/lib/format";
import {
  Building2,
  Store,
  User,
  Plus,
  CalendarDays,
  XCircle,
  Trash2,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

type StatusFilter = "all" | "active" | "past_due" | "cancelled";
type SubscriberKind = "center" | "vendor" | "owner";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  past_due: "bg-amber-100 text-amber-700",
  cancelled: "bg-muted text-muted-foreground",
};

const KIND_ICON: Record<SubscriberKind, typeof Building2> = {
  center: Building2,
  vendor: Store,
  owner: User,
};

export default function AdminSubscriptions() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("all");
  const params = status === "all" ? {} : { status };
  const { data: subs, isLoading } = useListSubscriptions(params, {
    query: { queryKey: getListSubscriptionsQueryKey(params) },
  });
  const { data: plans } = useListSubscriptionPlans(
    { includeInactive: false },
    { query: { queryKey: getListSubscriptionPlansQueryKey({ includeInactive: false }) } },
  );
  const { data: centers } = useListServiceCenters(undefined, {
    query: { queryKey: getListServiceCentersQueryKey() },
  });
  const { data: vendors } = useListVendors(undefined, {
    query: { queryKey: getListVendorsQueryKey() },
  });

  const create = useCreateSubscription();
  const update = useUpdateSubscription();
  const remove = useDeleteSubscription();

  const [openNew, setOpenNew] = useState(false);
  const [planChange, setPlanChange] = useState<
    { id: string; current: string | null; kind: SubscriberKind } | null
  >(null);
  const [newPlanId, setNewPlanId] = useState<string>("");
  const [draft, setDraft] = useState<{
    subscriberKind: SubscriberKind;
    subscriberId: string;
    subscriberName: string;
    planId: string;
  }>({ subscriberKind: "center", subscriberId: "", subscriberName: "", planId: "" });

  const filteredPlans = useMemo(
    () => (plans ?? []).filter((p) => p.audience === draft.subscriberKind),
    [plans, draft.subscriberKind],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });

  const subscriberOptions = useMemo(() => {
    if (draft.subscriberKind === "center") {
      return (centers ?? []).map((c) => ({ id: c.id, name: c.name }));
    }
    if (draft.subscriberKind === "vendor") {
      return (vendors ?? []).map((v) => ({ id: v.id, name: v.name }));
    }
    return [];
  }, [draft.subscriberKind, centers, vendors]);

  const onPickSubscriber = (id: string) => {
    const found = subscriberOptions.find((o) => o.id === id);
    setDraft({ ...draft, subscriberId: id, subscriberName: found?.name ?? "" });
  };

  const submitNew = async () => {
    if (
      !draft.planId ||
      !draft.subscriberId.trim() ||
      !draft.subscriberName.trim()
    ) {
      toast.error("Pick a subscriber and a plan.");
      return;
    }
    try {
      await create.mutateAsync({
        data: {
          subscriberKind: draft.subscriberKind,
          subscriberId: draft.subscriberId.trim(),
          subscriberName: draft.subscriberName.trim(),
          planId: draft.planId,
        },
      });
      await invalidate();
      toast.success("Subscription created.");
      setOpenNew(false);
      setDraft({ subscriberKind: "center", subscriberId: "", subscriberName: "", planId: "" });
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to create subscription."));
    }
  };

  const cancelSub = async (id: string) => {
    try {
      await update.mutateAsync({ subscriptionId: id, data: { status: "cancelled" } });
      await invalidate();
      toast.success("Subscription cancelled.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to cancel."));
    }
  };

  const reactivateSub = async (id: string) => {
    try {
      await update.mutateAsync({ subscriptionId: id, data: { status: "active" } });
      await invalidate();
      toast.success("Subscription reactivated.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to reactivate."));
    }
  };

  const changePlan = async () => {
    if (!planChange || !newPlanId) return;
    try {
      await update.mutateAsync({
        subscriptionId: planChange.id,
        data: { planId: newPlanId },
      });
      await invalidate();
      toast.success("Plan changed.");
      setPlanChange(null);
      setNewPlanId("");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to change plan."));
    }
  };

  const deleteSub = async (id: string) => {
    try {
      await remove.mutateAsync({ subscriptionId: id });
      await invalidate();
      toast.success("Subscription deleted.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to delete."));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <PageHeader
          title="Subscriptions"
          description={`${subs?.length ?? 0} subscriptions across centers, vendors, and owners.`}
        />
        <Button onClick={() => setOpenNew(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New subscription
        </Button>
      </div>

      <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="past_due">Past due</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-3">
        {subs?.map((s) => {
          const Icon = KIND_ICON[s.subscriberKind as SubscriberKind] ?? User;
          return (
            <Card key={s.id}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="h-11 w-11 rounded-md bg-secondary/30 text-secondary-foreground flex items-center justify-center flex-shrink-0">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold truncate">{s.subscriberName}</p>
                    <span
                      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                        STATUS_STYLES[s.status] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {s.status.replace("_", " ")}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {s.subscriberKind}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    <span>{s.planName ?? "(plan deleted)"}</span>
                    {s.priceMonthly != null && (
                      <span className="font-medium text-foreground">
                        {formatCurrency(s.priceMonthly)} / mo
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" /> Renews {formatDate(s.currentPeriodEnd)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPlanChange({
                        id: s.id,
                        current: s.planId ?? null,
                        kind: s.subscriberKind as SubscriberKind,
                      });
                      setNewPlanId(s.planId ?? "");
                    }}
                    className="gap-1.5"
                  >
                    <ArrowRight className="h-3.5 w-3.5" /> Change plan
                  </Button>
                  {s.status === "cancelled" ? (
                    <Button size="sm" variant="outline" onClick={() => reactivateSub(s.id)}>
                      Reactivate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancelSub(s.id)}
                      className="gap-1.5"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Cancel
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteSub(s.id)}
                    className="text-destructive hover:bg-destructive/10"
                    aria-label="Delete subscription"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {subs && subs.length === 0 && (
          <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            No subscriptions match this filter.
          </div>
        )}
      </div>

      <Dialog open={openNew} onOpenChange={setOpenNew}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New subscription</DialogTitle>
            <DialogDescription>
              Place a center, vendor, or vehicle owner on a plan and record the first payment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Subscriber type</Label>
              <Select
                value={draft.subscriberKind}
                onValueChange={(v) =>
                  setDraft({
                    subscriberKind: v as SubscriberKind,
                    subscriberId: "",
                    subscriberName: "",
                    planId: "",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="center">Service Center</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="owner">Vehicle Owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.subscriberKind === "owner" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label>Owner name</Label>
                  <Input
                    placeholder="e.g. Marcus Hale"
                    value={draft.subscriberName}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        subscriberName: e.target.value,
                        subscriberId: draft.subscriberId || `owner-${Date.now()}`,
                      })
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{draft.subscriberKind === "center" ? "Service Center" : "Vendor"}</Label>
                <Select value={draft.subscriberId} onValueChange={onPickSubscriber}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick one" />
                  </SelectTrigger>
                  <SelectContent>
                    {subscriberOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select
                value={draft.planId}
                onValueChange={(v) => setDraft({ ...draft, planId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={filteredPlans.length ? "Pick a plan" : "No plans for this audience"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredPlans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {formatCurrency(p.priceMonthly)}/mo
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenNew(false)}>
              Cancel
            </Button>
            <Button onClick={submitNew} disabled={create.isPending}>
              Subscribe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planChange !== null} onOpenChange={(o) => !o && setPlanChange(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change plan</DialogTitle>
            <DialogDescription>Move this subscriber onto a different plan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Plan</Label>
            <Select value={newPlanId} onValueChange={setNewPlanId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a plan" />
              </SelectTrigger>
              <SelectContent>
                {(plans ?? [])
                  .filter((p) => !planChange || p.audience === planChange.kind)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {formatCurrency(p.priceMonthly)}/mo
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Only plans for {planChange?.kind ?? "this subscriber"} are shown.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPlanChange(null)}>
              Cancel
            </Button>
            <Button onClick={changePlan} disabled={update.isPending || !newPlanId}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
