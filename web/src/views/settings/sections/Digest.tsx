import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { getJson, sendJson, type Digest } from "../../../api";
import { notify } from "../../../components/Toast";
import { CompactRow } from "../compact";
import { digestSummary } from "../summaries";
import { BUTTON } from "../ui";
import type { SectionProps } from "./types";

/** Veckodigest: sent Sundays 19:00; 'Skicka nu' to try it. */
export function DigestSection({ open, onToggle, match }: SectionProps) {
  const [d, setD] = useState<Digest | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getJson<Digest>("/digest").then(setD, () => setD(null));
  }, []);
  if (!d) return null;
  const s = digestSummary(d);
  if (!match("Veckodigest", "ntfy", s.summary, s.hint)) return null;
  const send = async () => {
    setBusy(true);
    try {
      const r = await sendJson<{ sentAt: string }>("POST", "/digest/send", {});
      setD({ ...d, sentAt: r.sentAt });
      notify({ text: "Veckodigesten är skickad." });
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <CompactRow id="veckodigest" name="Veckodigest" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1 text-[13px]">
          <p className="text-[12px] text-ink-2">Söndagar 19:00 skickas veckan som gick som en ntfy-notis (samma text som i Översikten).</p>
          <p>
            {d.canSend
              ? d.sentAt
                ? `Senast skickad ${new Date(d.sentAt).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`
                : "Inte skickad än."
              : "Ingen ntfy-topic: sätt NTFY_TOPIC i .env (bara den riktiga instansen skickar)."}
          </p>
        </div>
        <button type="button" className={BUTTON.grey} onClick={send} disabled={busy || !d.canSend}>
          <Send className="size-3.5" aria-hidden /> Skicka nu
        </button>
      </div>
    </CompactRow>
  );
}
