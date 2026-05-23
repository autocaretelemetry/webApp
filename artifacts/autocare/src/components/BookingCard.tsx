import { Booking } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime, formatDate } from "@/lib/format";
import { Calendar, Car, Store, Wrench, User, Zap } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface BookingCardProps {
  booking: Booking;
  role: "owner" | "center";
}

export function BookingCard({ booking, role }: BookingCardProps) {
  return (
    <Card className="flex flex-col h-full hover-elevate">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" />
            <h3 className="font-bold">{booking.serviceType}</h3>
            {booking.priority && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary ring-1 ring-primary/30"
                title="This owner has a priority-booking subscription. Their job floats to the top of your queue."
              >
                <Zap className="h-3 w-3" />
                Priority
              </span>
            )}
          </div>
          <StatusBadge status={booking.status} type="booking" />
        </div>
      </CardHeader>
      
      <CardContent className="py-4 flex-grow space-y-3">
        {role === "center" ? (
          <div className="flex items-start gap-2 text-sm">
            <Car className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
            <div>
              <span className="font-medium text-foreground">
                {booking.vehicle?.brand} {booking.vehicle?.model}
              </span>
              <p className="text-muted-foreground">{booking.vehicle?.plateNumber}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-sm">
            <Store className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
            <div>
              <span className="font-medium text-foreground">
                {booking.serviceCenter?.name}
              </span>
            </div>
          </div>
        )}

        {role === "center" && booking.mechanic && (
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span>{booking.mechanic.name}</span>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4 shrink-0" />
          {booking.scheduledAt ? (
            <span>Scheduled: {formatDate(booking.scheduledAt)}</span>
          ) : (
            <span>Requested: {formatDate(booking.requestedAt)}</span>
          )}
        </div>
        
        <p className="text-sm line-clamp-2 text-muted-foreground mt-2 border-l-2 border-muted pl-2">
          {booking.description}
        </p>
      </CardContent>
      
      <CardFooter className="pt-0 mt-auto">
        <Link href={`/bookings/${booking.id}`} className="w-full">
          <Button variant="outline" className="w-full">View Details</Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
