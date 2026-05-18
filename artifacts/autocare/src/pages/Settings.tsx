import { useRole } from "@/lib/role";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

export default function Settings() {
  const { role, setRole } = useRole();

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="Settings" 
        description="Manage app preferences."
      />

      <Card>
        <CardHeader>
          <CardTitle>Demo Mode: Role Switcher</CardTitle>
          <CardDescription>
            AutoCare is a two-sided marketplace. Use this setting to switch between the Owner and Service Center views. This is stored in your local storage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={role} onValueChange={(v) => setRole(v as any)} className="space-y-4">
            <div className="flex items-center space-x-2 border p-4 rounded-md cursor-pointer hover:bg-muted/50" onClick={() => setRole("owner")}>
              <RadioGroupItem value="owner" id="r1" />
              <div className="grid gap-1.5 ml-2 cursor-pointer">
                <Label htmlFor="r1" className="font-bold cursor-pointer">Vehicle Owner</Label>
                <p className="text-sm text-muted-foreground">
                  View your vehicles, track maintenance history, and book new services.
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2 border p-4 rounded-md cursor-pointer hover:bg-muted/50" onClick={() => setRole("center")}>
              <RadioGroupItem value="center" id="r2" />
              <div className="grid gap-1.5 ml-2 cursor-pointer">
                <Label htmlFor="r2" className="font-bold cursor-pointer">Service Center</Label>
                <p className="text-sm text-muted-foreground">
                  Manage incoming bookings, assign mechanics, create invoices, and track revenue.
                </p>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
    </div>
  );
}
