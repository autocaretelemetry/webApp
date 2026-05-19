import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateVehicle,
  getGetVehicleQueryKey,
  getGetVehicleRemindersQueryKey,
  getListNotificationsQueryKey,
  type Vehicle,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wrench } from "lucide-react";
import { toast } from "sonner";
import { useRenterProfile } from "@/lib/profile";

/**
 * Edits the service window for one vehicle. Reminders fire when the time
 * interval OR the mileage interval is crossed — whichever happens first.
 */
export function ServiceIntervalCard({ vehicle }: { vehicle: Vehicle }) {
  const { profile } = useRenterProfile();
  const [intervalDays, setIntervalDays] = useState(
    String(vehicle.serviceIntervalDays ?? 90),
  );
  const [intervalKm, setIntervalKm] = useState(
    String(vehicle.serviceIntervalKm ?? 5000),
  );
  const [mileage, setMileage] = useState(String(vehicle.mileage ?? 0));

  useEffect(() => {
    setIntervalDays(String(vehicle.serviceIntervalDays ?? 90));
    setIntervalKm(String(vehicle.serviceIntervalKm ?? 5000));
    setMileage(String(vehicle.mileage ?? 0));
  }, [vehicle.id, vehicle.serviceIntervalDays, vehicle.serviceIntervalKm, vehicle.mileage]);

  const queryClient = useQueryClient();
  const mutation = useUpdateVehicle({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetVehicleQueryKey(vehicle.id),
        });
        queryClient.invalidateQueries({
          queryKey: getGetVehicleRemindersQueryKey(vehicle.id),
        });
        queryClient.invalidateQueries({
          queryKey: getListNotificationsQueryKey({ ownerPhone: profile.phone }),
        });
        toast.success("Service window updated");
      },
      onError: () => toast.error("Could not save service window"),
    },
  });

  function save() {
    const days = Number(intervalDays);
    const km = Number(intervalKm);
    const ml = Number(mileage);
    if (!Number.isFinite(days) || days < 1) {
      toast.error("Days between services must be at least 1");
      return;
    }
    if (!Number.isFinite(km) || km < 1) {
      toast.error("Distance between services must be at least 1 km");
      return;
    }
    if (!Number.isFinite(ml) || ml < 0) {
      toast.error("Mileage cannot be negative");
      return;
    }
    mutation.mutate({
      vehicleId: vehicle.id,
      data: {
        serviceIntervalDays: days,
        serviceIntervalKm: km,
        mileage: ml,
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary" />
          Service window
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          You'll get a reminder when either threshold is crossed — whichever
          comes first.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="svc-days" className="text-xs">
              Days between services
            </Label>
            <Input
              id="svc-days"
              type="number"
              min={1}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="svc-km" className="text-xs">
              Kilometres between services
            </Label>
            <Input
              id="svc-km"
              type="number"
              min={1}
              value={intervalKm}
              onChange={(e) => setIntervalKm(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="svc-mileage" className="text-xs">
              Current odometer (km)
            </Label>
            <Input
              id="svc-mileage"
              type="number"
              min={0}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
