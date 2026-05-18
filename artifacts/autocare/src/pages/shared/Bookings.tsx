import { useState } from "react";
import { useRole } from "@/lib/role";
import { useListBookings, ListBookingsStatus } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { BookingCard } from "@/components/BookingCard";
import { Badge } from "@/components/ui/badge";
import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

const STATUSES: { value: ListBookingsStatus | "all"; label: string }[] = [
  { value: "all", label: "All Bookings" },
  { value: "requested", label: "Requested" },
  { value: "accepted", label: "Accepted" },
  { value: "in_progress", label: "In Progress" },
  { value: "awaiting_approval", label: "Awaiting Approval" },
  { value: "completed", label: "Completed" }
];

export default function Bookings() {
  const { role } = useRole();
  const [status, setStatus] = useState<ListBookingsStatus | "all">("all");

  const { data: bookings, isLoading } = useListBookings({
    role,
    ...(status !== "all" ? { status } : {})
  });

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="Bookings" 
        description="View and manage all service appointments."
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {STATUSES.map(s => (
          <Badge 
            key={s.value} 
            variant={status === s.value ? "default" : "outline"}
            className="cursor-pointer hover:bg-primary/90 hover:text-primary-foreground"
            onClick={() => setStatus(s.value)}
          >
            {s.label}
          </Badge>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : bookings && bookings.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bookings.map(booking => (
            <BookingCard key={booking.id} booking={booking} role={role} />
          ))}
        </div>
      ) : (
        <EmptyState 
          icon={CalendarDays}
          title="No bookings found"
          description="There are no bookings matching the selected status."
        />
      )}
    </div>
  );
}
