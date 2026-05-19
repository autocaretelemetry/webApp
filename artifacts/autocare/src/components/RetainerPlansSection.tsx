import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRetainerPlans,
  useListRetainers,
  useCreateRetainer,
  useUpdateRetainer,
  type RetainerPlan,
  type Retainer,
} from "@workspace/api-client-react";
import {
  getListRetainerPlansQueryKey,
  getListRetainersQueryKey,
} from "@/lib/queryKeys";
import { useCurrentVehicleOwner } from "@/lib/currentOwner";
import { describeMutationError } from "@/lib/adminErrors";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ShieldCheck, Check, Sparkles, Calendar, XCircle } from "lucide-react";
import { toast } from "sonner";

const CADENCE_LABEL: Record<string, string> = {
  monthly: "/ month",
  quarterly: "/ quarter",
  annual: "/ year",
};

const CADENCE_NOUN: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

export function RetainerPlansSection({
  serviceCenterId,
  serviceCenterName,
}: {
  serviceCenterId: string;
  serviceCenterName: string;
}) {
  const queryClient = useQueryClient();
  const owner = useCurrentVehicleOwner();

  const { data: plans, isLoading } = useListRetainerPlans(serviceCenterId, {
    query: { queryKey: getListRetainerPlansQueryKey(serviceCenterId) },
  });

  const retainerParams = useMemo(
    () => ({
      ownerPhone: owner?.phone,
      serviceCenterId,
      status: "active" as const,
    }),
    [owner?.phone, serviceCenterId],
  );
  const { data: myRetainers } = useListRetainers(retainerParams, {
    query: {
      enabled: !!owner?.phone,
      queryKey: getListRetainersQueryKey(retainerParams),
    },
  });
  const myRetainer = myRetainers?.[0];

  const create = useCreateRetainer();
  const update = useUpdateRetainer();
  const [picked, setPicked] = useState<RetainerPlan | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const activePlans = (plans ?? []).filter((p) => p.active);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading retainer plans…</p>;
  }

  if (activePlans.length === 0 && !myRetainer) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          This center doesn't offer retainer plans yet. You can still book
          pay-as-you-go services any time.
        </CardContent>
      </Card>
    );
  }

  async function subscribe(plan: RetainerPlan) {
    if (!owner) {
      toast.error("Add a vehicle first so we know who to put on retainer.");
      return;
    }
    try {
      await create.mutateAsync({
        data: {
          serviceCenterId,
          planId: plan.id,
          ownerName: owner.name,
          ownerPhone: owner.phone,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["listRetainers"] });
      toast.success(`You're on the ${CADENCE_NOUN[plan.cadence]} retainer with ${serviceCenterName}.`);
      setPicked(null);
    } catch (err) {
      toast.error(describeMutationError(err, "Couldn't start the retainer."));
    }
  }

  async function cancel(retainer: Retainer) {
    try {
      await update.mutateAsync({
        retainerId: retainer.id,
        data: { status: "cancelled" },
      });
      await queryClient.invalidateQueries({ queryKey: ["listRetainers"] });
      toast.success("Retainer cancelled. You can still book pay-as-you-go anytime.");
      setCancelOpen(false);
    } catch (err) {
      toast.error(describeMutationError(err, "Couldn't cancel the retainer."));
    }
  }

  if (myRetainer) {
    return (
      <Card className="border-emerald-500/40 bg-emerald-500/5">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">
                  You're on the {CADENCE_NOUN[myRetainer.cadence]} retainer
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(myRetainer.price)} {CADENCE_LABEL[myRetainer.cadence]} ·
                  renews {formatDate(myRetainer.currentPeriodEnd)}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              <XCircle className="h-4 w-4 mr-1" /> Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Retainer customers get priority handling at this center. You can still
            book one-off services at any other service center — your retainer
            doesn't lock you in.
          </p>
        </CardContent>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel retainer?</DialogTitle>
              <DialogDescription>
                Your retainer with {serviceCenterName} will end immediately. You
                can resubscribe later, and you can keep booking pay-as-you-go
                services in the meantime.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>
                Keep retainer
              </Button>
              <Button
                variant="destructive"
                onClick={() => cancel(myRetainer)}
                disabled={update.isPending}
              >
                {update.isPending ? "Cancelling…" : "Cancel retainer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {activePlans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} onPick={() => setPicked(plan)} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Prefer to try them first? Skip the retainer and book pay-as-you-go —
        you can subscribe after your first service.
      </p>

      <Dialog open={!!picked} onOpenChange={(o) => !o && setPicked(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Start {picked ? CADENCE_NOUN[picked.cadence].toLowerCase() : ""} retainer
            </DialogTitle>
            <DialogDescription>
              {picked && (
                <>
                  You'll be on retainer with <strong>{serviceCenterName}</strong> for{" "}
                  {formatCurrency(picked.price)} {CADENCE_LABEL[picked.cadence]}.
                  {owner ? (
                    <>
                      {" "}
                      Billed under <strong>{owner.name}</strong> · {owner.phone}.
                    </>
                  ) : (
                    <>
                      {" "}
                      Add a vehicle first — we use that name and phone for the
                      retainer record.
                    </>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {picked && picked.perks.length > 0 && (
            <ul className="space-y-1.5 text-sm">
              {picked.perks.map((perk, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-emerald-600" />
                  <span>{perk}</span>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPicked(null)}>
              Not now
            </Button>
            <Button
              onClick={() => picked && subscribe(picked)}
              disabled={!owner || create.isPending}
            >
              {create.isPending ? "Starting…" : "Confirm retainer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanCard({ plan, onPick }: { plan: RetainerPlan; onPick: () => void }) {
  return (
    <Card className="hover-elevate flex flex-col">
      <CardContent className="p-4 space-y-3 flex-1 flex flex-col">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" /> {CADENCE_NOUN[plan.cadence]}
          </p>
          {plan.cadence === "annual" && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3 w-3" /> Best value
            </span>
          )}
        </div>
        <div>
          <p className="text-2xl font-bold text-primary leading-none">
            {formatCurrency(plan.price)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{CADENCE_LABEL[plan.cadence]}</p>
        </div>
        {plan.perks.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground flex-1">
            {plan.perks.slice(0, 4).map((perk, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Check className="h-3 w-3 mt-0.5 text-emerald-600 flex-shrink-0" />
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex-1" />
        )}
        <Button size="sm" className="w-full mt-1" onClick={onPick}>
          Subscribe
        </Button>
      </CardContent>
    </Card>
  );
}
