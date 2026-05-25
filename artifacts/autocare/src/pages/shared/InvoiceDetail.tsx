import { useParams, Link, useLocation } from "wouter";
import { useGetInvoice, useApproveInvoice, usePayInvoice, useMarkInvoiceCashPaid, getGetInvoiceQueryKey, getGetBookingQueryKey } from "@workspace/api-client-react";
import { useState as useReactState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useRole } from "@/lib/role";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { InvoiceSummary } from "@/components/InvoiceSummary";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

export default function InvoiceDetail() {
  const params = useParams();
  const invoiceId = params.id as string;
  const { role } = useRole();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: invoice, isLoading } = useGetInvoice(invoiceId, { query: { enabled: !!invoiceId, queryKey: getGetInvoiceQueryKey(invoiceId) as QueryKey } });
  
  const approveInvoice = useApproveInvoice();
  const payInvoice = usePayInvoice();
  const markCashPaid = useMarkInvoiceCashPaid();

  const handleMarkCashPaid = () => {
    if (!window.confirm("Confirm you've received the cash payment from the owner. This will close the invoice and mark the booking complete.")) {
      return;
    }
    markCashPaid.mutate(
      { invoiceId },
      {
        onSuccess: () => {
          toast.success("Cash payment recorded");
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoiceId) });
          if (invoice) {
            queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(invoice.bookingId) });
          }
        },
        onError: () => toast.error("Failed to record cash payment"),
      },
    );
  };

  const handleApprove = () => {
    approveInvoice.mutate(
      { invoiceId },
      {
        onSuccess: () => {
          toast.success("Invoice approved");
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoiceId) });
          if (invoice) {
             queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(invoice.bookingId) });
          }
        },
        onError: () => toast.error("Failed to approve invoice")
      }
    );
  };

  const [payingOnline, setPayingOnline] = useReactState(false);
  const handlePay = async () => {
    setPayingOnline(true);
    try {
      const res = await fetch(`/api/payments/payswitch/service-invoices/${invoiceId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await res.json().catch(() => ({}))) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !body.checkoutUrl) {
        toast.error(body.error ?? "Failed to start payment");
        setPayingOnline(false);
        return;
      }
      window.location.href = body.checkoutUrl;
    } catch {
      toast.error("Failed to start payment");
      setPayingOnline(false);
    }
  };
  void payInvoice; void queryClient;

  if (isLoading) return <div className="p-8">Loading invoice...</div>;
  if (!invoice) return <div className="p-8">Invoice not found</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in-50 duration-500 pb-12">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => setLocation(`/bookings/${invoice.bookingId}`)} className="text-muted-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Booking
        </Button>
      </div>

      <PageHeader 
        title={`Invoice #${invoice.id.split("-")[0].toUpperCase()}`}
        description="Detailed breakdown of parts and labor."
      />

      <InvoiceSummary invoice={invoice} className="shadow-lg border-2" />

      {role === "owner" && invoice.status === "pending_approval" && (
        <Card className="border-primary bg-primary/5">
          <CardContent className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg">Approval Required</h3>
              <p className="text-sm text-muted-foreground">Review the invoice and approve to authorize work completion.</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button onClick={handleApprove} disabled={approveInvoice.isPending} className="w-full sm:w-auto">
                {approveInvoice.isPending ? "Approving..." : "Approve Invoice"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {role === "owner" && invoice.status === "approved" && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardContent className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg">Payment Required</h3>
              <p className="text-sm text-muted-foreground">The work is complete. Please pay the invoice.</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button onClick={handlePay} disabled={payingOnline} className="w-full sm:w-auto bg-green-600 hover:bg-green-700">
                {payingOnline ? "Redirecting..." : "Pay Now"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {role === "center" && (invoice.status === "pending_approval" || invoice.status === "approved") && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-lg">Cash payment</h3>
              <p className="text-sm text-muted-foreground">
                If the owner is paying in person, record the cash here. The invoice closes
                immediately and the booking is marked complete — same as an online payment.
              </p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button
                onClick={handleMarkCashPaid}
                disabled={markCashPaid.isPending}
                variant="outline"
                className="w-full sm:w-auto border-amber-600 text-amber-700 hover:bg-amber-100"
              >
                {markCashPaid.isPending ? "Recording..." : "Mark cash received"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
