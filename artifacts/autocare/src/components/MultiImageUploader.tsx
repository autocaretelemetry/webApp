import { useEffect, useRef, useState } from "react";
import { useRequestUploadUrl } from "@workspace/api-client-react";
import { ImagePlus, Loader2, Star, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/format";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

type Props = {
  value: string[];
  onChange: (paths: string[]) => void;
  max?: number;
  className?: string;
};

/**
 * Multi-image uploader for car listings: lets owners upload several photos
 * (exterior, interior, back, side). The first photo is treated as the cover
 * shown on browse cards; the rest are revealed in the detail gallery.
 *
 * Tap a tile to make it the cover; tap "×" to remove a photo.
 */
export function MultiImageUploader({ value, onChange, max = 8, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestUrl = useRequestUploadUrl();
  const [uploadingCount, setUploadingCount] = useState(0);
  // Mirror of the latest `value` so async upload completions can append onto
  // the freshest array — not a stale snapshot captured when uploads started.
  // Without this, removing or reordering a photo mid-upload would be undone
  // when the in-flight upload resolves.
  const latestValueRef = useRef(value);
  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);
  const remaining = Math.max(0, max - value.length);

  async function uploadOne(file: File): Promise<string | null> {
    if (!ACCEPTED.includes(file.type)) {
      toast.error(`${file.name}: unsupported type. Use JPG, PNG, or WebP.`);
      return null;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`${file.name}: too large. Max 10 MB.`);
      return null;
    }
    const { uploadURL, objectPath } = await requestUrl.mutateAsync({
      data: { name: file.name, size: file.size, contentType: file.type },
    });
    const put = await fetch(uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    return objectPath.replace(/^\/objects\//, "").replace(/^\/+/, "");
  }

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files).slice(0, remaining);
    if (arr.length === 0) {
      if (remaining === 0) toast.error(`You can upload up to ${max} photos.`);
      return;
    }
    setUploadingCount((n) => n + arr.length);
    try {
      const results = await Promise.allSettled(arr.map((f) => uploadOne(f)));
      const uploaded: string[] = [];
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) uploaded.push(r.value);
        if (r.status === "rejected") {
          toast.error(r.reason instanceof Error ? r.reason.message : "Upload failed");
        }
      }
      if (uploaded.length > 0) {
        // Append onto the latest parent value so concurrent remove/reorder
        // actions taken during the upload aren't clobbered.
        onChange([...latestValueRef.current, ...uploaded]);
        toast.success(`${uploaded.length} photo${uploaded.length === 1 ? "" : "s"} uploaded`);
      }
    } finally {
      setUploadingCount((n) => Math.max(0, n - arr.length));
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function makeCover(idx: number) {
    if (idx === 0) return;
    const next = [...value];
    const [picked] = next.splice(idx, 1);
    next.unshift(picked);
    onChange(next);
  }

  const uploading = uploadingCount > 0;

  return (
    <div className={cn("space-y-3", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFiles(e.target.files);
          }
        }}
      />

      {value.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            "w-full flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/30 hover:bg-muted/60 hover:border-primary/40 transition-colors py-10 text-sm text-muted-foreground",
            uploading && "opacity-60 cursor-wait",
          )}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <ImagePlus className="h-6 w-6 text-primary" />
          )}
          <span className="font-medium text-foreground">
            {uploading ? "Uploading…" : "Upload car photos"}
          </span>
          <span className="text-xs">
            Add up to {max} — exterior, interior, back, side. JPG, PNG, or WebP · up to 10 MB each.
          </span>
        </button>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {value.map((path, idx) => (
              <div
                key={`${path}-${idx}`}
                className={cn(
                  "group relative aspect-square rounded-md overflow-hidden border bg-muted",
                  idx === 0 && "ring-2 ring-primary",
                )}
              >
                <img
                  src={resolveImageUrl(path)}
                  alt={`Car photo ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="absolute top-1 right-1 inline-flex items-center justify-center h-6 w-6 rounded bg-black/55 hover:bg-black/75 text-white"
                  aria-label="Remove photo"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {idx === 0 ? (
                  <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                    <Star className="h-3 w-3" /> Cover
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => makeCover(idx)}
                    className="absolute bottom-1 left-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium bg-black/55 hover:bg-black/75 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Star className="h-3 w-3" /> Make cover
                  </button>
                )}
              </div>
            ))}

            {remaining > 0 && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
                className={cn(
                  "aspect-square rounded-md border-2 border-dashed border-border bg-muted/30 hover:bg-muted/60 hover:border-primary/40 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground",
                  uploading && "opacity-60 cursor-wait",
                )}
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : (
                  <ImagePlus className="h-5 w-5 text-primary" />
                )}
                <span className="font-medium text-foreground">
                  {uploading ? "Uploading" : "Add more"}
                </span>
                <span>{remaining} left</span>
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            The first photo is your cover. Tap any other photo to make it the cover.
          </p>
        </>
      )}
    </div>
  );
}
