import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListServiceCenters,
  useListMechanicsForCenter,
  useCreateMechanic,
  getListMechanicsForCenterQueryKey,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { MechanicCard } from "@/components/MechanicCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUploader } from "@/components/ImageUploader";
import { Users, Plus, Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

export default function Mechanics() {
  // Hardcoded to first center for demo as per instructions
  const { data: centers, isLoading: isLoadingCenters } = useListServiceCenters();
  const firstCenterId = centers?.[0]?.id;

  const { data: mechanics, isLoading: isLoadingMechanics } = useListMechanicsForCenter(
    firstCenterId || "",
    { query: { enabled: !!firstCenterId, queryKey: getListMechanicsForCenterQueryKey(firstCenterId || "") } }
  );

  const queryClient = useQueryClient();
  const createMechanic = useCreateMechanic();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [yearsExperience, setYearsExperience] = useState(0);
  const [certifications, setCertifications] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setSpecialization("");
    setYearsExperience(0);
    setCertifications("");
    setAvatarUrl("");
  };

  const onSubmit = async () => {
    if (!firstCenterId) return;
    if (!name.trim() || !specialization.trim()) {
      toast.error("Name and specialization are required.");
      return;
    }
    setSubmitting(true);
    try {
      await createMechanic.mutateAsync({
        centerId: firstCenterId,
        data: {
          name: name.trim(),
          specialization: specialization.trim(),
          yearsExperience: Math.max(0, Math.floor(yearsExperience)),
          certifications: certifications
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          avatarUrl: avatarUrl || null,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getListMechanicsForCenterQueryKey(firstCenterId),
      });
      toast.success(`${name.trim()} added to your roster.`);
      reset();
      setShowForm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add mechanic.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = isLoadingCenters || isLoadingMechanics;

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Our Mechanics"
          description="Your workshop's roster of professionals."
        />
        {firstCenterId && !showForm && (
          <Button onClick={() => setShowForm(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add mechanic
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">New mechanic</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  reset();
                  setShowForm(false);
                }}
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div>
              <Label>Profile photo (optional)</Label>
              <div className="mt-1.5 max-w-xs">
                <ImageUploader
                  value={avatarUrl}
                  onChange={setAvatarUrl}
                  label="Upload mechanic's photo"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="m-name">Full name</Label>
                <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" placeholder="e.g. Kwame Mensah" />
              </div>
              <div>
                <Label htmlFor="m-spec">Specialization</Label>
                <Input
                  id="m-spec"
                  value={specialization}
                  onChange={(e) => setSpecialization(e.target.value)}
                  className="mt-1.5"
                  placeholder="e.g. Engine diagnostics"
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="m-years">Years of experience</Label>
                <Input
                  id="m-years"
                  type="number"
                  min={0}
                  value={yearsExperience}
                  onChange={(e) => setYearsExperience(Number(e.target.value))}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="m-certs">Certifications (comma-separated)</Label>
                <Input
                  id="m-certs"
                  value={certifications}
                  onChange={(e) => setCertifications(e.target.value)}
                  className="mt-1.5"
                  placeholder="ASE, Bosch, Toyota T-TEN"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  setShowForm(false);
                }}
              >
                Cancel
              </Button>
              <Button onClick={onSubmit} disabled={submitting} className="gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Add to roster
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : mechanics && mechanics.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2">
          {mechanics.map(mechanic => (
            <MechanicCard key={mechanic.id} mechanic={mechanic} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed rounded-lg">
          <Users className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold">No mechanics yet</h3>
          <p className="text-muted-foreground mb-4">Add mechanics to your roster to assign them to jobs.</p>
          {firstCenterId && !showForm && (
            <Button onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Add your first mechanic
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
