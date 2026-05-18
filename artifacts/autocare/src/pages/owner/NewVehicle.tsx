import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateVehicle, getListVehiclesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const formSchema = z.object({
  brand: z.string().min(1, "Brand is required"),
  model: z.string().min(1, "Model is required"),
  year: z.coerce.number().min(1900).max(2100),
  plateNumber: z.string().min(1, "Plate number is required"),
  color: z.string().min(1, "Color is required"),
  vin: z.string().optional(),
  mileage: z.coerce.number().min(0),
  ownerName: z.string().min(1, "Owner name is required"),
  ownerPhone: z.string().optional(),
  engineType: z.string().optional(),
  insuranceProvider: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewVehicle() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createVehicle = useCreateVehicle();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      brand: "",
      model: "",
      year: new Date().getFullYear(),
      plateNumber: "",
      color: "",
      vin: "",
      mileage: 0,
      ownerName: "John Doe",
      ownerPhone: "",
      engineType: "",
      insuranceProvider: "",
    },
  });

  function onSubmit(values: FormValues) {
    createVehicle.mutate(
      { data: values },
      {
        onSuccess: () => {
          toast.success("Vehicle added successfully");
          queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
          setLocation("/vehicles");
        },
        onError: () => {
          toast.error("Failed to add vehicle");
        },
      }
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="Add Vehicle" 
        description="Register a new vehicle to your account."
      />

      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="brand"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Brand</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Toyota" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Camry" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="plateNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Plate Number</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. ABC-1234" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Silver" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mileage</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>VIN (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="engineType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Engine Type (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. V6 Hybrid" {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ownerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Owner Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ownerPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Owner Phone (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-4 pt-4 border-t">
                <Button variant="outline" type="button" onClick={() => setLocation("/vehicles")}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createVehicle.isPending}>
                  {createVehicle.isPending ? "Adding..." : "Add Vehicle"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
