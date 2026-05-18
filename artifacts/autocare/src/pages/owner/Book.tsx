import { useState } from "react";
import { useLocation } from "wouter";
import { useListVehicles, useListServiceCenters, useListServiceTypes, useCreateBooking, getListBookingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { format } from "date-fns";

export default function Book() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createBooking = useCreateBooking();

  // Parse query params for pre-selection
  const searchParams = new URLSearchParams(window.location.search);
  const initialVehicleId = searchParams.get("vehicle") || "";
  const initialCenterId = searchParams.get("center") || "";

  const [step, setStep] = useState<"vehicle" | "center" | "service" | "details">("vehicle");
  const [vehicleId, setVehicleId] = useState(initialVehicleId);
  const [centerId, setCenterId] = useState(initialCenterId);
  const [serviceType, setServiceType] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");

  const { data: vehicles } = useListVehicles();
  const { data: centers } = useListServiceCenters();
  const { data: serviceTypes } = useListServiceTypes();

  // If vehicle or center is pre-selected and valid, jump forward if possible, 
  // but keep it simple: just pre-fill state and let user click Next.
  
  const handleNext = (nextStep: "center" | "service" | "details") => {
    setStep(nextStep);
  };

  const handleSubmit = () => {
    if (!vehicleId || !centerId || !serviceType || !description) {
      toast.error("Please fill out all required fields");
      return;
    }

    createBooking.mutate(
      {
        data: {
          vehicleId,
          serviceCenterId: centerId,
          serviceType,
          description,
          scheduledAt: date ? new Date(date).toISOString() : undefined,
        }
      },
      {
        onSuccess: (data) => {
          toast.success("Booking requested successfully!");
          queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey() });
          setLocation(`/bookings/${data.id}`);
        },
        onError: () => {
          toast.error("Failed to create booking");
        }
      }
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="Book Service" 
        description="Schedule maintenance or repair for your vehicle."
      />

      <Tabs value={step} onValueChange={(v) => setStep(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-8">
          <TabsTrigger value="vehicle" disabled={!vehicles?.length}>1. Vehicle</TabsTrigger>
          <TabsTrigger value="center" disabled={!vehicleId}>2. Center</TabsTrigger>
          <TabsTrigger value="service" disabled={!centerId}>3. Service</TabsTrigger>
          <TabsTrigger value="details" disabled={!serviceType}>4. Details</TabsTrigger>
        </TabsList>

        <Card>
          <CardContent className="pt-6 min-h-[400px]">
            <TabsContent value="vehicle" className="mt-0">
              <h3 className="text-lg font-semibold mb-4">Select a vehicle</h3>
              {!vehicles?.length ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">You need to add a vehicle first.</p>
                  <Button onClick={() => setLocation("/vehicles/new")}>Add Vehicle</Button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {vehicles.map(v => (
                    <div 
                      key={v.id}
                      className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${vehicleId === v.id ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'}`}
                      onClick={() => setVehicleId(v.id)}
                    >
                      <div className="font-bold text-lg">{v.brand} {v.model}</div>
                      <div className="text-muted-foreground text-sm">{v.year} • {v.plateNumber}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end mt-8">
                <Button disabled={!vehicleId} onClick={() => handleNext("center")}>Next Step</Button>
              </div>
            </TabsContent>

            <TabsContent value="center" className="mt-0">
              <h3 className="text-lg font-semibold mb-4">Select a service center</h3>
              <div className="grid gap-4 sm:grid-cols-2 h-[300px] overflow-y-auto pr-2">
                {centers?.map(c => (
                  <div 
                    key={c.id}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${centerId === c.id ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'}`}
                    onClick={() => setCenterId(c.id)}
                  >
                    <div className="font-bold">{c.name}</div>
                    <div className="text-sm text-muted-foreground line-clamp-1">{c.address}</div>
                    <div className="mt-2 text-xs font-medium text-primary">★ {c.rating} • {c.openJobs} active jobs</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-8">
                <Button variant="outline" onClick={() => setStep("vehicle")}>Back</Button>
                <Button disabled={!centerId} onClick={() => handleNext("service")}>Next Step</Button>
              </div>
            </TabsContent>

            <TabsContent value="service" className="mt-0">
              <h3 className="text-lg font-semibold mb-4">Select service type</h3>
              <div className="grid gap-4 sm:grid-cols-2 h-[300px] overflow-y-auto pr-2">
                {serviceTypes?.map(s => (
                  <div 
                    key={s.id}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${serviceType === s.id ? 'border-primary bg-primary/5' : 'border-muted hover:border-primary/50'}`}
                    onClick={() => setServiceType(s.id)}
                  >
                    <div className="font-bold">{s.name}</div>
                    <div className="text-sm text-muted-foreground mb-2 line-clamp-2">{s.description}</div>
                    <div className="flex justify-between text-xs font-medium">
                      <span>Est. {s.estimatedHours} hrs</span>
                      <span className="text-primary">From {formatCurrency(s.startingPrice)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-8">
                <Button variant="outline" onClick={() => setStep("center")}>Back</Button>
                <Button disabled={!serviceType} onClick={() => handleNext("details")}>Next Step</Button>
              </div>
            </TabsContent>

            <TabsContent value="details" className="mt-0 space-y-6">
              <h3 className="text-lg font-semibold mb-4">Final details</h3>
              
              <div>
                <label className="block text-sm font-medium mb-2">Issue Description / Notes</label>
                <Textarea 
                  placeholder="Describe the problem or specify what needs to be done..."
                  className="min-h-[120px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Preferred Date (Optional)</label>
                <input 
                  type="datetime-local" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                />
              </div>

              <div className="bg-muted/50 p-4 rounded-lg border">
                <h4 className="font-semibold mb-2">Summary</h4>
                <div className="text-sm space-y-1 text-muted-foreground">
                  <div><span className="font-medium text-foreground">Vehicle:</span> {vehicles?.find(v => v.id === vehicleId)?.brand} {vehicles?.find(v => v.id === vehicleId)?.model}</div>
                  <div><span className="font-medium text-foreground">Center:</span> {centers?.find(c => c.id === centerId)?.name}</div>
                  <div><span className="font-medium text-foreground">Service:</span> {serviceTypes?.find(s => s.id === serviceType)?.name}</div>
                </div>
              </div>

              <div className="flex justify-between mt-8 pt-4 border-t">
                <Button variant="outline" onClick={() => setStep("service")}>Back</Button>
                <Button onClick={handleSubmit} disabled={!description || createBooking.isPending}>
                  {createBooking.isPending ? "Submitting..." : "Submit Booking"}
                </Button>
              </div>
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
