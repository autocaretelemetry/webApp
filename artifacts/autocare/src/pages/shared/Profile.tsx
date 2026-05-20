import { useEffect, useState } from "react";
import {
  useUpdateMyProfile,
  useChangePassword,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageUploader } from "@/components/ImageUploader";
import { resolveImageUrl } from "@/lib/format";
import { Bell, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type NotifChannel = "email" | "whatsapp";
const DEFAULT_CHANNELS: NotifChannel[] = ["email", "whatsapp"];
function normalizeChannels(raw: unknown): NotifChannel[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_CHANNELS];
  const set = new Set(raw);
  const out = DEFAULT_CHANNELS.filter((c) => set.has(c));
  return out.length ? out : [...DEFAULT_CHANNELS];
}
function sameChannels(a: NotifChannel[], b: NotifChannel[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((c) => sb.has(c));
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Vehicle Owner",
  center: "Service Center",
  vendor: "Vendor",
  delivery: "Delivery Agent",
  admin: "Platform Admin",
  super_admin: "Super Admin",
};

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const updateProfile = useUpdateMyProfile();
  const changePassword = useChangePassword();

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [channels, setChannels] = useState<NotifChannel[]>(() =>
    normalizeChannels(user?.notificationChannels),
  );

  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setPhone(user.phone ?? "");
    setAvatarUrl(user.avatarUrl ?? "");
    setChannels(normalizeChannels(user.notificationChannels));
  }, [user]);

  const toggleChannel = (channel: NotifChannel, on: boolean) => {
    setChannels((prev) => {
      const next = new Set(prev);
      if (on) next.add(channel);
      else next.delete(channel);
      return DEFAULT_CHANNELS.filter((c) => next.has(c));
    });
  };

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  if (!user) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  const savedChannels = normalizeChannels(user.notificationChannels);
  const dirty =
    name.trim() !== user.name ||
    (phone.trim() || null) !== (user.phone ?? null) ||
    (avatarUrl.trim() || null) !== (user.avatarUrl ?? null) ||
    !sameChannels(channels, savedChannels);

  const saveProfile = async () => {
    if (!name.trim()) {
      toast.error("Name can't be empty.");
      return;
    }
    if (channels.length === 0) {
      toast.error("Pick at least one notification channel so we can reach you.");
      return;
    }
    try {
      await updateProfile.mutateAsync({
        data: {
          name: name.trim(),
          phone: phone.trim() || null,
          avatarUrl: avatarUrl.trim() || null,
          notificationChannels: channels,
        },
      });
      await refresh();
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile.");
    }
  };

  const submitPassword = async () => {
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }
    try {
      await changePassword.mutateAsync({
        data: { currentPassword, newPassword },
      });
      toast.success("Password changed. Use it next time you sign in.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change password.");
    }
  };

  const initial = user.name.charAt(0).toUpperCase();
  const resolvedAvatar = resolveImageUrl(avatarUrl);

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500 max-w-3xl">
      <PageHeader title="My profile" description="Update your details, photo, and password." />

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start gap-5">
            <div className="h-20 w-20 rounded-full overflow-hidden bg-primary/10 text-primary flex items-center justify-center text-2xl font-semibold uppercase shrink-0 border">
              {resolvedAvatar ? (
                <img
                  src={resolvedAvatar}
                  alt={user.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                initial
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Profile photo
              </div>
              <div className="text-sm text-muted-foreground">
                Square JPG, PNG, or WebP works best. Shown next to your name everywhere.
              </div>
              <div className="pt-2">
                <ImageUploader
                  value={avatarUrl}
                  onChange={setAvatarUrl}
                  label="Upload profile photo"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="profile-name">Full name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" value={user.email} disabled />
              <p className="text-[11px] text-muted-foreground">
                Email is your sign-in identifier and can't be changed here.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-phone">Phone</Label>
              <Input
                id="profile-phone"
                value={phone}
                placeholder="+233 ..."
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Input value={ROLE_LABEL[user.role] ?? user.role} disabled />
            </div>
          </div>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" /> Decision notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose how we let you know about application approvals, rejections,
            and KYC decisions. Pick at least one — both are on by default.
          </p>
          <div className="space-y-3">
            <label className="flex items-start gap-3 border p-3 rounded-md cursor-pointer hover:bg-muted/40">
              <Checkbox
                id="notif-email"
                checked={channels.includes("email")}
                onCheckedChange={(v) => toggleChannel("email", v === true)}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <div className="font-medium text-sm">Email</div>
                <div className="text-xs text-muted-foreground">
                  Sent to {user.email}.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 border p-3 rounded-md cursor-pointer hover:bg-muted/40">
              <Checkbox
                id="notif-whatsapp"
                checked={channels.includes("whatsapp")}
                onCheckedChange={(v) => toggleChannel("whatsapp", v === true)}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <div className="font-medium text-sm">WhatsApp</div>
                <div className="text-xs text-muted-foreground">
                  {user.phone
                    ? `Sent to ${user.phone}.`
                    : "Add a phone number above to receive WhatsApp messages."}
                </div>
              </div>
            </label>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={saveProfile}
              disabled={!dirty || updateProfile.isPending}
              className="gap-2"
            >
              {updateProfile.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Change password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cur-pw">Current password</Label>
            <Input
              id="cur-pw"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Confirm new password</Label>
              <Input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={submitPassword}
              disabled={
                changePassword.isPending ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
              className="gap-2"
            >
              {changePassword.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Update password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
