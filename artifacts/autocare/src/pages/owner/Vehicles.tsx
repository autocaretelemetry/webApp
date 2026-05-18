import { useListVehicles } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { VehicleCard } from "@/components/VehicleCard";
import { EmptyState } from "@/components/EmptyState";
import { Car } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Vehicles() {
  const { data: vehicles, isLoading } = useListVehicles();

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="My Vehicles" 
        description="Manage your registered vehicles."
        actions={
          <Link href="/vehicles/new">
            <Button>Add Vehicle</Button>
          </Link>
        }
      />

      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-80 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : vehicles && vehicles.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Car}
          title="No vehicles found"
          description="You haven't registered any vehicles yet."
          action={
            <Link href="/vehicles/new">
              <Button>Add your first vehicle</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
