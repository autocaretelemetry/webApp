import { useState } from "react";
import { Bell, BellOff, BellRing, Check, CheckCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import {
  pushPermission,
  pushSupported,
  subscribeOwnerToPush,
  unsubscribeFromPush,
} from "@/lib/push";
import { toast } from "sonner";

function vehicleUrl(vehicleId: string | null | undefined) {
  return vehicleId ? `/garage/${vehicleId}` : null;
}
function bookingUrl(bookingId: string | null | undefined) {
  return bookingId ? `/bookings/${bookingId}` : null;
}

export function NotificationBell() {
  const { user } = useAuth();
  const ownerPhone = user?.phone ?? "";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [permState, setPermState] = useState(pushPermission());

  const queryKey = getListNotificationsQueryKey({ ownerPhone, limit: 30 });
  const { data: items } = useListNotifications(
    { ownerPhone, limit: 30 },
    { query: { enabled: !!ownerPhone, refetchInterval: 60_000, queryKey } },
  );

  const markRead = useMarkNotificationRead({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    },
  });
  const markAll = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    },
  });

  const list = items ?? [];
  const unread = list.filter((n) => !n.readAt).length;

  async function enablePush() {
    const res = await subscribeOwnerToPush(ownerPhone);
    setPermState(pushPermission());
    if (res.ok) {
      toast.success("Browser notifications enabled");
    } else if (res.reason === "permission_denied") {
      toast.error("Notifications blocked. Enable them in your browser settings.");
    } else if (res.reason === "vapid_unavailable") {
      toast.error("Push not configured on the server yet.");
    } else if (res.reason === "unsupported") {
      toast.error("Your browser does not support push notifications.");
    } else {
      toast.error("Could not enable notifications.");
    }
  }

  async function disablePush() {
    await unsubscribeFromPush();
    setPermState(pushPermission());
    toast.success("Browser notifications turned off");
  }

  const supported = pushSupported();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative inline-flex items-center justify-center rounded-md h-9 w-9 hover:bg-sidebar-accent transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold h-4 min-w-4 px-1">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Notifications</span>
            {unread > 0 && <Badge variant="secondary">{unread} new</Badge>}
          </div>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => markAll.mutate({ data: { ownerPhone } })}
            >
              <CheckCheck className="h-3 w-3 mr-1" /> Mark all read
            </Button>
          )}
        </div>

        {supported && (
          <div className="px-4 py-2 border-b bg-muted/40 flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {permState === "granted"
                ? "Browser notifications are on."
                : permState === "denied"
                  ? "Browser notifications blocked in settings."
                  : "Get reminders even when this tab is closed."}
            </div>
            {permState === "granted" ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={disablePush}
              >
                <BellOff className="h-3 w-3 mr-1" /> Turn off
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={enablePush}
                disabled={permState === "denied"}
              >
                <BellRing className="h-3 w-3 mr-1" /> Enable
              </Button>
            )}
          </div>
        )}

        <div className="max-h-[420px] overflow-y-auto divide-y">
          {list.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications yet. Reminders will appear here when service is
              due.
            </div>
          ) : (
            list.map((n) => {
              const href = vehicleUrl(n.vehicleId) ?? bookingUrl(n.bookingId);
              const Inner = (
                <div
                  className={cn(
                    "px-4 py-3 hover:bg-muted/60 cursor-pointer",
                    !n.readAt && "bg-primary/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium leading-tight">
                      {n.title}
                    </div>
                    {!n.readAt && (
                      <span className="mt-1 h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 leading-snug">
                    {n.body}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {formatRelative(new Date(n.createdAt))}
                    </div>
                    {!n.readAt && (
                      <button
                        className="text-[10px] text-primary hover:underline inline-flex items-center gap-1"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          markRead.mutate({ notificationId: n.id });
                        }}
                      >
                        <Check className="h-3 w-3" /> Mark read
                      </button>
                    )}
                  </div>
                </div>
              );
              return href ? (
                <Link
                  key={n.id}
                  href={href}
                  onClick={() => {
                    if (!n.readAt) markRead.mutate({ notificationId: n.id });
                    setOpen(false);
                  }}
                >
                  {Inner}
                </Link>
              ) : (
                <div key={n.id}>{Inner}</div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
