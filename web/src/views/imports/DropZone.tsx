import { forwardRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

const KINDS = ["Swedbank CSV", "Bank Norwegian-export (XLSX) och -faktura (PDF)", "Mastercard-faktura (PDF)", "Mastercard-sidan sparad som PDF", "hyresavier (PDF)", "deklarationskvittenser (PDF)"];

/**
 * Importer's drop zone: a white card with a dashed edge, blue while files are
 * dragged over it. A click anywhere on it or on 'Välj filer' opens the same
 * file picker (the input, passed in through the ref, is the view's: ⌘K's
 * 'Importera fil' clicks it too).
 */
export const DropZone = forwardRef<HTMLInputElement, { busy: boolean; fileCount: number; onFiles: (files: FileList) => void }>(function DropZone(
  { busy, fileCount, onFiles },
  inputRef,
) {
  const [dragging, setDragging] = useState(false);
  const pick = () => (inputRef as React.RefObject<HTMLInputElement | null>).current?.click();
  return (
    <div
      data-dragging={dragging || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(e.dataTransfer.files);
      }}
      onClick={pick}
      className={cn(
        "flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-3 rounded-card border-2 border-dashed px-5 py-5 transition-colors sm:px-7",
        dragging ? "border-accent bg-accent-soft" : "border-neutral-bar bg-card hover:border-ink-3",
      )}
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent" aria-hidden>
        {busy ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" strokeWidth={2.25} />}
      </span>
      <span className="min-w-0 flex-1 basis-60">
        <span className="block text-[15px] font-semibold text-ink">{busy ? `Läser ${fileCount > 1 ? `${fileCount} filer` : "filen"}…` : "Släpp filer här eller klicka"}</span>
        <span className="mt-0.5 block text-[12px] text-ink-2">{KINDS.join(" · ")}. Gärna flera på en gång.</span>
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          pick();
        }}
        disabled={busy}
        className="h-9 shrink-0 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-white outline-none hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Välj filer
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".csv,.pdf,.xlsx"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
});
