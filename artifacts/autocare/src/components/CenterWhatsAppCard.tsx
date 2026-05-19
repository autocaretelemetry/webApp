import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListServiceCenters,
  useUpdateServiceCenterSettings,
  getListServiceCentersQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";

/**
 * Lets the demo "center" persona toggle WhatsApp notifications for the first
 * service center on file. In a real multi-tenant app the staff member would be
 * scoped to their own center via auth.
 */
export function CenterWhatsAppCard() {
  const queryKey = getListServiceCentersQueryKey();
  const { data: centers } = useListServiceCenters(undefined, {
    query: { queryKey },
  });
  const center = centers?.[0] ?? null;
  const [optedIn, setOptedIn] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (center) setOptedIn(Boolean(center.whatsappOptIn));
  }, [center?.id, center?.whatsappOptIn]);

  const mutation = useUpdateServiceCenterSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey });
        toast.success("WhatsApp settings updated");
      },
      onError: () => toast.error("Could not update WhatsApp settings"),
    },
  });

  if (!center) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          WhatsApp notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Get a WhatsApp ping for every new booking, owner-approved invoice, and
          received payment. Messages go to the phone number on file below.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{center.phone}</span>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label htmlFor="wa-toggle" className="text-sm font-medium">
              Send WhatsApp alerts
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {optedIn
                ? "Activated — you'll receive every relevant update."
                : "Deactivated — alerts won't be sent."}
            </p>
          </div>
          <Switch
            id="wa-toggle"
            checked={optedIn}
            disabled={mutation.isPending}
            onCheckedChange={(checked) => {
              setOptedIn(checked);
              mutation.mutate({
                centerId: center.id,
                data: { whatsappOptIn: checked },
              });
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
