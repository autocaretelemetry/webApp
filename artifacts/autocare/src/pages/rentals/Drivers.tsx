import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDrivers,
  useCreateDriver,
  useUpdateDriver,
  useDeleteDriver,
  type Driver,
} from "@workspace/api-client-react";
import { getListDriversQueryKey } from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { resolveImageUrl } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useUpload } from "@workspace/object-storage-web";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  UserPlus,
  User,
  Phone,
  IdCard,
  Languages,
  Pencil,
  Trash2,
  Image as ImageIcon,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";

type FormState = {
  name: string;
  phone: string;
  photoUrl: string;
  licenseNumber: string;
  yearsExperience: number;
  languages: string; // comma-separated input
  bio: string;
};

const blankForm: FormState = {
  name: "",
  phone: "",
  photoUrl: "",
  licenseNumber: "",
  yearsExperience: 0,
  languages: "",
  bio: "",
};

export default function DriversPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const ownerPhone = user?.phone ?? "";

  const { data: drivers, isLoading } = useListDrivers(
    { ownerPhone },
    {
      query: {
        enabled: !!ownerPhone,
        queryKey: getListDriversQueryKey({ ownerPhone }),
      },
    },
  );

  const create = useCreateDriver();
  const update = useUpdateDriver();
  const remove = useDeleteDriver();

  const [editing, setEditing] = useState<Driver | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);

  const startCreate = () => {
    setEditing(null);
    setForm({ ...blankForm, phone: ownerPhone });
    setShowForm(true);
  };

  const startEdit = (d: Driver) => {
    setEditing(d);
    setForm({
      name: d.name,
      phone: d.phone,
      photoUrl: d.photoUrl ?? "",
      licenseNumber: d.licenseNumber ?? "",
      yearsExperience: d.yearsExperience,
      languages: (d.languages ?? []).join(", "),
      bio: d.bio ?? "",
    });
    setShowForm(true);
  };

  const cancel = () => {
    setShowForm(false);
    setEditing(null);
    setForm(blankForm);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerPhone) {
      toast.error("Add your phone in your renter profile first so we can scope drivers to you.");
      return;
    }
    const languages = form.languages
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      if (editing) {
        await update.mutateAsync({
          driverId: editing.id,
          data: {
            name: form.name,
            phone: form.phone,
            photoUrl: form.photoUrl || null,
            licenseNumber: form.licenseNumber || null,
            yearsExperience: form.yearsExperience,
            languages,
            bio: form.bio || null,
          },
        });
        toast.success("Driver updated.");
      } else {
        await create.mutateAsync({
          data: {
            ownerPhone,
            name: form.name,
            phone: form.phone,
            photoUrl: form.photoUrl || undefined,
            licenseNumber: form.licenseNumber || undefined,
            yearsExperience: form.yearsExperience,
            languages,
            bio: form.bio || undefined,
          },
        });
        toast.success("Driver added.");
      }
      await queryClient.invalidateQueries({ queryKey: getListDriversQueryKey({ ownerPhone }) });
      cancel();
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to save driver."));
    }
  };

  const onDelete = async (d: Driver) => {
    if (!confirm(`Delete ${d.name}? This cannot be undone.`)) return;
    try {
      await remove.mutateAsync({ driverId: d.id });
      await queryClient.invalidateQueries({ queryKey: getListDriversQueryKey({ ownerPhone }) });
      toast.success("Driver removed.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to remove driver."));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Drivers"
        description="Manage chauffeur profiles. Attach a driver to a car listing whenever you offer it with a driver — renters will see the driver's profile before booking."
        actions={
          !showForm ? (
            <Button onClick={startCreate} className="gap-2">
              <UserPlus className="h-4 w-4" /> Add driver
            </Button>
          ) : undefined
        }
      />

      {!ownerPhone && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 text-sm">
            Add your phone number on the <strong>Renter Profile</strong> page first — drivers are scoped to your owner phone.
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4" /> {editing ? "Edit driver" : "New driver"}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={cancel}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                <PhotoField
                  url={form.photoUrl}
                  onChange={(u) => setForm((f) => ({ ...f, photoUrl: u }))}
                />
                <div className="grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Full name" required>
                      <Input
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        required
                      />
                    </Field>
                    <Field label="Phone" required>
                      <Input
                        value={form.phone}
                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                        required
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Driver's licence number">
                      <Input
                        value={form.licenseNumber}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, licenseNumber: e.target.value }))
                        }
                        placeholder="LAG-DL-…"
                      />
                    </Field>
                    <Field label="Years of experience">
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        value={form.yearsExperience}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            yearsExperience: Number(e.target.value),
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Languages (comma separated)">
                    <Input
                      value={form.languages}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, languages: e.target.value }))
                      }
                      placeholder="English, Twi, French"
                    />
                  </Field>
                  <Field label="Short bio (optional)">
                    <Textarea
                      rows={3}
                      value={form.bio}
                      onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                      placeholder="Calm city driver, 8 years of airport runs and weddings."
                    />
                  </Field>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending || update.isPending}>
                  {create.isPending || update.isPending
                    ? "Saving…"
                    : editing
                      ? "Save changes"
                      : "Add driver"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading drivers…</p>
      ) : (drivers ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No drivers yet. Add one to start listing your cars with a chauffeur.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(drivers ?? []).map((d) => (
            <Card key={d.id} className="overflow-hidden">
              <div className="flex gap-3 p-4">
                <div className="h-16 w-16 rounded-md overflow-hidden bg-muted flex items-center justify-center shrink-0">
                  {d.photoUrl ? (
                    <img src={resolveImageUrl(d.photoUrl)} alt={d.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="h-7 w-7 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{d.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Phone className="h-3 w-3" /> {d.phone}
                  </div>
                  {d.licenseNumber && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <IdCard className="h-3 w-3" /> {d.licenseNumber}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {d.yearsExperience} {d.yearsExperience === 1 ? "year" : "years"} experience
                  </div>
                  {(d.languages ?? []).length > 0 && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <Languages className="h-3 w-3" /> {(d.languages ?? []).join(", ")}
                    </div>
                  )}
                </div>
              </div>
              {d.bio && (
                <p className="px-4 pb-3 text-xs text-muted-foreground line-clamp-3">{d.bio}</p>
              )}
              <div className="border-t bg-muted/30 px-3 py-2 flex justify-end gap-1">
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => startEdit(d)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => onDelete(d)}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
    </div>
  );
}

const MAX_BYTES = 10 * 1024 * 1024;

function PhotoField({
  url,
  onChange,
}: {
  url: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading, progress } = useUpload({
    onSuccess: (res) => onChange(`/api/storage${res.objectPath}`),
    onError: (err) => toast.error(err.message || "Upload failed."),
  });
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick a JPG or PNG image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be 10 MB or smaller.");
      return;
    }
    await uploadFile(file);
  };
  return (
    <div className="space-y-1.5">
      <Label>Driver photo</Label>
      <div
        className="aspect-square rounded-md border border-dashed bg-muted/40 overflow-hidden flex items-center justify-center relative cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => inputRef.current?.click()}
      >
        {url ? (
          <img src={resolveImageUrl(url)} alt="Driver" className="w-full h-full object-cover" />
        ) : isUploading ? (
          <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {progress}%
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground p-2 text-center">
            <ImageIcon className="h-5 w-5" />
            Click to upload
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPick}
        />
      </div>
      {url && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
        >
          <Trash2 className="h-3 w-3" /> Remove
        </button>
      )}
    </div>
  );
}
