import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetLandingContent,
  useUpdateLandingContent,
  getGetLandingContentQueryKey,
  type LandingContent,
  type LandingRoleCard,
  type LandingRoleCardIcon,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImageUploader } from "@/components/ImageUploader";
import { Loader2, Plus, Save, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";

const ICON_OPTIONS: LandingRoleCardIcon[] = [
  "car",
  "building",
  "package",
  "truck",
  "shield",
  "wrench",
  "users",
];

type Draft = Omit<LandingContent, "logoUrl" | "heroImageUrl"> & {
  logoUrl: string;
  heroImageUrl: string;
};

function toDraft(c: LandingContent): Draft {
  return {
    ...c,
    logoUrl: c.logoUrl ?? "",
    heroImageUrl: c.heroImageUrl ?? "",
    roles: c.roles.map((r) => ({ ...r })),
    features: [...c.features],
  };
}

export default function LandingEditor() {
  const { data, isLoading, isError, error, refetch } = useGetLandingContent();
  const update = useUpdateLandingContent();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !draft) setDraft(toDraft(data));
  }, [data, draft]);

  const dirty = useMemo(() => {
    if (!draft || !data) return false;
    return JSON.stringify(draft) !== JSON.stringify(toDraft(data));
  }, [draft, data]);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Landing page" description="Edit the public marketing page." />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  if (isError || !draft) {
    return (
      <div className="space-y-6">
        <PageHeader title="Landing page" description="Edit the public marketing page." />
        <Card>
          <CardContent className="p-6 space-y-3 text-center">
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Couldn't load landing content."}
            </p>
            <Button onClick={() => void refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const updateRole = (i: number, patch: Partial<LandingRoleCard>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            roles: d.roles.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
          }
        : d,
    );

  const addRole = () =>
    setDraft((d) =>
      d
        ? {
            ...d,
            roles: [
              ...d.roles,
              { icon: "wrench", title: "New role", desc: "Describe this role." },
            ],
          }
        : d,
    );

  const removeRole = (i: number) =>
    setDraft((d) =>
      d ? { ...d, roles: d.roles.filter((_, idx) => idx !== i) } : d,
    );

  const updateFeature = (i: number, value: string) =>
    setDraft((d) =>
      d
        ? { ...d, features: d.features.map((f, idx) => (idx === i ? value : f)) }
        : d,
    );

  const addFeature = () =>
    setDraft((d) =>
      d ? { ...d, features: [...d.features, "New feature"] } : d,
    );

  const removeFeature = (i: number) =>
    setDraft((d) =>
      d ? { ...d, features: d.features.filter((_, idx) => idx !== i) } : d,
    );

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await update.mutateAsync({
        data: {
          ...draft,
          logoUrl: draft.logoUrl || null,
          heroImageUrl: draft.heroImageUrl || null,
          roles: draft.roles.filter((r) => r.title.trim() && r.desc.trim()),
          features: draft.features.map((f) => f.trim()).filter(Boolean),
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetLandingContentQueryKey(),
      });
      toast.success("Landing page updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500 pb-32">
      <PageHeader
        title="Landing page"
        description="Edit everything visitors see on the public AutoCare page — branding, hero, sections, and footer."
        actions={
          <Link href="/" target="_blank" rel="noreferrer">
            <Button variant="outline" className="gap-2">
              <ExternalLink className="h-4 w-4" /> View live
            </Button>
          </Link>
        }
      />

      <Card>
        <CardContent className="p-6 space-y-5">
          <h3 className="font-semibold">Branding</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="brand">Brand name</Label>
              <Input
                id="brand"
                value={draft.brandName}
                onChange={(e) => set("brandName", e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="color">Primary color</Label>
              <div className="mt-1.5 flex gap-2 items-center">
                <input
                  id="color"
                  type="color"
                  value={draft.primaryColor}
                  onChange={(e) => set("primaryColor", e.target.value)}
                  className="h-10 w-14 rounded border bg-background cursor-pointer"
                />
                <Input
                  value={draft.primaryColor}
                  onChange={(e) => set("primaryColor", e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
          </div>
          <div>
            <Label>Logo (optional)</Label>
            <div className="mt-1.5 max-w-xs">
              <ImageUploader
                value={draft.logoUrl}
                onChange={(v) => set("logoUrl", v)}
                label="Upload a logo"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-5">
          <h3 className="font-semibold">Header</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="signin">Sign in button label</Label>
              <Input
                id="signin"
                value={draft.signInLabel}
                onChange={(e) => set("signInLabel", e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="getstarted">Get started button label</Label>
              <Input
                id="getstarted"
                value={draft.getStartedLabel}
                onChange={(e) => set("getStartedLabel", e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-5">
          <h3 className="font-semibold">Hero section</h3>
          <div>
            <Label htmlFor="eyebrow">Eyebrow tag</Label>
            <Input
              id="eyebrow"
              value={draft.heroEyebrow}
              onChange={(e) => set("heroEyebrow", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="title">Headline</Label>
            <Input
              id="title"
              value={draft.heroTitle}
              onChange={(e) => set("heroTitle", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="subtitle">Subheading</Label>
            <Textarea
              id="subtitle"
              value={draft.heroSubtitle}
              onChange={(e) => set("heroSubtitle", e.target.value)}
              rows={3}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="cta">Call-to-action label</Label>
            <Input
              id="cta"
              value={draft.heroCtaLabel}
              onChange={(e) => set("heroCtaLabel", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Hero image (optional)</Label>
            <div className="mt-1.5">
              <ImageUploader
                value={draft.heroImageUrl}
                onChange={(v) => set("heroImageUrl", v)}
                label="Upload a hero image"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Role cards</h3>
            <Button variant="outline" size="sm" onClick={addRole} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add card
            </Button>
          </div>
          <div>
            <Label htmlFor="roles-heading">Section heading</Label>
            <Input
              id="roles-heading"
              value={draft.rolesHeading}
              onChange={(e) => set("rolesHeading", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div className="space-y-3">
            {draft.roles.map((r, i) => (
              <div
                key={i}
                className="border rounded-md p-4 grid sm:grid-cols-[140px_1fr_auto] gap-3 items-start bg-muted/20"
              >
                <Select
                  value={r.icon}
                  onValueChange={(v) =>
                    updateRole(i, { icon: v as LandingRoleCardIcon })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ICON_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="space-y-2">
                  <Input
                    value={r.title}
                    onChange={(e) => updateRole(i, { title: e.target.value })}
                    placeholder="Title"
                  />
                  <Textarea
                    value={r.desc}
                    onChange={(e) => updateRole(i, { desc: e.target.value })}
                    rows={2}
                    placeholder="Description"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRole(i)}
                  aria-label="Remove role card"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Features list</h3>
            <Button variant="outline" size="sm" onClick={addFeature} className="gap-1.5">
              <Plus className="h-4 w-4" /> Add feature
            </Button>
          </div>
          <div>
            <Label htmlFor="features-heading">Section heading</Label>
            <Input
              id="features-heading"
              value={draft.featuresHeading}
              onChange={(e) => set("featuresHeading", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="features-subtitle">Subheading</Label>
            <Textarea
              id="features-subtitle"
              value={draft.featuresSubtitle}
              onChange={(e) => set("featuresSubtitle", e.target.value)}
              rows={2}
              className="mt-1.5"
            />
          </div>
          <div className="space-y-2">
            {draft.features.map((f, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={f}
                  onChange={(e) => updateFeature(i, e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFeature(i)}
                  aria-label="Remove feature"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-5">
          <h3 className="font-semibold">Footer</h3>
          <div>
            <Label htmlFor="footer-text">Footer text</Label>
            <Input
              id="footer-text"
              value={draft.footerText}
              onChange={(e) => set("footerText", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="footer-link">Footer link label</Label>
            <Input
              id="footer-link"
              value={draft.footerSignInLabel}
              onChange={(e) => set("footerSignInLabel", e.target.value)}
              className="mt-1.5"
            />
          </div>
        </CardContent>
      </Card>

      <div className="fixed bottom-4 right-4 z-40">
        <Button
          onClick={save}
          disabled={!dirty || saving}
          size="lg"
          className="gap-2 shadow-lg"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {dirty ? "Save changes" : "Saved"}
        </Button>
      </div>
    </div>
  );
}
