import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  Package,
  XCircle,
  Wallet,
} from "lucide-react";
import { useFleetOrgId } from "@/lib/role";
import {
  useFleetPartsOrders,
  usePayFleetPartsOrder,
  useRejectFleetPartsOrder,
  useMyFleetOrgs,
  type FleetPartsOrder,
  type FleetPartsOrderStatus,
} from "@/lib/fleet-api";
import { formatCurrency } from "@/lib/format";

const STATUS_LABEL: Record<FleetPartsOrderStatus, string> = {
  pending_finance: "Pending finance",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
};

const STATUS_TONE: Record<
  FleetPartsOrderStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending_finance: "secondary",
  approved: "outline",
  paid: "default",
  rejected: "destructive",
};

function StatusIcon({ status }: { status: FleetPartsOrderStatus }) {
  if (status === "paid") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "rejected") return <XCircle className="h-4 w-4" />;
  if (status === "approved") return <Wallet className="h-4 w-4" />;
  return <Clock className="h-4 w-4" />;
}

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function FleetOrdersPage() {
  const orgId = useFleetOrgId();
  const { data: mine } = useMyFleetOrgs();
  const org = mine?.organizations.find((o) => o.id === orgId) ?? null;
  const myRole = org?.myRole;
  const isFinanceLevel = myRole === "admin" || myRole === "finance";

  const { data, isLoading } = useFleetPartsOrders(orgId);
  const pay = usePayFleetPartsOrder(orgId);
  const reject = useRejectFleetPartsOrder(orgId);

  const [rejecting, setRejecting] = useState<FleetPartsOrder | null>(null);
  const [reason, setReason] = useState("");
  const [approving, setApproving] = useState<FleetPartsOrder | null>(null);
  const [approvalNote, setApprovalNote] = useState("");

  const orders = data?.orders ?? [];
  const grouped = useMemo(() => {
    return {
      pending_finance: orders.filter((o) => o.status === "pending_finance"),
      paid: orders.filter((o) => o.status === "paid"),
      rejected: orders.filter((o) => o.status === "rejected"),
      all: orders,
    };
  }, [orders]);

  const onPay = async () => {
    if (!approving) return;
    try {
      const note = approvalNote.trim();
      await pay.mutateAsync({ orderId: approving.id, note: note || undefined });
      toast.success("Order paid.");
      setApproving(null);
      setApprovalNote("");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const onReject = async () => {
    if (!rejecting) return;
    if (!reason.trim()) {
      toast.error("Reason is required.");
      return;
    }
    try {
      await reject.mutateAsync({ orderId: rejecting.id, reason: reason.trim() });
      toast.success("Order rejected.");
      setRejecting(null);
      setReason("");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!orgId) return <div className="p-8 text-sm text-muted-foreground">No org selected.</div>;
  if (isLoading) return <div className="p-8">Loading parts orders...</div>;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <PageHeader
        title="Parts orders"
        description={
          isFinanceLevel
            ? "Approve, pay, or reject parts orders submitted by your team."
            : "Track the status of parts orders you've submitted."
        }
      />

      <Tabs defaultValue="pending_finance">
        <TabsList>
          <TabsTrigger value="pending_finance">
            Pending ({grouped.pending_finance.length})
          </TabsTrigger>
          <TabsTrigger value="paid">Paid ({grouped.paid.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({grouped.rejected.length})</TabsTrigger>
          <TabsTrigger value="all">All ({grouped.all.length})</TabsTrigger>
        </TabsList>

        {(["pending_finance", "paid", "rejected", "all"] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4 space-y-3">
            {grouped[tab].length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  No orders here.
                </CardContent>
              </Card>
            ) : (
              grouped[tab].map((o) => {
                const status = o.status as FleetPartsOrderStatus;
                const itemCount = o.items.reduce((s, i) => s + i.quantity, 0);
                return (
                  <Card key={o.id}>
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge variant={STATUS_TONE[status]} className="gap-1">
                              <StatusIcon status={status} />
                              {STATUS_LABEL[status]}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              #{o.id.slice(0, 8)}
                            </span>
                          </div>
                          <div className="font-medium">
                            {o.requestedByName}{" "}
                            <span className="text-muted-foreground text-sm font-normal">
                              · {o.requestedByPhone}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Submitted {fmt(o.createdAt)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-primary">
                            {formatCurrency(Number(o.totalAmount))}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {itemCount} item{itemCount === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
                        {o.items.map((it) => (
                          <div key={it.partId} className="flex justify-between gap-3">
                            <span className="truncate">
                              {it.name}{" "}
                              <span className="text-muted-foreground">
                                · {it.vendorName} · × {it.quantity}
                              </span>
                            </span>
                            <span className="font-medium tabular-nums">
                              {formatCurrency(it.unitPrice * it.quantity)}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="grid sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="text-muted-foreground">Deliver to</div>
                          <div>{o.shippingAddress}</div>
                          {(o.deliveryCity || o.deliveryRegion) && (
                            <div className="text-muted-foreground">
                              {[o.deliveryCity, o.deliveryRegion].filter(Boolean).join(", ")}
                            </div>
                          )}
                        </div>
                        {o.notes && (
                          <div>
                            <div className="text-muted-foreground">Notes</div>
                            <div>{o.notes}</div>
                          </div>
                        )}
                      </div>

                      {status === "paid" && (
                        <div className="text-xs text-muted-foreground border-t pt-2 space-y-1">
                          <div>Paid by {o.paidByName ?? "—"} on {fmt(o.paidAt)}</div>
                          {o.approvalNote && (
                            <div>
                              <span className="text-muted-foreground">Note: </span>
                              <span className="text-foreground">{o.approvalNote}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {status === "rejected" && (
                        <div className="text-xs text-destructive border-t pt-2">
                          Rejected by {o.rejectedByName ?? "—"} on {fmt(o.rejectedAt)} —{" "}
                          {o.rejectionReason}
                        </div>
                      )}

                      {status === "pending_finance" && isFinanceLevel && (
                        <div className="flex gap-2 pt-1 border-t">
                          <Button
                            size="sm"
                            onClick={() => {
                              setApproving(o);
                              setApprovalNote("");
                            }}
                            disabled={pay.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve & pay
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRejecting(o);
                              setReason("");
                            }}
                          >
                            <XCircle className="h-4 w-4 mr-1.5" /> Reject
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!approving} onOpenChange={(o) => !o && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve & pay parts order</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Note (optional, kept with the order)</Label>
            <Textarea
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              placeholder="Paid against Q3 maintenance budget..."
              rows={3}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproving(null)}>
              Cancel
            </Button>
            <Button onClick={onPay} disabled={pay.isPending}>
              {pay.isPending ? "Paying..." : "Approve & pay"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject parts order</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Reason (visible to requester)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Out of budget for this quarter..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onReject}
              disabled={reject.isPending}
            >
              {reject.isPending ? "Rejecting..." : "Reject order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
