import { useEffect, useState } from "react";
import { getJson, sendJson, type ItemWatchSettings } from "../../../api";
import { useCategories } from "../../../categories";
import { notify } from "../../../components/Toast";
import { cn } from "../../../lib/cn";
import { CompactRow, Field } from "../compact";
import { itemsSummary } from "../summaries";
import { FIELD } from "../ui";
import type { SectionProps } from "./types";

/**
 * Prylar: which purchases Vakt should ask about ('är det en pryl?'). The
 * categories are the ones under 'Prylar & hem' and any other subcategory
 * already chosen; the threshold keeps small buys out of Att göra. Each change
 * is saved at once.
 */
export function ItemsSection({ open, onToggle, match }: SectionProps) {
  const categories = useCategories();
  const [data, setData] = useState<ItemWatchSettings | null>(null);
  const [amount, setAmount] = useState("");
  useEffect(() => {
    getJson<ItemWatchSettings>("/items/settings").then((d) => {
      setData(d);
      setAmount(String(Math.round(d.minAmount / 100)));
    }, () => setData(null));
  }, []);
  if (!data) return null;
  const s = itemsSummary(data, categories);
  if (!match("Prylar", s.summary, s.hint)) return null;

  const save = (patch: Partial<ItemWatchSettings>) =>
    sendJson<ItemWatchSettings>("PUT", "/items/settings", patch).then(setData, (e) => notify({ text: (e as Error).message }));
  const parents = categories.filter((c) => c.parentId === null && !c.isTransfer && !c.isSettlement);
  // 'Prylar & hem' and everything under it — a row is sometimes categorised to
  // the main category itself — plus anything else that has been picked, so a
  // choice is never stored where it can't be seen or taken back.
  const home = parents.find((c) => c.name === "Prylar & hem");
  const shown = categories.filter((c) => c.id === home?.id || c.parentId === home?.id || data.categoryIds.includes(c.id));
  const pathOf = (c: { parentId: number | null; name: string }) => (c.parentId === null ? c.name : `${parents.find((p) => p.id === c.parentId)?.name ?? "?"} › ${c.name}`);
  const toggle = (id: number, on: boolean) => save({ categoryIds: on ? [...data.categoryIds, id] : data.categoryIds.filter((x) => x !== id) });

  return (
    <CompactRow id="prylar" name="Prylar" summary={s.summary} hint={s.hint} open={open} onToggle={onToggle}>
      <div className="space-y-3">
        <p className="text-[12px] leading-snug text-ink-2">
          Ett köp i någon av de här kategorierna, över beloppet, som inte hör till någon pryl blir en fråga i Att göra: "är det en pryl?". Svarar du nej kommer just det köpet aldrig
          tillbaka.
        </p>
        <ul className="grid gap-x-6 gap-y-1.5 text-[13px] @[40rem]:grid-cols-2">
          {shown.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={data.categoryIds.includes(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />
                <span>{pathOf(c)}</span>
              </label>
            </li>
          ))}
        </ul>
        <Field label={`Fråga från och med (standard ${Math.round(data.defaultMinAmount / 100)} kr)`} className="w-56">
          <span className="relative block">
            <input
              aria-label="Tröskelbelopp i kronor"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              onBlur={() => {
                const kronor = Number(amount);
                if (!Number.isFinite(kronor) || amount === "") return setAmount(String(Math.round(data.minAmount / 100)));
                if (kronor * 100 !== data.minAmount) void save({ minAmount: kronor * 100 });
              }}
              className={cn(FIELD, "pr-8 text-right tabular-nums")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[12px] text-ink-3">kr</span>
          </span>
        </Field>
        {data.categoryIds.length === 0 && <p className="text-[11px] text-ink-3">Ingen kategori vald: inga köp föreslås som prylar.</p>}
      </div>
    </CompactRow>
  );
}
