import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRegisterDeliveryAgent,
  useGetDeliveryAgent,
} from "@workspace/api-client-react";
import { getGetDeliveryAgentQueryKey, getListDeliveryAgentsQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setDeliveryAgentId, useDeliveryAgentId } from "@/lib/role";
import { toast } from "sonner";
import { Loader2, UserCheck, LogOut, Truck } from "lucide-react";

const CITY_OPTIONS = ["Lagos", "Port Harcourt", "Abuja"];
const REGION_BY_CITY: Record<string, string> = {
  Lagos: "Lagos",
  "Port Harcourt": "Rivers",
  Abuja: "FCT",
};

export default function DeliveryRegister() {
  const agentId = useDeliveryAgentId();
  const queryClient = useQueryClient();

  const { data: agent } = useGetDeliveryAgent(agentId ?? "", {
    query: { enabled: !!agentId, queryKey: getGetDeliveryAgentQueryKey(agentId ?? "") },
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+234 ");
  const [city, setCity] = useState<string>("Lagos");
  const [vehicleType, setVehicleType] = useState<string>("Motorcycle");
  const [bio, setBio] = useState("");
  const register = useRegisterDeliveryAgent();
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!name.trim() || !phone.trim()) {
      toast.error("Name and phone are required.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await register.mutateAsync({
        data: {
          name: name.trim(),
          phone: phone.trim(),
          city,
          region: REGION_BY_CITY[city] ?? city,
          vehicleType,
          bio: bio.trim() || null,
        },
      });
      setDeliveryAgentId(created.id);
      await queryClient.invalidateQueries({ queryKey: getListDeliveryAgentsQueryKey() });
      toast.success("Welcome aboard. You're ready to receive deliveries.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Registration failed.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (agentId && agent) {
    return (
      <div className="space-y-6 animate-in fade-in-50 duration-500">
        <PageHeader title="Delivery profile" description="Your active delivery agent identity on this device." />
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Truck className="h-6 w-6" />
              </div>
              <div>
                <p className="font-semibold text-lg">{agent.name}</p>
                <p className="text-sm text-muted-foreground">{agent.phone}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm pt-4 border-t">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">City</p>
                <p className="font-medium">{agent.city}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Region</p>
                <p className="font-medium">{agent.region}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Vehicle</p>
                <p className="font-medium">{agent.vehicleType}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Rating</p>
                <p className="font-medium">{agent.rating.toFixed(1)} · {agent.completedDeliveries} runs</p>
              </div>
            </div>
            {agent.bio && (
              <div className="text-sm pt-4 border-t">
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">About</p>
                <p>{agent.bio}</p>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setDeliveryAgentId(null);
                toast.success("Signed out of this delivery profile.");
              }}
              className="gap-2"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500 max-w-2xl">
      <PageHeader
        title="Sign up as a delivery agent"
        description="Self-register to start picking up parts orders from vendors in your city."
      />
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="d-name">Full name</Label>
              <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="d-phone">Phone</Label>
              <Input id="d-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>City</Label>
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CITY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vehicle type</Label>
              <Select value={vehicleType} onValueChange={setVehicleType}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Motorcycle">Motorcycle</SelectItem>
                  <SelectItem value="Van">Van</SelectItem>
                  <SelectItem value="Pickup">Pickup</SelectItem>
                  <SelectItem value="Bicycle">Bicycle</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="d-bio">Short bio (optional)</Label>
            <Textarea id="d-bio" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} className="mt-1.5" placeholder="Years of experience, areas you cover, etc." />
          </div>
          <Button onClick={onSubmit} disabled={submitting} className="gap-2">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
            Register
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
