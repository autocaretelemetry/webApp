import { Mechanic } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Star, Wrench, Award, CheckCircle2 } from "lucide-react";
import { resolveImageUrl } from "@/lib/format";

interface MechanicCardProps {
  mechanic: Mechanic;
}

export function MechanicCard({ mechanic }: MechanicCardProps) {
  const initials = mechanic.name
    .split(" ")
    .map(n => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <Card className="hover-elevate">
      <CardContent className="p-6">
        <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start text-center sm:text-left">
          <Avatar className="h-24 w-24 border-2 border-muted shadow-sm">
            <AvatarImage src={resolveImageUrl(mechanic.avatarUrl) || undefined} alt={mechanic.name} />
            <AvatarFallback className="text-2xl bg-primary/10 text-primary">{initials}</AvatarFallback>
          </Avatar>
          
          <div className="flex-1 space-y-3">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                <h3 className="text-xl font-bold">{mechanic.name}</h3>
                <div className="flex items-center justify-center sm:justify-end gap-1 bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full text-xs font-medium dark:bg-amber-900/30 dark:text-amber-400 w-fit mx-auto sm:mx-0">
                  <Star className="h-3.5 w-3.5 fill-current" />
                  <span>{mechanic.rating}</span>
                </div>
              </div>
              <p className="text-primary font-medium">{mechanic.specialization}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <Award className="h-4 w-4 text-primary" />
                <span>{mechanic.yearsExperience} Years Exp</span>
              </div>
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{mechanic.completedJobs} Jobs</span>
              </div>
            </div>
            
            {mechanic.certifications && mechanic.certifications.length > 0 && (
              <div className="pt-1">
                <div className="flex flex-wrap gap-1.5 justify-center sm:justify-start">
                  {mechanic.certifications.map(cert => (
                    <Badge key={cert} variant="outline" className="text-xs bg-background">
                      {cert}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
