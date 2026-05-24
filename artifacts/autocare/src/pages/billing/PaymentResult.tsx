import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListSubscriptionsQueryKey } from "@/lib/queryKeys";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle } from "lucide-react";

function readQuery(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export default function PaymentResult() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const params = readQuery();
  const status = params.get("status") ?? "failed";
  const reason = params.get("reason");
  const success = status === "success";

  useEffect(() => {
    // Refresh the subscription cache so any open billing page reflects the
    // new state when the user navigates back.
    void queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
  }, [queryClient]);

  return (
    <div className="max-w-xl mx-auto py-12">
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          {success ? (
            <>
              <CheckCircle2 className="size-14 text-emerald-600 mx-auto" />
              <h1 className="text-2xl font-bold">Payment received</h1>
              <p className="text-sm text-muted-foreground">
                Your subscription is now active. You can return to your dashboard.
              </p>
            </>
          ) : (
            <>
              <XCircle className="size-14 text-red-600 mx-auto" />
              <h1 className="text-2xl font-bold">Payment didn't go through</h1>
              <p className="text-sm text-muted-foreground">
                {reason
                  ? `Reason: ${reason.replace(/_/g, " ")}.`
                  : "PaySwitch reported the transaction was not completed."}{" "}
                You can try again — your old plan (if any) was not changed.
              </p>
            </>
          )}
          <div className="flex justify-center gap-2 pt-2">
            <Button onClick={() => navigate("/billing/subscribe")} variant={success ? "outline" : "default"}>
              {success ? "Back to plans" : "Try again"}
            </Button>
            <Link href="/">
              <Button variant={success ? "default" : "outline"}>Go to dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
