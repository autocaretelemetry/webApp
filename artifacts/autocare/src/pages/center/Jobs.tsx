import { useListBookings } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { BookingCard } from "@/components/BookingCard";
import { EmptyState } from "@/components/EmptyState";
import { Wrench } from "lucide-react";

export default function Jobs() {
  const { data: bookings, isLoading } = useListBookings({ role: "center" });

  const incomingRequests = bookings?.filter(b => b.status === "requested") || [];
  const activeJobs = bookings?.filter(b => ["in_progress", "accepted", "awaiting_approval"].includes(b.status)) || [];

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="Jobs Board" 
        description="Manage service requests and active repairs."
      />

      {isLoading ? (
        <div className="p-8">Loading jobs...</div>
      ) : (
        <div className="space-y-12">
          <section>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              Incoming Requests 
              <span className="bg-amber-100 text-amber-800 text-xs py-0.5 px-2 rounded-full">{incomingRequests.length}</span>
            </h2>
            
            {incomingRequests.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {incomingRequests.map(job => (
                  <BookingCard key={job.id} booking={job} role="center" />
                ))}
              </div>
            ) : (
              <div className="p-8 border border-dashed rounded-lg text-center text-muted-foreground">
                No incoming requests right now.
              </div>
            )}
          </section>

          <section>
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              Active Jobs
              <span className="bg-primary/20 text-primary text-xs py-0.5 px-2 rounded-full">{activeJobs.length}</span>
            </h2>
            
            {activeJobs.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeJobs.map(job => (
                  <BookingCard key={job.id} booking={job} role="center" />
                ))}
              </div>
            ) : (
              <EmptyState 
                icon={Wrench} 
                title="No active jobs" 
                description="Your workshop floor is empty." 
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
