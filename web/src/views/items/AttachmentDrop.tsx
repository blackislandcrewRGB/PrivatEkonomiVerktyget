import { useEffect, useRef, useState } from "react";
import { FileText, ImagePlus } from "lucide-react";
import { attachmentFileError, uploadAttachment } from "../../api";
import { imageFromClipboard, typingInField } from "../../components/IconUpload";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";

/**
 * Drop a picture or a receipt onto a pryl: in the transaction's panel, and in
 * the pryl's own. The type and the size are checked here as well as on the
 * server, so a wrong file says so at once instead of after the upload.
 *
 * `acceptPaste` also takes ⌘V, which is how a product picture usually
 * arrives: copied from the shop's page rather than saved to a file first. It
 * is on in the pryl's own panel, where there is exactly one place the picture
 * could go, and off in the transaction's panel, where ⌘V already belongs to
 * the merchant's icon and a row can hold several prylar.
 */
export function AttachmentDrop({ itemId, onDone, acceptPaste = false }: { itemId: number; onDone: () => void; acceptPaste?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const take = async (file: File | null | undefined) => {
    if (!file || busy) return;
    const error = attachmentFileError(file);
    if (error) return void notify({ text: error });
    setBusy(true);
    try {
      const saved = await uploadAttachment(itemId, file);
      notify({ text: saved.kind === "receipt" ? "Kvittot är inlagt." : "Bilden är inlagd." });
      onDone();
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const takeRef = useRef(take);
  takeRef.current = take;
  useEffect(() => {
    if (!acceptPaste) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromClipboard(e);
      // Pasting into a field is text, not a picture.
      if (!file || typingInField()) return;
      e.preventDefault();
      void takeRef.current(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [acceptPaste]);

  return (
    <div
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
      className={cn(
        "mt-1.5 flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted",
        over && "border-ring bg-surface-hover",
        busy && "opacity-60",
      )}
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{acceptPaste ? "Dra hit eller klistra in (⌘V)" : "Dra hit kvitto eller bild"}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 hover:bg-surface-hover"
      >
        <ImagePlus className="size-3.5" /> Välj fil
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif"
        aria-label="Välj kvitto eller bild"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
