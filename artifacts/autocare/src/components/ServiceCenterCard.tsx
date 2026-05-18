import { ServiceCenter } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Phone, Star, Wrench } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

interface ServiceCenterCardProps {
  center: ServiceCenter;
}

export function ServiceCenterCard({ center }: ServiceCenterCardProps) {
  return (
    <Card className="flex flex-col h-full hover-elevate overflow-hidden">
      {center.imageUrl && (
        <div className="h-40 w-full overflow-hidden bg-muted">
          <img 
            src={center.imageUrl} 
            alt={center.name} 
            className="h-full w-full object-cover"
          />
        </div>
      )}
      
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <h3 className="text-xl font-bold line-clamp-1">{center.name}</h3>
          <div className="flex items-center gap-1 bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-xs font-medium dark:bg-amber-900/30 dark:text-amber-400">
            <Star className="h-3 w-3 fill-current" />
            <span>{center.rating}</span>
            <span className="text-amber-800/60 dark:text-amber-400/60 ml-0.5">({center.reviewsCount})</span>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pb-4 flex-grow text-sm space-y-3">
        <div className="space-y-1.5 text-muted-foreground">
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-foreground/50" />
            <span className="line-clamp-2">{center.address}</span>
          </div>
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 shrink-0 text-foreground/50" />
            <span>{center.phone}</span>
          </div>
        </div>
        
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-foreground">
            <Wrench className="h-3.5 w-3.5" /> Specialties
          </div>
          <div className="flex flex-wrap gap-1">
            {center.specialties.slice(0, 3).map(spec => (
              <Badge key={spec} variant="secondary" className="text-xs font-normal">
                {spec}
              </Badge>
            ))}
            {center.specialties.length > 3 && (
              <Badge variant="outline" className="text-xs font-normal">
                +{center.specialties.length - 3} more
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
      
      <CardFooter className="pt-0 mt-auto grid grid-cols-2 gap-2">
        <Link href={`/service-centers/${center.id}`}>
          <Button variant="outline" className="w-full">Details</Button>
        </Link>
        <Link href={`/book?center=${center.id}`}>
          <Button className="w-full">Book Service</Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
