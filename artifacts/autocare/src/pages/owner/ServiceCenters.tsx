import { useState } from "react";
import { useListServiceCenters } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { ServiceCenterCard } from "@/components/ServiceCenterCard";
import { Badge } from "@/components/ui/badge";

const SPECIALTIES = ["All", "General", "Oil Change", "Brakes", "Tires", "Engine", "Transmission", "Electric", "Hybrid"];

export default function ServiceCenters() {
  const [specialty, setSpecialty] = useState<string>("All");
  
  const { data: centers, isLoading } = useListServiceCenters(
    specialty !== "All" ? { specialty: specialty.toLowerCase() } : {}
  );

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="Service Centers" 
        description="Find trusted workshops for your vehicle."
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {SPECIALTIES.map(s => (
          <Badge 
            key={s} 
            variant={specialty === s ? "default" : "outline"}
            className="cursor-pointer hover:bg-primary/90 hover:text-primary-foreground"
            onClick={() => setSpecialty(s)}
          >
            {s}
          </Badge>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-72 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : centers && centers.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {centers.map(center => (
            <ServiceCenterCard key={center.id} center={center} />
          ))}
        </div>
      ) : (
        <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
          No service centers found for the selected specialty.
        </div>
      )}
    </div>
  );
}
