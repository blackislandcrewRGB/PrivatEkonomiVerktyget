import { useEffect, useState } from "react";
import { getJson, sendJson } from "../../../api";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { CompactRow, Editable, Field } from "../compact";
import { pricesSummary } from "../summaries";
import { FIELD } from "../ui";
import type { SectionProps } from "./types";

/**
 * Priser: which month the index counts from. Both lines in Analys › Priser
 * stand at 100 in this month, so it decides what 'up' and 'down' mean there.
 * Empty is the twelve months back, which is the question most often asked.
 */
export function PricesSection({ open, onToggle, match }: SectionProps) {
  const [settings, setSettings] = useState<{ baseMonth: string | null } | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    getJson<{ settings: { baseMonth: string | null } }>("/analysis/prices").then(
      (r) => setSettings(r.settings),
      () => setSettings(null),
    );
  }, []);
  if (!settings) return null;
  const s = pricesSummary(settings.baseMonth, todayIso());
  if (!match("Priser", "startmånad", "KPI", s.summary, s.hint)) return null;
  return (
    <CompactRow id="priser" name="Priser" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
      <Editable
        description="Startmånad för indexeringen i Analys › Priser: både din matkostnad och KPI står i 100 där. Tom betyder 12 månader bakåt."
        onEdit={() => setDraft(settings.baseMonth ?? "")}
        onSave={async () => {
          setSettings(await sendJson<{ baseMonth: string | null }>("PUT", "/analysis/prices/settings", { baseMonth: draft.trim() === "" ? null : draft.trim() }));
        }}
        edit={
          <Field label="Startmånad (ÅÅÅÅ-MM, tom = 12 månader bakåt)" className="w-72">
            <input aria-label="Startmånad" type="month" className={cn(FIELD, "w-44")} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
        }
      >
        <p className="text-[13px]">
          Startmånad <span className="font-semibold tabular-nums">{s.summary.replace(/^Startmånad /, "")}</span>
        </p>
      </Editable>
    </CompactRow>
  );
}
