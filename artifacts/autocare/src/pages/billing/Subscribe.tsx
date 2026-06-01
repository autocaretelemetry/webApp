import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListSubscriptionPlans,
  useListSubscriptions,
  type Subscription,
  type SubscriptionPlan,
} from "@workspace/api-client-react";
import {
  getListSubscriptionPlansQueryKey,
  getListSubscriptionsQueryKey,
} from "@/lib/queryKeys";
import { API_ROOT } from "../../lib/api-base";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { toast } from "sonner";
import { Check, CreditCard, Loader2, ShieldCheck } from "lucide-react";

type Audience = "owner" | "center" | "vendor" | "organization";

type SubscriberOption = {
  kind: Audience;
  subscriberId: string;
  name: string;
};

const AUDIENCE_LABEL: Record<Audience, string> = {
  owner: "Vehicle owner",
  center: "Service center",
  vendor: "Parts vendor",
  organization: "Fleet organization",
};

export default function Subscribe() {
  const queryClient = useQueryClient();

  const { data: optionsResp, isLoading: optsLoading } = useQuery<{ options: SubscriberOption[] }>({
    queryKey: ["me/subscriber-options"],
    queryFn: async () => {
      const r = await fetch(`${API_ROOT}/me/subscriber-options`, { credentials: "include" });
      if (!r.ok) throw new Error("Could not load subscriber options");
      return r.json();
    },
  });
  const options = optionsResp?.options ?? [];

  // Pre-select the first available option (most users only have one).
  const [selectedKey, setSelectedKey] = useState<string>("");
  const selected = useMemo<SubscriberOption | undefined>(() => {
    if (!options.length) return undefined;
    const found = options.find((o) => `${o.kind}:${o.subscriberId}` === selectedKey);
    return found ?? options[0];
  }, [options, selectedKey]);

  const { data: plans, isLoading: plansLoading } = useListSubscriptionPlans(
    selected ? { audience: selected.kind } : undefined,
    {
      query: {
        enabled: !!selected,
        queryKey: getListSubscriptionPlansQueryKey(
          selected ? { audience: selected.kind } : undefined,
        ),
      },
    },
  );

  const subsQuery = useListSubscriptions(
    selected ? { subscriberKind: selected.kind } : undefined,
    {
      query: {
        enabled: !!selected,
        queryKey: getListSubscriptionsQueryKey(
          selected ? { subscriberKind: selected.kind } : undefined,
        ),
      },
    },
  );
  const mySubs = useMemo(() => {
    if (!selected || !subsQuery.data) return [] as Subscription[];
    return (subsQuery.data as Subscription[]).filter(
      (s) => s.subscriberId === selected.subscriberId,
    );
  }, [selected, subsQuery.data]);
  const activeSub = mySubs.find((s) => s.status === "active");
  const pendingSub = mySubs.find((s) => (s.status as string) === "pending_payment");

  const initiate = useMutation({
    mutationFn: async (planId: string) => {
      if (!selected) throw new Error("Pick an account first");
      const r = await fetch(`${API_ROOT}/payments/payswitch/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          planId,
          subscriberKind: selected.kind,
          subscriberId: selected.subscriberId,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(body?.error ?? "Could not start payment");
      }
      return body as { checkoutUrl: string; transactionId: string; subscriptionId: string };
    },
    onSuccess: (result) => {
      // Bounce the customer to PaySwitch. They land back on /billing/result
      // after they finish (success or failure) and we refresh from there.
      window.location.href = result.checkoutUrl;
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  if (optsLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading your accounts…
      </div>
    );
  }

  if (!options.length) {
    return (
      <div className="space-y-4 p-2">
        <PageHeader title="Subscription" description="Manage your AutoCare plan" />
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            We couldn't find any account on you that can subscribe yet. Finish onboarding (or
            ask your platform admin to provision your service center / vendor / fleet
            organization), then come back here.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-2">
      <PageHeader
        title="Subscription"
        description="Pick a plan and pay through PaySwitch. Your subscription activates the moment payment clears."
      />

      {options.length > 1 ? (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Subscribing for</span>
            <Select
              value={selected ? `${selected.kind}:${selected.subscriberId}` : ""}
              onValueChange={setSelectedKey}
            >
              <SelectTrigger className="w-[320px]">
                <SelectValue placeholder="Choose an account" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={`${o.kind}:${o.subscriberId}`} value={`${o.kind}:${o.subscriberId}`}>
                    <span className="font-medium">{o.name}</span>{" "}
                    <span className="text-muted-foreground text-xs">
                      · {AUDIENCE_LABEL[o.kind]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      ) : null}

      {selected ? (
        <Card>
          <CardContent className="p-5 space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Current plan · {selected.name}
            </div>
            {activeSub ? (
              <div className="flex items-center gap-2 text-base font-semibold">
                <ShieldCheck className="size-4 text-emerald-600" />
                {(activeSub as Subscription & { planName?: string | null }).planName ?? "Active plan"}
                <Badge variant="secondary">Active</Badge>
                <span className="text-sm text-muted-foreground font-normal">
                  Renews {new Date(activeSub.currentPeriodEnd).toLocaleDateString()}
                </span>
              </div>
            ) : pendingSub ? (
              <div className="flex items-center gap-2 text-base font-semibold">
                <Loader2 className="size-4 animate-spin" /> Awaiting payment
                <Badge variant="outline">Pending</Badge>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                You're on the free tier. Upgrade below to unlock more.
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {plansLoading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading plans…
        </div>
      ) : !plans || plans.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No paid plans are published for {AUDIENCE_LABEL[selected!.kind].toLowerCase()} accounts
            yet. Check back soon.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(plans as SubscriptionPlan[]).map((plan) => {
            const isCurrent =
              activeSub &&
              (activeSub as Subscription & { planId?: string | null }).planId === plan.id;
            return (
              <Card key={plan.id} className="flex flex-col">
                <CardContent className="p-5 space-y-3 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-lg font-semibold">{plan.name}</div>
                      <div className="text-2xl font-bold mt-1">
                        {formatCurrency(plan.priceMonthly)}
                        <span className="text-sm font-normal text-muted-foreground"> / month</span>
                      </div>
                    </div>
                    {isCurrent ? <Badge variant="default">Current</Badge> : null}
                  </div>
                  {plan.features && plan.features.length ? (
                    <ul className="space-y-1.5">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <Check className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
                <div className="p-5 pt-0">
                  <Button
                    className="w-full"
                    disabled={
                      isCurrent ||
                      initiate.isPending ||
                      (initiate.variables ?? "") !== "" && initiate.isPending
                    }
                    onClick={() => {
                      if (isCurrent) return;
                      void queryClient.invalidateQueries({
                        queryKey: getListSubscriptionsQueryKey({
                          subscriberKind: selected!.kind,
                        }),
                      });
                      initiate.mutate(plan.id);
                    }}
                  >
                    {isCurrent ? (
                      "Current plan"
                    ) : initiate.isPending && initiate.variables === plan.id ? (
                      <>
                        <Loader2 className="size-4 animate-spin mr-2" /> Redirecting…
                      </>
                    ) : (
                      <>
                        <CreditCard className="size-4 mr-2" />
                        {activeSub ? "Switch to this plan" : "Subscribe"}
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Payments are processed by PaySwitch (TheTeller). You will be redirected to their secure
        checkout to complete the transaction.
      </p>
    </div>
  );
}
