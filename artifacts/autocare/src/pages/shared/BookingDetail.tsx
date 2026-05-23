import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useRole } from "@/lib/role";
import {
  useGetBooking,
  useUpdateBookingStatus,
  useAssignMechanic,
  useCreateInvoice,
  useListMechanicsForCenter,
  useListOrders,
  getGetBookingQueryKey,
  getListMechanicsForCenterQueryKey,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { PaymentBadge } from "@/components/PaymentBadge";
import { Timeline } from "@/components/Timeline";
import { InvoiceSummary } from "@/components/InvoiceSummary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Car, Store, Wrench, Calendar, Info, Receipt, Package, ShoppingBag, KeyRound } from "lucide-react";
import { formatDateTime, formatCurrency } from "@/lib/format";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function OwnerActions({ booking, onCancel }: { booking: any, onCancel: () => void }) {
  const loanerEligible = ["accepted", "in_progress", "awaiting_approval"].includes(booking.status);
  return (
    <div className="space-y-2 mt-4">
      {loanerEligible && (
        <Link href={`/rentals?loaner=${booking.id}`}>
          <Button variant="outline" className="w-full gap-2">
            <KeyRound className="h-4 w-4" /> Need a loaner car?
          </Button>
        </Link>
      )}
      {booking.status === "requested" && (
        <Button variant="destructive" onClick={onCancel} className="w-full">
          Cancel Request
        </Button>
      )}
    </div>
  );
}

const invoiceSchema = z.object({
  items: z.array(z.object({
    description: z.string().min(1, "Required"),
    quantity: z.coerce.number().min(1),
    unitPrice: z.coerce.number().min(0),
    kind: z.enum(["labor", "part"])
  })).min(1, "At least one item is required"),
  taxRate: z.coerce.number().min(0).max(1),
  notes: z.string().optional()
});

type InvoiceFormValues = z.infer<typeof invoiceSchema>;

export default function BookingDetail() {
  const params = useParams();
  const bookingId = params.id as string;
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: booking, isLoading } = useGetBooking(bookingId, { query: { enabled: !!bookingId, queryKey: getGetBookingQueryKey(bookingId) } });

  const updateStatus = useUpdateBookingStatus();
  const assignMechanic = useAssignMechanic();
  const createInvoice = useCreateInvoice();

  const { data: mechanics } = useListMechanicsForCenter(
    booking?.serviceCenterId || "",
    { query: { enabled: role === "center" && !!booking?.serviceCenterId, queryKey: getListMechanicsForCenterQueryKey(booking?.serviceCenterId || "") } }
  );

  // Parts orders tied to this booking — visible to both owner and center.
  const ordersParams = { bookingId };
  const { data: bookingOrders } = useListOrders(ordersParams, {
    query: { enabled: !!bookingId, queryKey: getListOrdersQueryKey(ordersParams) },
  });

  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedMechanic, setSelectedMechanic] = useState("");

  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);

  const invoiceForm = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      items: [{ description: "", quantity: 1, unitPrice: 0, kind: "labor" }],
      taxRate: 0.08,
      notes: ""
    }
  });

  const { fields, append, remove } = useFieldArray({
    control: invoiceForm.control,
    name: "items"
  });

  const handleUpdateStatus = (status: any) => {
    updateStatus.mutate(
      { bookingId, data: { status } },
      {
        onSuccess: () => {
          toast.success("Status updated");
          queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(bookingId) });
        },
        onError: () => toast.error("Failed to update status")
      }
    );
  };

  const handleAssignMechanic = () => {
    if (!selectedMechanic) return;
    assignMechanic.mutate(
      { bookingId, data: { mechanicId: selectedMechanic } },
      {
        onSuccess: () => {
          toast.success("Mechanic assigned");
          setIsAssignOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(bookingId) });
        },
        onError: () => toast.error("Failed to assign mechanic")
      }
    );
  };

  const handleCreateInvoice = (values: InvoiceFormValues) => {
    createInvoice.mutate(
      { bookingId, data: values },
      {
        onSuccess: () => {
          toast.success("Invoice created");
          setIsInvoiceOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(bookingId) });
        },
        onError: () => toast.error("Failed to create invoice")
      }
    );
  };

  if (isLoading) return <div className="p-8">Loading booking...</div>;
  if (!booking) return <div className="p-8">Booking not found</div>;

  const canOrderParts =
    role === "center" &&
    !!booking.mechanicId &&
    booking.status === "in_progress";

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500 pb-12">
      <PageHeader
        title={`Booking #${booking.id.split("-")[0].toUpperCase()}`}
        actions={<StatusBadge status={booking.status} type="booking" className="text-sm px-3 py-1" />}
      />

      <div className="grid gap-8 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" /> Service Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-bold text-lg mb-1">{booking.serviceType}</h4>
                <p className="text-muted-foreground whitespace-pre-wrap bg-muted/30 p-3 rounded border">
                  {booking.description}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                 <div>
                   <div className="text-sm font-medium text-muted-foreground flex items-center gap-1 mb-1">
                     <Calendar className="h-4 w-4" /> Requested
                   </div>
                   <div>{formatDateTime(booking.requestedAt)}</div>
                 </div>
                 {booking.scheduledAt && (
                   <div>
                     <div className="text-sm font-medium text-muted-foreground flex items-center gap-1 mb-1">
                       <Calendar className="h-4 w-4" /> Scheduled
                     </div>
                     <div>{formatDateTime(booking.scheduledAt)}</div>
                   </div>
                 )}
              </div>
            </CardContent>
          </Card>

          <div className="grid sm:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Car className="h-4 w-4" /> Vehicle
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-bold">{booking.vehicle?.brand} {booking.vehicle?.model}</div>
                <div className="text-sm text-muted-foreground">{booking.vehicle?.year} • {booking.vehicle?.plateNumber}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Store className="h-4 w-4" /> Service Center
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-bold">{booking.serviceCenter?.name}</div>
                <div className="text-sm text-muted-foreground line-clamp-1">{booking.serviceCenter?.address}</div>
                {booking.mechanic && (
                  <div className="mt-2 text-sm pt-2 border-t">
                    <span className="font-medium">Assigned:</span> {booking.mechanic.name}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Parts orders tied to this booking */}
          {bookingOrders && bookingOrders.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-primary" /> Parts orders for this job
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {bookingOrders.map((o) => (
                  <Link key={o.id} href={`/orders/${o.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-md border hover:border-primary/40 hover:bg-muted/30 cursor-pointer transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <p className="font-medium truncate">
                            {o.vendor?.name ?? "Vendor"} · #{o.id.slice(0, 8)}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {o.itemsCount ?? 0} items · {formatCurrency(o.total)}
                          {o.mechanic ? ` · proposed by ${o.mechanic.name}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <OrderStatusBadge status={o.status} />
                        <PaymentBadge
                          status={o.paymentStatus ?? "unpaid"}
                          authorized={o.centerPayAuthorized}
                        />
                      </div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {booking.timeline && booking.timeline.length > 0 ? (
                <Timeline entries={booking.timeline} />
              ) : (
                <div className="text-muted-foreground">No timeline events yet.</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {role === "owner" && (
                <OwnerActions booking={booking} onCancel={() => handleUpdateStatus("cancelled")} />
              )}

              {role === "center" && (
                <>
                  {booking.status === "requested" && (
                    <div className="space-y-2">
                      <Button className="w-full" onClick={() => handleUpdateStatus("accepted")}>Accept Job</Button>
                      <Button variant="destructive" className="w-full" onClick={() => handleUpdateStatus("cancelled")}>Decline</Button>
                    </div>
                  )}

                  {booking.status === "accepted" && (
                    <div className="space-y-2">
                      {!booking.mechanicId ? (
                         <Button className="w-full" onClick={() => setIsAssignOpen(true)}>Assign Mechanic</Button>
                      ) : (
                         <Button className="w-full" onClick={() => handleUpdateStatus("in_progress")}>Start Work</Button>
                      )}
                    </div>
                  )}

                  {booking.status === "in_progress" && (
                    <Button className="w-full" onClick={() => setIsInvoiceOpen(true)}>
                      Create Invoice & Request Approval
                    </Button>
                  )}

                  {booking.status === "approved" && (
                    <Button className="w-full" onClick={() => handleUpdateStatus("completed")}>
                      Mark Completed
                    </Button>
                  )}

                  {canOrderParts && (
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() =>
                        navigate(
                          `/marketplace?bookingId=${booking.id}&mechanicId=${booking.mechanicId}`,
                        )
                      }
                    >
                      <ShoppingBag className="h-4 w-4" />
                      Order parts for this job
                    </Button>
                  )}
                </>
              )}

              {(booking.status === "completed" || booking.status === "cancelled") && (
                <div className="text-center text-sm text-muted-foreground p-3 bg-muted rounded-md flex items-center justify-center gap-2">
                  <Info className="h-4 w-4" /> This booking is closed.
                </div>
              )}
            </CardContent>
          </Card>

          {booking.invoice ? (
             <InvoiceSummary invoice={booking.invoice} />
          ) : (
             <Card>
               <CardContent className="py-8 text-center text-muted-foreground flex flex-col items-center">
                 <Receipt className="h-10 w-10 text-muted mb-2" />
                 <p>No invoice generated yet.</p>
               </CardContent>
             </Card>
          )}

          {booking.invoice && (
            <Link href={`/invoices/${booking.invoice.id}`} className="block">
              <Button variant="outline" className="w-full">View Full Invoice Details</Button>
            </Link>
          )}
        </div>
      </div>

      {role === "center" && (
        <>
          <Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign Mechanic</DialogTitle>
              </DialogHeader>
              <div className="py-4">
                <Select value={selectedMechanic} onValueChange={setSelectedMechanic}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a mechanic" />
                  </SelectTrigger>
                  <SelectContent>
                    {mechanics?.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name} — {m.specialization}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAssignOpen(false)}>Cancel</Button>
                <Button onClick={handleAssignMechanic} disabled={!selectedMechanic || assignMechanic.isPending}>
                  Assign
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isInvoiceOpen} onOpenChange={setIsInvoiceOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Invoice</DialogTitle>
              </DialogHeader>
              <Form {...invoiceForm}>
                <form onSubmit={invoiceForm.handleSubmit(handleCreateInvoice)} className="space-y-6 py-4">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium text-sm">Line Items</h4>
                      <Button type="button" variant="outline" size="sm" onClick={() => append({ description: "", quantity: 1, unitPrice: 0, kind: "labor" })}>
                        + Add Item
                      </Button>
                    </div>
                    {fields.map((field, index) => (
                      <div key={field.id} className="flex gap-2 items-start">
                        <div className="grid grid-cols-12 gap-2 flex-1">
                          <FormField
                            control={invoiceForm.control}
                            name={`items.${index}.description`}
                            render={({ field }) => (
                              <FormItem className="col-span-5">
                                <FormControl><Input placeholder="Description" {...field} /></FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={invoiceForm.control}
                            name={`items.${index}.kind`}
                            render={({ field }) => (
                              <FormItem className="col-span-3">
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                  <FormControl>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="labor">Labor</SelectItem>
                                    <SelectItem value="part">Part</SelectItem>
                                  </SelectContent>
                                </Select>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={invoiceForm.control}
                            name={`items.${index}.quantity`}
                            render={({ field }) => (
                              <FormItem className="col-span-2">
                                <FormControl><Input type="number" step="0.1" placeholder="Qty" {...field} /></FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={invoiceForm.control}
                            name={`items.${index}.unitPrice`}
                            render={({ field }) => (
                              <FormItem className="col-span-2">
                                <FormControl><Input type="number" step="0.01" placeholder="Price" {...field} /></FormControl>
                              </FormItem>
                            )}
                          />
                        </div>
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="mt-0.5">✕</Button>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={invoiceForm.control}
                      name="taxRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tax Rate (e.g. 0.08 for 8%)</FormLabel>
                          <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={invoiceForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl><Textarea placeholder="Optional notes for customer" {...field} value={field.value || ""} /></FormControl>
                      </FormItem>
                    )}
                  />

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsInvoiceOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={createInvoice.isPending}>
                      Submit Invoice
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
