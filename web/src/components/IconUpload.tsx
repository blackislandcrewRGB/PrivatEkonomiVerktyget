import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImagePlus } from "lucide-react";
import { cn } from "../lib/cn";
import { notify } from "./Toast";

export const ICON_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const MAX_ICON_BYTES = 200 * 1024;

/** Why a file can't be an icon, or null. The server checks the bytes again. */
export function iconFileError(file: File): string | null {
  if (!ICON_TYPES.includes(file.type)) return "Bara PNG, JPG, WebP eller SVG går.";
  if (file.size > MAX_ICON_BYTES) return `Bilden är ${Math.ceil(file.size / 1024)} kB, högst 200 kB går.`;
  return null;
}

/** The picture in a paste (⌘V), if there is one. */
export function imageFromClipboard(e: ClipboardEvent): File | null {
  const files = [...(e.clipboardData?.files ?? [])];
  return files.find((f) => f.type.startsWith("image/")) ?? null;
}

/** Is the user typing somewhere (a paste there is text, not an icon)? */
export const typingInField = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

/**
 * A merchant's picture: the current icon, a file picker, drag-and-drop onto
 * the box, and ⌘V with a picture on the clipboard while it is shown. 'Ta
 * bort ikon' when there is one of its own. Checks type and size before
 * sending; `onFile` does the upload (and may ask where it should go).
 */
export function IconUpload({
  preview,
  hasOwn,
  onFile,
  onRemove,
  removeLabel = "Ta bort ikon",
  children,
}: {
  preview: ReactNode;
  hasOwn: boolean;
  onFile: (file: File) => Promise<void>;
  onRemove?: () => Promise<void>;
  removeLabel?: string;
  /** A line under the box (where the picture applies). */
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef(onFile);
  latest.current = onFile;

  const take = async (file: File | null | undefined) => {
    if (!file || busy) return;
    const error = iconFileError(file);
    if (error) return void notify({ text: error });
    setBusy(true);
    try {
      await latest.current(file);
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const takeRef = useRef(take);
  takeRef.current = take;

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromClipboard(e);
      if (!file || typingInField()) return;
      e.preventDefault();
      void takeRef.current(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="space-y-1.5">
      <div
        data-icon-drop=""
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files[0]);
        }}
        className={cn("flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2", over && "border-ring bg-surface-hover", busy && "opacity-60")}
      >
        {preview}
        <div className="min-w-0 flex-1 text-xs text-muted">
          Dra hit en bild eller klistra in (⌘V)
          <span className="block text-subtle">PNG, JPG, WebP eller SVG, högst 200 kB</span>
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-hover"
        >
          <ImagePlus className="size-3.5" /> Välj bild
        </button>
        <input
          ref={input}
          type="file"
          accept={ICON_TYPES.join(",")}
          aria-label="Välj bild"
          className="hidden"
          onChange={(e) => {
            void take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
        {children}
        {hasOwn && onRemove && (
          <button type="button" onClick={() => void onRemove().catch((e) => notify({ text: (e as Error).message }))} className="text-link hover:underline">
            {removeLabel}
          </button>
        )}
      </div>
    </div>
  );
}
