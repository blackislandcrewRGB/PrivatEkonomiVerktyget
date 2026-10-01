import { memo } from "react";
import { ChevronDown, Lightbulb, TrendingUp, Users } from "lucide-react";
import type { Account, RecurringExpense } from "../../api";
import { CategoryChip } from "../../components/CategoryChip";
import { MerchantIcon } from "../../components/MerchantIcon";
import { motion, type MotionProps } from "motion/react";
import { useEntrance, useListEntrance } from "../../lib/motion";
import { StatusPill } from "../../components/StatusPill";
import { cn } from "../../lib/cn";
import { useNarrow } from "../../lib/useNarrow";
import { useWidth } from "../../lib/useWidth";
import { dm, kr } from "../overview/format";
import type { Share } from "../../lib/share";
import { dayText, groupColour, monthly, partOf, YEARLY_GROUP, type ExpenseGroup } from "./model";
import { leftThisMonth } from "./hero/thisMonth";

/** '20/6', with the year when it isn't this year ('20/6 2027': a yearly one's next draw). */
const dmy = (iso: string) => (iso.slice(0, 4) === String(new Date().getFullYear()) ? dm(iso) : `${dm(iso)} ${iso.slice(0, 4)}`);

/** Half of 7 501 kr is 3 750,50: shown as whole kronor like the rest. */
const wholeKr = (ore: number) => Math.round(ore / 100) * 100;


/**
 * One running number per row across the groups, so a staggered entrance reads
 * as one list rather than restarting in every group. Folded groups count as
 * nothing.
 */
function rowIndexer(groups: ExpenseGroup[], collapsed: string[]) {
  const start = new Map<string, number>();
  let n = 0;
  for (const g of groups) {
    start.set(g.key, n);
    if (!collapsed.includes(g.key)) n += g.items.length;
  }
  return (key: string, i: number) => (start.get(key) ?? 0) + i;
}

/** What the table is showing: a different 'vems' or other groups lets it come in again. */
const listKey = (groups: ExpenseGroup[], share: Share) => `${share}|${groups.map((g) => g.key).join(",")}`;

/** Logo, name and tags, amount, day, category, status, last drawn. */
const COLUMNS = "grid-cols-[32px_minmax(0,1fr)_100px_136px_minmax(0,160px)_104px_96px]";
/** On a phone: logo, name with amount, day and category under it, status with the last draw under it. */
const COMPACT_COLUMNS = "grid-cols-[32px_minmax(0,1fr)_auto]";
const COMPACT_PX = 760;

/**
 * The expenses as a card per group (an account, then Årsvis), each with its
 * subtotals in the header and folding from it. Click or Enter opens the panel
 * with every field. 'Min del' shows shared expenses at half.
 */
