import { useRef, useState } from "react";
import { useRequestUploadUrl } from "@workspace/api-client-react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/format";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

type Props = {
  value: string;
  onChange: (objectPath: string) => void;
  className?: string;
  label?: string;
};

/**
 * Lightweight image uploader: requests a presigned URL from the API, PUTs
 * the file bytes directly to GCS, then stores the returned object path.
 * The same path can later be served via `/api/storage/objects/<path>`.
 */
export function ImageUploader({ value, onChange, className, label }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestUrl = useRequestUploadUrl();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string>("");

  const previewSrc = preview || resolveImageUrl(value);

  async function handleFile(file: File) {
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Please pick a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image too large. Max 10 MB.");
      return;
    }
    setUploading(true);
    try {
      const localPreview = URL.createObjectURL(file);
      setPreview(localPreview);

      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      const put = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);

      // Normalize to a path consumable by /api/storage/objects/*.
      const normalized = objectPath.replace(/^\/objects\//, "").replace(/^\/+/, "");
      onChange(normalized);
      toast.success("Photo uploaded");
    } catch (err) {
      setPreview("");
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function clear() {
    setPreview("");
    onChange("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {previewSrc ? (
        <div className="relative rounded-md overflow-hidden border bg-muted">
          <img
            src={previewSrc}
            alt="Car"
            className="w-full max-h-72 object-cover"
            onError={() => setPreview("")}
          />
          <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-xs font-medium text-white bg-black/40 hover:bg-black/60 px-2.5 py-1 rounded"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={uploading}
              className="inline-flex items-center justify-center h-6 w-6 rounded bg-black/40 hover:bg-black/60 text-white"
              aria-label="Remove photo"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            "w-full flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/30 hover:bg-muted/60 hover:border-primary/40 transition-colors py-8 text-sm text-muted-foreground",
            uploading && "opacity-60 cursor-wait",
          )}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <ImagePlus className="h-6 w-6 text-primary" />
          )}
          <span className="font-medium text-foreground">
            {uploading ? "Uploading…" : label || "Upload a photo"}
          </span>
          <span className="text-xs">JPG, PNG, or WebP · up to 10 MB</span>
        </button>
      )}
    </div>
  );
}
