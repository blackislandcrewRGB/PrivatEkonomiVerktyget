import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn";
import { SECTIONS, type SectionId } from "./sections";

/**
 * The sections down the left (Design v2), sticky while the page scrolls: the
 * one in view light blue, an orange badge where something waits, and the
 * ones the search doesn't match greyed out. A click scrolls to the section.
 */
export function SettingsNav({
  active,
  badges,
  matches,
  onGo,
}: {
  active: SectionId;
  badges: Partial<Record<SectionId, number>>;
  /** The sections the search matches; null without a search. */
  matches: Set<SectionId> | null;
  onGo: (id: SectionId) => void;
}) {
  return (
    <>
      <ChipNav active={active} badges={badges} matches={matches} onGo={onGo} />
    <nav aria-label="Avsnitt" className="sticky top-6 hidden self-start nav:block">
      <ul className="space-y-0.5">
        {SECTIONS.map((s) => {
          const on = s.id === active;
          const off = matches !== null && !matches.has(s.id);
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={on ? "location" : undefined}
                data-section-link={s.id}
                onClick={(e) => {
                  e.preventDefault();
                  onGo(s.id);
                }}
                className={cn(
                  "flex h-8 items-center justify-between gap-2 rounded-[8px] px-3 text-[13px] transition-colors",
                  on ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-card-inset",
                  off && "opacity-40",
                )}
              >
                <span className="truncate">{s.label}</span>
                {badges[s.id] ? (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-caution px-1 text-[10px] font-bold text-white tabular-nums" aria-label={`${badges[s.id]} väntar`}>
                    {badges[s.id]}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
    </>
  );
}

/**
 * On a phone or a tablet: the sections as a row of chips that scrolls
 * sideways, sticky at the top; the one in view is scrolled into sight.
 */
function ChipNav({ active, badges, matches, onGo }: Parameters<typeof SettingsNav>[0]) {
  const row = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (el && row.current) row.current.scrollTo?.({ left: el.offsetLeft - 16, behavior: "smooth" });
  }, [active]);
  return (
    <nav aria-label="Avsnitt" className="sticky top-0 z-10 -mx-4 bg-canvas/95 py-2 backdrop-blur nav:hidden">
      <ul ref={row} className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {SECTIONS.map((s) => {
          const on = s.id === active;
          const off = matches !== null && !matches.has(s.id);
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                data-chip={s.id}
                aria-current={on ? "location" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onGo(s.id);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium",
                  on ? "bg-accent-soft text-accent" : "bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
                  off && "opacity-40",
                )}
              >
                {s.label}
                {badges[s.id] ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-caution px-1 text-[10px] font-bold text-white tabular-nums">{badges[s.id]}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
