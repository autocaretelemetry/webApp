import { Vehicle } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Car, Calendar, Settings, Hash } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface VehicleCardProps {
  vehicle: Vehicle;
}

export function VehicleCard({ vehicle }: VehicleCardProps) {
  return (
    <Card className="flex flex-col h-full hover-elevate overflow-hidden">
      {vehicle.imageUrl ? (
        <div className="h-48 w-full overflow-hidden bg-muted">
          <img 
            src={vehicle.imageUrl} 
            alt={`${vehicle.year} ${vehicle.brand} ${vehicle.model}`} 
            className="h-full w-full object-cover transition-transform hover:scale-105"
          />
        </div>
      ) : (
        <div className="h-32 w-full bg-muted flex items-center justify-center">
          <Car className="h-12 w-12 text-muted-foreground/30" />
        </div>
      )}
      
      <CardHeader className="pb-2 flex-none">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-xl font-bold line-clamp-1">{vehicle.brand} {vehicle.model}</h3>
            <p className="text-muted-foreground text-sm">{vehicle.year}</p>
          </div>
          <Badge variant="outline" className="bg-background">{vehicle.plateNumber}</Badge>
        </div>
      </CardHeader>
      
      <CardContent className="pb-4 flex-grow text-sm">
        <div className="grid grid-cols-2 gap-y-2 text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Settings className="h-3.5 w-3.5" />
            <span>{vehicle.engineType || "Standard Engine"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5" />
            <span>{vehicle.mileage.toLocaleString()} mi</span>
          </div>
          {vehicle.nextServiceDate && (
            <div className="flex items-center gap-1.5 col-span-2 text-primary font-medium mt-2">
              <Calendar className="h-3.5 w-3.5" />
              <span>Next service: {new Date(vehicle.nextServiceDate).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      </CardContent>
      
      <CardFooter className="pt-0 mt-auto flex-none">
        <Link href={`/vehicles/${vehicle.id}`} className="w-full">
          <Button variant="secondary" className="w-full">View Details</Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
