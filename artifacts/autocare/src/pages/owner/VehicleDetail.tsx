import { useParams, Link } from "wouter";
import { useGetVehicle, useGetVehicleHistory, useGetVehicleReminders, getGetVehicleQueryKey, getGetVehicleHistoryQueryKey, getGetVehicleRemindersQueryKey } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Car, Settings, Hash, Calendar, AlertCircle } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { ServiceIntervalCard } from "@/components/ServiceIntervalCard";

export default function VehicleDetail() {
  const params = useParams();
  const vehicleId = params.id as string;

  const { data: vehicle, isLoading: isLoadingVehicle } = useGetVehicle(vehicleId, { query: { enabled: !!vehicleId, queryKey: getGetVehicleQueryKey(vehicleId) } });
  const { data: history, isLoading: isLoadingHistory } = useGetVehicleHistory(vehicleId, { query: { enabled: !!vehicleId, queryKey: getGetVehicleHistoryQueryKey(vehicleId) } });
  const { data: reminders, isLoading: isLoadingReminders } = useGetVehicleReminders(vehicleId, { query: { enabled: !!vehicleId, queryKey: getGetVehicleRemindersQueryKey(vehicleId) } });

  if (isLoadingVehicle) return <div className="p-8">Loading vehicle...</div>;
  if (!vehicle) return <div className="p-8">Vehicle not found</div>;

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title={`${vehicle.year} ${vehicle.brand} ${vehicle.model}`}
        description={`Plate: ${vehicle.plateNumber}`}
        actions={
          <Link href={`/book?vehicle=${vehicle.id}`}>
            <Button>Book Service</Button>
          </Link>
        }
      />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1 overflow-hidden">
          {vehicle.imageUrl ? (
             <div className="h-48 w-full bg-muted">
               <img src={vehicle.imageUrl} alt="Vehicle" className="h-full w-full object-cover" />
             </div>
          ) : (
            <div className="h-48 w-full bg-muted flex items-center justify-center">
              <Car className="h-16 w-16 text-muted-foreground/30" />
            </div>
          )}
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Settings className="h-4 w-4" />
              <span>{vehicle.engineType || "Standard Engine"}</span>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
              <Hash className="h-4 w-4" />
              <span>{vehicle.mileage.toLocaleString()} mi</span>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
              <div className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: vehicle.color.toLowerCase() }} />
              <span>{vehicle.color}</span>
            </div>
            {vehicle.vin && (
               <div className="pt-4 border-t text-sm">
                 <span className="text-muted-foreground block mb-1">VIN Number</span>
                 <code className="bg-muted px-2 py-1 rounded">{vehicle.vin}</code>
               </div>
            )}
          </CardContent>
        </Card>

        <div className="md:col-span-2">
          <Tabs defaultValue="history" className="w-full">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="history">Service History</TabsTrigger>
              <TabsTrigger value="reminders">Reminders</TabsTrigger>
            </TabsList>
            
            <TabsContent value="history" className="mt-6 space-y-4">
              {isLoadingHistory ? (
                <div>Loading history...</div>
              ) : history && history.length > 0 ? (
                history.map(record => (
                  <Card key={record.id}>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-lg">{record.serviceType}</CardTitle>
                        <span className="font-bold text-primary">{formatCurrency(record.totalCost)}</span>
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        {formatDate(record.completedAt)}
                        <span>•</span>
                        <span>{record.serviceCenterName}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{record.summary}</p>
                      {record.mileageAtService && (
                        <Badge variant="outline" className="mt-3">
                          {record.mileageAtService.toLocaleString()} mi
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No service history available.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="reminders" className="mt-6 space-y-4">
              {isLoadingReminders ? (
                <div>Loading reminders...</div>
              ) : reminders && reminders.length > 0 ? (
                reminders.map(reminder => (
                  <Card key={reminder.id} className={reminder.urgency === 'high' ? 'border-destructive' : ''}>
                    <CardContent className="pt-6 flex items-start gap-4">
                      <div className={`mt-1 p-2 rounded-full ${reminder.urgency === 'high' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                        <AlertCircle className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-lg">{reminder.title}</h4>
                        <p className="text-sm text-muted-foreground mt-1 mb-2">{reminder.detail}</p>
                        <div className="flex items-center gap-2 text-sm font-medium">
                           Due: {formatDate(reminder.dueAt)}
                           <Badge variant="outline" className={
                             reminder.urgency === 'high' ? 'text-destructive border-destructive' : ''
                           }>
                             {reminder.urgency}
                           </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No upcoming reminders.
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ServiceIntervalCard vehicle={vehicle} />
    </div>
  );
}
