import { useState } from "react";
import { sendJson, type SharedMonth } from "../../api";
import { cn } from "../../lib/cn";
import type { Act } from "./SharedLists";
import { STATE_PILL, historyState } from "./status";
import { monthLabel } from "./summary";

/**
 * The last six months as small cards (the month, how it stands, which way
 * the money goes), the shown one ringed in blue; a click goes there. To the
 * right, the month the running balance counts from, with 'ändra' opening
 * the same month field as before.
 */
export function History({ data, act, onPick }: { data: SharedMonth; act: Act; onPick: (m: string) => void }) {
  const cards = data.history.length >= 2;
  return (
    <section aria-labelledby={cards ? "history-title" : undefined} className="flex flex-wrap items-center gap-x-4 gap-y-3">
      {cards && (
        <>
          <h2 id="history-title" className="text-[13px] font-semibold">
            Senaste avstämningarna
          </h2>
          <ol className="-mx-4 flex max-w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:max-w-full sm:flex-wrap sm:overflow-visible sm:px-0">
            {data.history.map((h) => {
              const current = h.month === data.month;
              const state = historyState(h);
              return (
                <li key={h.month} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onPick(h.month)}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "card-click min-w-40 rounded-inset bg-card px-3.5 py-2.5 text-left text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:bg-band",
                      current && "ring-2 ring-accent",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3 text-[11px] text-ink-2">
                      {monthLabel(h.month)}
                      <span data-state={state} className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold transition-colors duration-[180ms] ease-out", STATE_PILL[state].className)}>
                        {STATE_PILL[state].label}
                      </span>
                    </span>
                    <span className="mt-1 block text-sm font-bold tabular-nums">
                      {h.result === 0 ? "jämnt" : `${h.result > 0 ? "→ dig" : "→ " + data.partnerName} ${Math.round(Math.abs(h.result) / 100).toLocaleString("sv-SE")} kr`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
      <StartMonth data={data} act={act} />
    </section>
  );
}

/** 'Löpande saldo räknas från augusti 2026 · ändra': the month field shows on ändra and saves on change. */
function StartMonth({ data, act }: { data: SharedMonth; act: Act }) {
  const [editing, setEditing] = useState(false);
  return (
    <p className="ml-auto text-xs text-ink-2" title="Månader före det för inget vidare.">
      Löpande saldo räknas från{" "}
      {editing ? (
        <input
          type="month"
          autoFocus
          aria-label="Startmånad"
          value={data.startMonth}
          onChange={(e) => {
            if (!e.target.value) return;
            const month = e.target.value;
            act(() => sendJson("PUT", "/shared/start", { month })).then(() => setEditing(false));
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="h-7 rounded-lg border border-neutral-bar bg-card px-1.5 align-middle text-ink outline-none focus:border-accent"
        />
      ) : (
        <>
          <b className="font-semibold text-ink">{monthLabel(data.startMonth, true).toLowerCase()}</b> ·{" "}
          <button type="button" onClick={() => setEditing(true)} className="font-medium text-accent hover:underline">
            ändra
          </button>
        </>
      )}
    </p>
  );
}
