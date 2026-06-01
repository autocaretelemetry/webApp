import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useUpload } from "@workspace/object-storage-web";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  IdCard,
  UploadCloud,
  Loader2,
  Image as ImageIcon,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { MyApprovalTimeline } from "./MyApprovalTimeline";
import { API_ROOT } from "../../lib/api-base";
import { resolveImageUrl } from "@/lib/format";

type DocSpec = { key: string; label: string; required: boolean };

const COMMON_DOCS: DocSpec[] = [
  { key: "gov_id", label: "Government ID (front)", required: true },
  { key: "selfie", label: "Selfie holding the ID", required: true },
];

function docsForRole(requestedRole: string | null | undefined): DocSpec[] {
  const docs = [...COMMON_DOCS];
  switch (requestedRole) {
    case "renter":
      docs.push({ key: "driver_license", label: "Driver's licence", required: true });
      break;
    case "center":
    case "vendor":
      docs.push({ key: "business_reg", label: "Business registration certificate", required: true });
      break;
    case "fleet":
      docs.push({ key: "business_reg", label: "Organisation registration certificate", required: true });
      docs.push({ key: "vehicle_reg", label: "Sample vehicle registration", required: true });
      break;
    case "delivery":
      docs.push({ key: "driver_license", label: "Driver's licence", required: true });
      break;
    default:
      break;
  }
  return docs;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export default function OnboardingKyc() {
  const { user, refresh } = useAuth();
  const requestedRole = user?.requestedRole ?? user?.role ?? null;
  const docs = docsForRole(requestedRole);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const status = user?.kycStatus ?? "not_submitted";
  const note = user?.kycNote ?? null;
  // Map of doc.key → reviewer-supplied rejection reason. Populated when the
  // super admin rejected specific documents (see PATCH /admin/kyc/:userId
  // `documentDecisions`). Cleared by the server on the next /me/kyc submit.
  const docRejections: Record<string, string> = {};
  for (const d of user?.kycDocuments ?? []) {
    if (d.rejectionReason) docRejections[d.key] = d.rejectionReason;
  }
  const hasPerDocReasons = Object.keys(docRejections).length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const missing = docs.filter((d) => d.required && !urls[d.key]);
    if (missing.length > 0) {
      toast.error(`Please upload: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      const documents = docs
        .filter((d) => urls[d.key])
        .map((d) => ({ key: d.key, label: d.label, url: urls[d.key]! }));
      const res = await fetch(`${API_ROOT}/me/kyc`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documents }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Submission failed." }));
        throw new Error(body.error ?? "Submission failed.");
      }
      toast.success("KYC submitted. We'll review it shortly.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 space-y-6">
      <PageHeader
        title="Finish your KYC"
        description="Upload the documents below so our team can verify your account. You'll get full access once they're approved."
      />

      {status === "submitted" && (
        <StatusCallout
          icon={Clock}
          tone="warn"
          title="KYC under review"
          body="Your documents are in the queue. We'll unlock the rest of the app as soon as the team has reviewed them."
        />
      )}
      {status === "verified" && (
        <StatusCallout
          icon={CheckCircle2}
          tone="ok"
          title="KYC verified"
          body="You're all set — head to your dashboard."
        />
      )}
      {status === "rejected" && (
        <StatusCallout
          icon={AlertCircle}
          tone="bad"
          title="KYC needs changes"
          body={
            note ??
            (hasPerDocReasons
              ? "Please re-upload the documents flagged below."
              : "Please re-upload clear images of the required documents.")
          }
        />
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <IdCard className="h-4 w-4" /> Required documents
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground flex items-start gap-2">
              <UploadCloud className="h-4 w-4 mt-0.5 flex-shrink-0" />
              JPG or PNG, up to 10&nbsp;MB each.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {docs.map((d) => (
                <UploadField
                  key={d.key}
                  label={d.label}
                  required={d.required}
                  url={urls[d.key] ?? ""}
                  rejectionReason={docRejections[d.key]}
                  onChange={(url) => setUrls((u) => ({ ...u, [d.key]: url }))}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : status === "submitted" ? "Re-submit" : "Submit for review"}
          </Button>
        </div>
      </form>

      <MyApprovalTimeline />
    </div>
  );
}

function StatusCallout({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: typeof Clock;
  tone: "ok" | "warn" | "bad";
  title: string;
  body: string;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <div className={`rounded-lg border p-3 flex items-start gap-3 ${cls}`}>
      <Icon className="h-5 w-5 mt-0.5 flex-shrink-0" />
      <div className="space-y-0.5">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs">{body}</div>
      </div>
    </div>
  );
}

function UploadField({
  label,
  required,
  url,
  rejectionReason,
  onChange,
}: {
  label: string;
  required?: boolean;
  url: string;
  rejectionReason?: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading, progress } = useUpload({
    onSuccess: (res) => onChange(`/api/storage${res.objectPath}`),
    onError: (err) => toast.error(err.message || "Upload failed."),
  });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick a JPG or PNG image.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Image must be 10 MB or smaller.");
      return;
    }
    await uploadFile(file);
  }

  const needsReupload = !!rejectionReason;
  return (
    <div
      className={`space-y-1.5 ${
        needsReupload ? "rounded-md border border-destructive/40 bg-destructive/5 p-2" : ""
      }`}
    >
      <Label className="flex items-center justify-between">
        <span>
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
          {needsReupload && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-destructive">
              <AlertCircle className="h-3 w-3" /> Re-upload
            </span>
          )}
        </span>
        {url && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
      </Label>
      <div
        className="aspect-[4/3] rounded-md border border-dashed bg-muted/40 overflow-hidden flex items-center justify-center relative cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        {url ? (
          <img src={resolveImageUrl(url)} alt={label} className="w-full h-full object-cover" />
        ) : isUploading ? (
          <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Uploading… {progress}%
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground p-3 text-center">
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
      {needsReupload && (
        <p className="text-[11px] text-destructive flex items-start gap-1">
          <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{rejectionReason}</span>
        </p>
      )}
    </div>
  );
}
