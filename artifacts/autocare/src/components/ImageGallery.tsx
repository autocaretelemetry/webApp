import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveImageUrl } from "@/lib/format";

type Props = {
  images: string[];
  alt: string;
  className?: string;
};

/**
 * Photo gallery for car detail pages. Shows a large hero image with a
 * thumbnail strip below. Clicking the hero opens a fullscreen lightbox
 * with keyboard arrow navigation.
 */
export function ImageGallery({ images, alt, className }: Props) {
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const safe = images.length > 0 ? images : [];
  const current = safe[Math.min(idx, safe.length - 1)] ?? "";

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % safe.length);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + safe.length) % safe.length);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, safe.length]);

  if (safe.length === 0) return null;

  const next = () => setIdx((i) => (i + 1) % safe.length);
  const prev = () => setIdx((i) => (i - 1 + safe.length) % safe.length);

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full aspect-video bg-muted overflow-hidden relative group"
        aria-label="Open photo gallery"
      >
        <img
          src={resolveImageUrl(current)}
          alt={alt}
          className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]"
        />
        {safe.length > 1 && (
          <span className="absolute bottom-2 right-2 text-xs font-medium bg-black/55 text-white px-2 py-0.5 rounded">
            {idx + 1} / {safe.length}
          </span>
        )}
      </button>

      {safe.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 px-2">
          {safe.map((src, i) => (
            <button
              key={`${src}-${i}`}
              type="button"
              onClick={() => setIdx(i)}
              className={cn(
                "h-16 w-24 flex-shrink-0 rounded-md overflow-hidden border-2 transition-colors",
                i === idx ? "border-primary" : "border-transparent hover:border-border",
              )}
              aria-label={`View photo ${i + 1}`}
            >
              <img src={resolveImageUrl(src)} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="absolute top-4 right-4 inline-flex items-center justify-center h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          {safe.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  prev();
                }}
                className="absolute left-4 inline-flex items-center justify-center h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
                aria-label="Previous photo"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  next();
                }}
                className="absolute right-4 inline-flex items-center justify-center h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white"
                aria-label="Next photo"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <img
            src={resolveImageUrl(current)}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
          {safe.length > 1 && (
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs font-medium bg-white/10 text-white px-2 py-1 rounded">
              {idx + 1} / {safe.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
