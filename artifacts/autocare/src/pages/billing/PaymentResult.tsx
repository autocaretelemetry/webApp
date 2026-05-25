import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListSubscriptionsQueryKey,
  getGetInvoiceQueryKey,
  getGetBookingQueryKey,
  getGetOrderQueryKey,
  getListOrdersQueryKey,
  getListRentalBookingsQueryKey,
} from "@/lib/queryKeys";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock } from "lucide-react";

function readQuery(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

interface CopyAndAction {
  successCopy: string;
  failureCopy: string;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string };
}

function decorate(purpose: string | null, params: URLSearchParams): CopyAndAction {
  if (purpose === "service_invoice") {
    const booking = params.get("booking");
    return {
      successCopy: "Invoice paid. The booking is now closed.",
      failureCopy: "Your invoice was NOT charged. You can retry from the invoice page.",
      primary: booking
        ? { href: `/bookings/${booking}`, label: "Back to booking" }
        : { href: "/bookings", label: "Back to bookings" },
      secondary: { href: "/", label: "Go to dashboard" },
    };
  }
  if (purpose === "parts_order") {
    const order = params.get("order");
    return {
      successCopy: "Parts order paid. Stock has been reserved.",
      failureCopy: "Your card was NOT charged. The order is still awaiting payment.",
      primary: order
        ? { href: `/orders/${order}`, label: "Back to order" }
        : { href: "/orders", label: "Back to orders" },
      secondary: { href: "/", label: "Go to dashboard" },
    };
  }
  if (purpose === "rental_booking") {
    return {
      successCopy: "Rental paid. Your booking is confirmed.",
      failureCopy: "Your card was NOT charged. The booking is still awaiting payment.",
      primary: { href: "/my-rentals", label: "Back to my rentals" },
      secondary: { href: "/rentals", label: "Browse rentals" },
    };
  }
  return {
    successCopy: "Your subscription is now active. You can return to your dashboard.",
    failureCopy: "Your card was NOT charged. You can try again — your old plan (if any) was not changed.",
    primary: { href: "/billing/subscribe", label: "Back to plans" },
    secondary: { href: "/", label: "Go to dashboard" },
  };
}

export default function PaymentResult() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const params = readQuery();
  const status = params.get("status") ?? "failed";
  const reason = params.get("reason");
  const purpose = params.get("purpose");
  const success = status === "success";
  const pending = status === "pending";
  const copy = decorate(purpose, params);

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
    const invoice = params.get("invoice");
    const booking = params.get("booking");
    const order = params.get("order");
    const rental = params.get("rental");
    if (invoice) void queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoice) });
    if (booking) void queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(booking) });
    if (order) {
      void queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order) });
      void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
    }
    if (rental) void queryClient.invalidateQueries({ queryKey: getListRentalBookingsQueryKey() });
    void purpose;
  }, [queryClient, params, purpose]);

  return (
    <div className="max-w-xl mx-auto py-12">
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          {success ? (
            <>
              <CheckCircle2 className="size-14 text-emerald-600 mx-auto" />
              <h1 className="text-2xl font-bold">Payment received</h1>
              <p className="text-sm text-muted-foreground">{copy.successCopy}</p>
            </>
          ) : pending ? (
            <>
              <Clock className="size-14 text-amber-600 mx-auto" />
              <h1 className="text-2xl font-bold">Payment is still processing</h1>
              <p className="text-sm text-muted-foreground">
                We couldn't confirm the outcome with PaySwitch just yet. If
                your bank charged you, this page will update automatically
                once the provider reports back. Please refresh in a minute or
                contact support if it stays this way.
              </p>
            </>
          ) : (
            <>
              <XCircle className="size-14 text-red-600 mx-auto" />
              <h1 className="text-2xl font-bold">Payment didn't go through</h1>
              <p className="text-sm text-muted-foreground">
                {reason
                  ? `Reason: ${reason.replace(/_/g, " ")}.`
                  : "PaySwitch reported the transaction was not completed."}
                {" "}
                {copy.failureCopy}
              </p>
            </>
          )}
          <div className="flex justify-center gap-2 pt-2">
            <Button onClick={() => navigate(copy.primary.href)} variant="default">
              {copy.primary.label}
            </Button>
            {copy.secondary ? (
              <Link href={copy.secondary.href}>
                <Button variant="outline">{copy.secondary.label}</Button>
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
