import { resolveImageUrl } from "@/lib/format";
import { useParams, Link } from "wouter";
import { useGetServiceCenter, useListMechanicsForCenter, getGetServiceCenterQueryKey, getListMechanicsForCenterQueryKey } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MechanicCard } from "@/components/MechanicCard";
import { RetainerPlansSection } from "@/components/RetainerPlansSection";
import { MapPin, Phone, Star, Wrench, Info, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function ServiceCenterDetail() {
  const params = useParams();
  const centerId = params.id as string;

  const { data: center, isLoading: isLoadingCenter } = useGetServiceCenter(centerId, { query: { enabled: !!centerId, queryKey: getGetServiceCenterQueryKey(centerId) } });
  const { data: mechanics, isLoading: isLoadingMechanics } = useListMechanicsForCenter(centerId, { query: { enabled: !!centerId, queryKey: getListMechanicsForCenterQueryKey(centerId) } });

  if (isLoadingCenter) return <div className="p-8">Loading...</div>;
  if (!center) return <div className="p-8">Service Center not found</div>;

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div className="relative h-64 rounded-xl overflow-hidden bg-muted mb-8">
        {center.imageUrl ? (
          <img src={resolveImageUrl(center.imageUrl)} alt={center.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Store className="h-16 w-16 text-muted-foreground/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex items-end p-8">
          <div className="text-white">
            <h1 className="text-4xl font-bold mb-2">{center.name}</h1>
            <div className="flex items-center gap-4 text-white/90 text-sm">
               <div className="flex items-center gap-1 bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                 <Star className="h-4 w-4 fill-current" />
                 <span className="font-bold">{center.rating}</span>
                 <span>({center.reviewsCount} reviews)</span>
               </div>
               <div className="flex items-center gap-1">
                 <MapPin className="h-4 w-4" />
                 <span>{center.address}</span>
               </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <div className="md:col-span-2 space-y-8">
           <section>
             <h2 className="text-2xl font-bold mb-4">About Us</h2>
             <Card>
               <CardContent className="pt-6">
                 <p className="text-muted-foreground leading-relaxed">
                   {center.bio || "A trusted auto care center providing quality service and maintenance for all vehicle makes and models."}
                 </p>
                 
                 <div className="mt-6">
                   <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                     <Wrench className="h-4 w-4" /> Specialties
                   </h3>
                   <div className="flex flex-wrap gap-2">
                     {center.specialties.map(spec => (
                       <Badge key={spec} variant="secondary">{spec}</Badge>
                     ))}
                   </div>
                 </div>
               </CardContent>
             </Card>
           </section>

           <section>
             <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
               <ShieldCheck className="h-6 w-6 text-primary" /> Retainer Plans
             </h2>
             <RetainerPlansSection
               serviceCenterId={center.id}
               serviceCenterName={center.name}
             />
           </section>

           <section>
             <h2 className="text-2xl font-bold mb-4">Our Mechanics</h2>
             {isLoadingMechanics ? (
               <div>Loading mechanics...</div>
             ) : mechanics && mechanics.length > 0 ? (
               <div className="grid gap-4">
                 {mechanics.map(mechanic => (
                   <MechanicCard key={mechanic.id} mechanic={mechanic} />
                 ))}
               </div>
             ) : (
               <div className="text-muted-foreground">No mechanics listed.</div>
             )}
           </section>
        </div>

        <div className="space-y-6">
           <Card className="sticky top-6">
             <CardContent className="pt-6 space-y-6">
               <Link href={`/book?center=${center.id}`} className="w-full block">
                 <Button className="w-full h-12 text-lg">Book Service</Button>
               </Link>

               <div className="space-y-4 pt-4 border-t">
                 <div className="flex items-start gap-3">
                   <Phone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                   <div>
                     <div className="font-medium">Phone</div>
                     <div className="text-muted-foreground">{center.phone}</div>
                   </div>
                 </div>
                 <div className="flex items-start gap-3">
                   <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                   <div>
                     <div className="font-medium">Location</div>
                     <div className="text-muted-foreground">{center.address}</div>
                   </div>
                 </div>
                 <div className="flex items-start gap-3">
                   <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                   <div>
                     <div className="font-medium">Status</div>
                     <div className="text-muted-foreground">{center.openJobs} active jobs</div>
                   </div>
                 </div>
               </div>
             </CardContent>
           </Card>
        </div>
      </div>
    </div>
  );
}

// Needed to fix the missing Store icon import above
import { Store } from "lucide-react";