export function ExpenseTable({
  groups,
  share = "household",
  activeId,
  collapsed,
  onToggleGroup,
  onOpen,
}: {
  groups: ExpenseGroup[];
  share?: Share;
  accounts?: Account[];
  activeId: number | null;
  collapsed: string[];
  onToggleGroup: (key: string) => void;
  onOpen: (id: number) => void;
}) {
  const narrow = useNarrow();
  // The list's own width decides (a phone, a tablet, the panel open beside it): under 760 px each row is a small card.
  const [measure, width] = useWidth(1000);
  const compact = narrow || width < COMPACT_PX;
  const entrance = useListEntrance(listKey(groups, share));
  const rowIndex = rowIndexer(groups, collapsed);
  return (
    <div ref={measure} className="space-y-4" role="grid" aria-label="Fasta utgifter">
      {groups.map((g) => {
        const open = !collapsed.includes(g.key);
        return (
          <section key={g.key} data-group={g.key} className="overflow-hidden rounded-card bg-card text-ink shadow-card">
            <GroupHeader g={g} share={share} open={open} compact={compact} onToggle={() => onToggleGroup(g.key)} />
            {open && (
              <div role="rowgroup">
                {g.items.map((e, i) => (
                  <Row key={e.id} e={e} share={share} compact={compact} active={e.id === activeId} onOpen={onOpen} entrance={entrance} index={rowIndex(g.key, i)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * A group's header: its colour, name and count; what is left to draw this
 * month and the next date, the yearly ones' sum a year, and what it comes to
 * a month; a chevron. The whole band folds the group.
 */
function GroupHeader({ g, share, open, compact, onToggle }: { g: ExpenseGroup; share: Share; open: boolean; compact: boolean; onToggle: () => void }) {
  const active = g.items.filter((e) => !e.paused);
  const left = active.filter(leftThisMonth).reduce((s, e) => s + partOf(e, e.thisMonth!.amount, share), 0);
  const next = active.map((e) => e.nextDate).filter(Boolean).sort()[0];
  const parts = [
    left > 0 && `kvar denna månad ${kr(left)}`,
    next && `nästa ${dmy(next)}`,
    g.key === YEARLY_GROUP && `${kr(active.reduce((s, e) => s + partOf(e, e.amount, share), 0))}/år`,
  ].filter(Boolean);
  const detail = parts.length > 0 && <span className={cn("text-xs text-ink-2 tabular-nums", compact ? "mt-0.5 block pl-5" : "shrink-0")}>{parts.join(" · ")}</span>;
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="block w-full bg-band px-5 py-3 text-left hover:bg-card-inset sm:px-6">
      <span className="flex items-center gap-2.5">
        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px] dark:ring-1 dark:ring-white/25", groupColour(g))} data-group-colour />
        <span className="min-w-0 truncate text-sm font-semibold">{g.name}</span>
        <span className="shrink-0 text-xs text-ink-3">{g.items.length} st</span>
        <span className="flex-1" />
        {!compact && detail}
        <span className="shrink-0 text-sm font-bold tabular-nums" title={g.key === YEARLY_GROUP ? "Årsbeloppen delade på 12: att lägga undan varje månad" : undefined}>
          {kr(active.reduce((s, e) => s + partOf(e, monthly(e), share), 0))}/mån
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </span>
      {compact && detail}
    </button>
  );
}

const Row = memo(function Row({
  e,
  share,
  compact,
  active,
  onOpen,
  entrance,
  index,
}: {
  e: RecurringExpense;
  share: Share;
  compact: boolean;
  active: boolean;
  onOpen: (id: number) => void;
  entrance: (index: number) => Partial<MotionProps>;
  index: number;
}) {
  const entering = useEntrance(entrance, index);
  const full = e.variesByMonth ? e.thisMonthAmount : e.amount;
  const halved = partOf(e, full, share) !== full;
  const yearly = e.billingCycle === "yearly";
  const under = [halved && `halva av ${kr(full)}`, yearly && "per år"].filter(Boolean).join(" · ");
  const status = e.thisMonth ?? e.thisYear ?? null;
  const amount = (
    <span
      className={cn("inline-flex items-center justify-end gap-1 font-bold tabular-nums", e.amountChanged && "text-caution-text")}
      title={
        e.amountChanged && e.latestCharge
          ? `Senast dragen ${kr(Math.abs(e.latestCharge.amount))}, utgiften säger ${kr(e.latestExpected)}`
          : e.variesByMonth
            ? `Standardbelopp ${kr(e.amount)}; den här månaden ${kr(e.thisMonthAmount)}`
            : undefined
      }
    >
      {e.amountChanged && <TrendingUp className="size-3.5" aria-label="Beloppet har ändrats" />}
      {kr(wholeKr(partOf(e, full, share)))}
    </span>
  );
  const day = (
    <span className="whitespace-nowrap" title={e.scheduleText}>
      <b className="font-semibold tabular-nums">{dayText(e)}</b>
      {e.nextDate && !e.paused && <span className="ml-1.5 text-[11px] text-ink-3">nästa {dmy(e.nextDate)}</span>}
    </span>
  );
  const category = (
    <span className="flex min-w-0 items-center gap-1">
      <CategoryChip categoryId={e.categoryId} short className={cn("-ml-2 min-w-0", compact && "py-0 text-[11px] leading-4")} />
      {e.shared && <Users className="size-3.5 shrink-0 text-ink-3" aria-label="Delad" />}
    </span>
  );
  const pill = status ? (
    <StatusPill
      status={status.status}
      suffix={yearly ? "i år" : undefined}
      title={yearly && e.thisYear ? `${e.thisYear.status === "dragen" ? "Dragen" : "Väntas"} ${dm(e.thisYear.transaction?.bookingDate ?? e.thisYear.dueDate)}` : undefined}
    />
  ) : (
    <span className="text-ink-3">–</span>
  );
  const latest = e.latestCharge ? (
    <>
      {dm(e.latestCharge.bookingDate)} · {kr(Math.abs(e.latestCharge.amount))}
    </>
  ) : e.matchPattern ? (
    "ingen träff"
  ) : (
    <span title="Ingen text att matcha mot">–</span>
  );
  return (
    <motion.div
      // The yearly group is sorted by the next date, so marking one paid moves
      // the row: it slides instead of jumping.
      layout="position"
      {...entering}
      role="row"
      id={`expense-${e.id}`}
      data-expense={e.id}
      aria-selected={active}
      onClick={() => onOpen(e.id)}
      className={cn(
        "grid min-h-[52px] cursor-pointer items-center gap-x-3 border-t border-hairline px-5 py-2 text-[13px] transition-colors hover:bg-band sm:px-6",
        compact ? COMPACT_COLUMNS : COLUMNS,
        active && "bg-band shadow-[inset_2px_0_0_var(--v2-accent)]",
      )}
    >
      <MerchantIcon decorative label={e.name} icon={e.icon} size={32} shape="square" />
      <div role="cell" className="min-w-0">
        <div className={cn("flex min-w-0 items-center gap-1.5", compact ? "flex-wrap gap-y-0.5" : "overflow-hidden")}>
          {/* Keeps more of itself than a tag does when the row is tight: the name is what the row is about. */}
          <span className={cn("min-w-0 shrink-[0.25] truncate font-medium", e.paused ? "text-ink-3" : "text-ink")} title={e.name}>
            {e.name}
          </span>
          <Tags e={e} />
        </div>
        {compact && (
          // A phone: the amount and the day on a line under the name, the category under them.
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-2">
              {amount}
              {under && <span className="text-[10px] text-ink-3">{under}</span>}
              <span aria-hidden className="text-ink-3">·</span>
              {day}
            </div>
            {category}
          </>
        )}
      </div>
      {compact ? (
        // Status and the last draw in one column.
        <div role="cell" className="flex flex-col items-end gap-0.5 text-right">
          {pill}
          <span className="whitespace-nowrap text-[10px] text-ink-3 tabular-nums">{latest}</span>
        </div>
      ) : (
        <>
          <div role="cell" className="text-right">
            {amount}
            {under && <span className="block whitespace-nowrap text-[10px] leading-3 text-ink-3">{under}</span>}
          </div>
          <div role="cell">{day}</div>
          <div role="cell" className="min-w-0">
            {category}
          </div>
          <div role="cell">{pill}</div>
          <div role="cell" className="whitespace-nowrap text-right text-[11px] text-ink-3 tabular-nums">
            {latest}
          </div>
        </>
      )}
    </motion.div>
  );
});

/** The row's tags as pills: part of another's draw or with parts (blue), paused and bound (grey), the schedule tip, off schedule (orange). */
function Tags({ e }: { e: RecurringExpense }) {
  return (
    <>
      {e.partOfName && <Pill tone="blue" title={`Ingen egen dragning: dras tillsammans med ${e.partOfName}`}>i {e.partOfName}s dragning</Pill>}
      {e.partNames.length > 0 && <Pill tone="blue" title={`Dragningen gäller också ${e.partNames.join(" och ")}`}>+ {e.partNames.join(", ")}</Pill>}
      {e.paused && <Pill>pausad</Pill>}
      {e.boundUntil && <Pill title={`Bunden t.o.m. ${e.boundUntil}`}>bunden</Pill>}
      {e.suggestion && (
        <span title={`Föreslaget schema: ${e.suggestion.text}`} className="shrink-0 text-transfer">
          <Lightbulb className="size-3.5" aria-label="Schemaförslag" />
        </span>
      )}
      {e.offSchedule > 0 && (
        <Pill tone="orange" title="Kopplade dragningar mer än 2 dagar från schemats dag (kopplade ändå, inom 5)">
          {e.offSchedule} avvek
        </Pill>
      )}
    </>
  );
}

function Pill({ children, tone, title }: { children: React.ReactNode; tone?: "orange" | "blue"; title?: string }) {
  return (
    <span
      title={title}
      data-pill={tone ?? "grey"}
      className={cn(
        "min-w-7 truncate whitespace-nowrap rounded-full px-1.5 text-[10px] font-medium leading-4",
        tone === "orange" ? "bg-caution-soft text-caution-text" : tone === "blue" ? "bg-accent-soft text-accent" : "bg-card-inset text-ink-2",
      )}
    >
      {children}
    </span>
  );
}
