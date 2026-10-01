import { memo, type MouseEvent, type ReactNode } from "react";
import { ArrowLeftRight, ArrowRight, EyeOff, Package, ReceiptText, Repeat, Undo2, User, Users } from "lucide-react";
import type { LabelRuleSuggestion, RuleSuggestion, Transaction } from "../../api";
import { cn } from "../../lib/cn";
import { formatKr } from "../../lib/format";
import { shortAccountName } from "../../components/AccountBadge";
import { CategoryChip, SplitBadge } from "../../components/CategoryChip";
import { MerchantIcon } from "../../components/MerchantIcon";
import { Tooltip } from "../../components/ui/tooltip";
import { KeyHint } from "../../components/KeyHint";
import { NoteInput, TextEdit } from "./editors";
import { canShare } from "./useTxActions";

export type InlineField = "note" | "label";

export interface RowProps {
  row: Transaction;
  /** The other leg of a transfer shown as one row. */
  pair?: Transaction;
  accountName: (id: number | null) => string | null;
  accountKind: (id: number | null) => "bank" | "credit_card" | null;
  partnerName: string;
  active: boolean;
  selected: boolean;
  /** The list is under about 600 px: the phone's line under the name is rendered (it shows under 560 px). */
  compact?: boolean;
  /** Private and hidden: shown as a grey 'Privat' line only. */
  masked: boolean;
  editing: InlineField | null;
  rulePrompt: { suggestion: RuleSuggestion; categoryLabel: string } | null;
  /** After renaming: give new imports with this text the same name? */
  labelPrompt?: LabelRuleSuggestion | null;
  onActivate: (id: number, open: boolean) => void;
  onToggleSelect: (id: number, range: boolean) => void;
  onOpenPicker: (id: number, anchor: HTMLElement) => void;
  onToggleShared: (id: number) => void;
  onTogglePrivate: (id: number) => void;
  onOpenRecurring: (id: number) => void;
  onEditDone: (id: number, field: InlineField, value: string | null) => void;
  onRule: (accept: boolean) => void;
}

const stop = (e: MouseEvent) => e.stopPropagation();

/**
 * Logo, name, category, account, icons, amount. Under 860 px of list the
 * account moves under the name; under 560 px (a phone) the category and the
 * icons join it there.
 */
export const ROW_COLUMNS =
  "grid-cols-[36px_minmax(0,1fr)_minmax(0,200px)_minmax(0,120px)_72px_128px] @max-[860px]:grid-cols-[36px_minmax(0,1fr)_minmax(0,180px)_72px_120px] @max-[560px]:grid-cols-[36px_minmax(0,1fr)_auto]";

/**
 * One transaction in Design v2's six columns: the merchant's logo (a box to
 * select the row over it on hover, and a dot on it while the row has no
 * category), the name in medium with the note as a small chip and the tags
 * after it, the place or contact under it; the category with its colour dot;
 * the account; shared / private / fixed-expense / returned icons; the amount,
 * incomes in green, returned purchases and their refunds struck through.
 * Clicking opens the panel.
 */
export const TxRow = memo(function TxRow(p: RowProps) {
  const { row: r } = p;
  if (p.masked) {
    return (
      <div data-row-id={r.id} className={cn("grid min-h-14 items-center gap-x-3 px-4 text-sm text-ink-3 sm:px-6", ROW_COLUMNS)}>
        <span className="grid size-9 place-items-center rounded-[10px] bg-card-inset">
          <EyeOff className="size-4" aria-hidden />
        </span>
        <span>Privat</span>
      </div>
    );
  }

  const inReturn = r.returnGroupId !== null;
  const muted = r.isTransfer || r.isSettlement || inReturn;
  const unreviewed = r.categoryId === null && !r.isTransfer;
  const manual = r.source === "manual";
  const title = r.label ?? r.descriptionClean;
  // A renamed row shows only its new name; the bank's text is in the tooltip and the panel.
  const meta = [r.counterpartyName, r.merchantArea].filter(Boolean);

  const badges: ReactNode[] = [];
  if (manual && r.paidBy !== "partner") badges.push(<Badge key="m">manuell</Badge>);
  if (r.paidBy === "partner") badges.push(<Badge key="p" tone="purple">{p.partnerName} betalade</Badge>);
  if (r.isSettlement) badges.push(<Badge key="s" tone="purple">avstämning{r.settlementExcluded ? " · räknas inte" : ""}</Badge>);
  if (inReturn) badges.push(r.returnGroupId === r.id ? <Badge key="r">returnerad</Badge> : <Badge key="r" tone="green">återbetalning</Badge>);
  if (r.occurrenceIndex > 1) badges.push(<Badge key="o">#{r.occurrenceIndex}</Badge>);
  if (r.isTransfer && !p.pair) {
    const other = p.accountName(r.counterAccountId);
    badges.push(<Badge key="t" tone="transfer">överföring{other ? ` ${r.amount < 0 ? "till" : "från"} ${other}` : ""}</Badge>);
  }

  const from = p.pair ? (r.amount < 0 ? r : p.pair) : null;
  const to = p.pair ? (r.amount < 0 ? p.pair : r) : null;
  const amount = from ? Math.abs(from.amount) : r.amount;
  const account = p.accountName(r.accountId);

  return (
    <div
      data-row-id={r.id}
      data-active={p.active || undefined}
      role="row"
      aria-selected={p.selected}
      onClick={() => p.onActivate(r.id, true)}
      className={cn(
        "group relative cursor-default px-4 text-sm transition-colors sm:px-6",
        p.selected ? "bg-accent-soft/70" : p.active ? "bg-band" : "hover:bg-band",
        p.active && "shadow-[inset_2px_0_0_var(--v2-accent)]",
      )}
    >
      <div className={cn("grid min-h-14 items-center gap-x-3 py-2.5", ROW_COLUMNS)}>
        {/* The logo; on hover (or when selected) the box to select the row over it. */}
        <span className="relative grid size-9 place-items-center" onClick={stop}>
          {from ? (
            <span className={cn("grid size-9 place-items-center rounded-[10px] bg-card-inset text-ink-2", p.selected ? "opacity-25" : "group-hover:opacity-25")}>
              <ArrowLeftRight className="size-4" aria-hidden />
            </span>
          ) : (
            <MerchantIcon
              decorative
              label={r.label}
              contact={r.counterpartyName}
              text={r.descriptionClean}
              icon={r.icon}
              size={36}
              shape="square"
              className={cn("transition-opacity", p.selected ? "opacity-25" : "group-hover:opacity-25")}
            />
          )}
          <input
            type="checkbox"
            aria-label="Markera raden"
            checked={p.selected}
            onChange={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              p.onToggleSelect(r.id, e.shiftKey);
            }}
            className={cn("absolute inset-0 m-auto size-4 accent-[var(--v2-accent)]", !p.selected && "opacity-0 group-hover:opacity-100 focus:opacity-100")}
          />
          {unreviewed && !p.selected && (
            <span aria-label="Okategoriserad" className="pointer-events-none absolute -left-1 -top-1 size-2.5 rounded-full bg-unreviewed ring-2 ring-card group-hover:opacity-0" />
          )}
        </span>

        <div className="min-w-0">
          {p.editing === "label" ? (
            <div onClick={stop}>
              <TextEdit
                value={r.label ?? (manual ? r.descriptionClean : "")}
                placeholder={r.descriptionClean}
                onDone={(v) => p.onEditDone(r.id, "label", v)}
              />
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              {from && to ? (
                <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-ink-2">
                  {p.accountName(from.accountId) ?? "?"} <ArrowRight className="size-3.5 shrink-0" /> {p.accountName(to.accountId) ?? "?"}
                </span>
              ) : (
                <span className={cn("min-w-12 truncate font-medium", muted ? "text-ink-3" : "text-ink")} title={r.label ? `Bankens text: ${r.descriptionClean}` : undefined}>
                  {title}
                </span>
              )}
              {/* The note says what the purchase was: a small chip right after the name; it gives way before the name does. */}
              {r.note && p.editing !== "note" && (
                <span className="min-w-10 shrink-[4] truncate rounded-[6px] bg-card-inset px-1.5 text-[11px] font-semibold leading-[18px] text-ink" title="Anteckning">
                  <span className="sr-only">Anteckning: </span>
                  {r.note}
                </span>
              )}
              {badges.length > 0 && <span className="flex shrink-0 gap-1 @max-[560px]:hidden">{badges}</span>}
            </div>
          )}
          {p.editing === "note" ? (
            <div className="mt-1 max-w-md" onClick={stop}>
              <NoteInput value={r.note ?? ""} rowId={r.id} placeholder="Anteckning" onDone={(v) => p.onEditDone(r.id, "note", v)} />
            </div>
          ) : (
            <>
              {/* Under the name: the place or contact; on a narrower list the account too. */}
              {!from && (meta.length > 0 || account) && (
                <p className={cn("truncate text-[11px] leading-4 text-ink-3 @max-[560px]:hidden", !meta.length && "hidden @max-[860px]:block")}>
                  {meta.join(" · ")}
                  {account && (
                    <span className="hidden @max-[860px]:inline">
                      {meta.length > 0 && " · "}
                      {shortAccountName(account)}
                    </span>
                  )}
                </p>
              )}
              {/* A phone: the tags, the category (tap to change), the account, the place and the icons on one line under the name.
                  Only put there when the list is about that narrow, so a wide list has each once; the container query decides if it shows. */}
              {p.compact && (
                <div className="mt-0.5 hidden min-w-0 items-center gap-1.5 text-[11px] leading-4 text-ink-3 @max-[560px]:flex" onClick={stop}>
                  {badges.length > 0 && <span className="flex shrink-0 gap-1">{badges}</span>}
                  {from ? (
                    <span className="shrink-0">Överföring</span>
                  ) : (
                    <CategoryChip categoryId={r.categoryId} short onClick={(e) => p.onOpenPicker(r.id, e.currentTarget)} className="-ml-2 min-w-0 shrink py-0 text-[11px] leading-4" />
                  )}
                  {r.splits && <SplitBadge splits={r.splits} className="leading-4" />}
                  <span className="min-w-0 truncate">{[account && shortAccountName(account), ...(from ? [] : meta)].filter(Boolean).join(" · ")}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <RowIcons {...p} inReturn={inReturn} from={from} />
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="min-w-0 @max-[560px]:hidden" onClick={stop}>
          {from ? (
            <span className="text-[13px] text-ink-2">Överföring</span>
          ) : (
            <span className="flex min-w-0 items-center gap-1">
              <CategoryChip
                data-category-chip=""
                categoryId={r.categoryId}
                title={
                  r.splits
                    ? "Uppdelat köp · C ger hela köpet en kategori"
                    : r.categorySource === "manual"
                      ? "Satt för hand · C för att ändra"
                      : r.categorySource === "rule"
                        ? "Satt av regel · C för att ändra"
                        : r.categorySource === "merchant_category"
                          ? "Från Norwegians handlarkategori · C för att ändra"
                          : "C för att välja"
                }
                onClick={(e) => p.onOpenPicker(r.id, e.currentTarget)}
                className="-ml-2"
              />
              {r.splits && <SplitBadge splits={r.splits} />}
            </span>
          )}
        </div>

        <div className="min-w-0 truncate text-[11px] text-ink-2 @max-[860px]:hidden" title={account ?? undefined}>
          {account ? shortAccountName(account) : "–"}
        </div>

        <div className="flex items-center gap-1.5 text-ink-3 @max-[560px]:hidden" onClick={stop}>
          <RowIcons {...p} inReturn={inReturn} from={from} />
        </div>

        <span
          className={cn(
            "whitespace-nowrap text-right text-sm font-bold tabular-nums",
            r.isTransfer || from ? "text-ink-2" : amount > 0 ? "text-positive-text" : inReturn ? "text-ink-3" : "text-ink",
            inReturn && "line-through",
          )}
        >
          {formatKr(amount, { sign: amount > 0 && !from && !r.isTransfer ? "always" : "auto" })}
        </span>
      </div>

      {p.labelPrompt && (
        <div
          onClick={stop}
          className="mb-2.5 ml-12 flex flex-wrap items-center gap-2 rounded-[10px] bg-card-inset px-3 py-1.5 text-[13px] animate-[slide-in-up_140ms_ease-out]"
        >
          <span>
            Döp om kommande <span className="font-mono text-xs">{p.labelPrompt.pattern}</span> till <span className="font-medium">{p.labelPrompt.label}</span>?
          </span>
          <span className="text-muted">
            {p.labelPrompt.matches > 0
              ? `Döper också om ${p.labelPrompt.matches} ${p.labelPrompt.matches === 1 ? "rad" : "rader"} utan namn`
              : "Gäller kommande importer"}
            {p.labelPrompt.existingRuleId ? " · ersätter en befintlig namnregel" : ""}
          </span>
          <span className="flex-1" />
          <KeyHint keys={["r"]} label="Skapa namnregel">
            <button type="button" onClick={() => p.onRule(true)} className="rounded-lg bg-accent px-2.5 py-0.5 font-semibold text-white hover:bg-accent-hover">
              Skapa regel
            </button>
          </KeyHint>
          <button type="button" onClick={() => p.onRule(false)} className="rounded-lg px-2 py-0.5 text-ink-2 hover:bg-card">
            Nej
          </button>
        </div>
      )}

      {p.rulePrompt && (
        <div
          onClick={stop}
          className="mb-2.5 ml-12 flex flex-wrap items-center gap-2 rounded-[10px] bg-card-inset px-3 py-1.5 text-[13px] animate-[slide-in-up_140ms_ease-out]"
        >
          <span>
            Skapa regel för <span className="font-medium">{p.rulePrompt.suggestion.label}</span> → {p.rulePrompt.categoryLabel}?
          </span>
          <span className="text-muted">
            {p.rulePrompt.suggestion.matches > 0
              ? `Påverkar ${p.rulePrompt.suggestion.matches} ${p.rulePrompt.suggestion.matches === 1 ? "rad" : "rader"} till`
              : "Gäller kommande importer"}
            {p.rulePrompt.suggestion.existingRuleId ? " · ändrar en befintlig regel" : ""}
          </span>
          <span className="flex-1" />
          <KeyHint keys={["r"]} label="Skapa regel">
            <button type="button" onClick={() => p.onRule(true)} className="rounded-lg bg-accent px-2.5 py-0.5 font-semibold text-white hover:bg-accent-hover">
              Skapa
            </button>
          </KeyHint>
          <button type="button" onClick={() => p.onRule(false)} className="rounded-lg px-2 py-0.5 text-ink-2 hover:bg-card">
            Nej
          </button>
        </div>
      )}
    </div>
  );
});

/** A tag after the name: grey, or purple (avstämning, partner paid), green (a refund) or the transfer's blue. */
function Badge({ children, tone }: { children: ReactNode; tone?: "purple" | "green" | "transfer" }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-[6px] px-1.5 text-[11px] font-medium leading-[18px]",
        tone === "purple" ? "bg-purple-soft text-purple-text" : tone === "green" ? "bg-positive-soft text-positive-text" : tone === "transfer" ? "bg-transfer-soft text-transfer" : "bg-card-inset text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

/** The icons column: what the row is linked to or marked as, in the tertiary colour; the shared switch shows on hover when off. */
function RowIcons(p: RowProps & { inReturn: boolean; from: Transaction | null }) {
  const { row: r } = p;
  return (
    <>
      {r.recurringExpenseId && (
        <Tooltip content={`Fast utgift: ${r.recurringExpenseName}`}>
          <button type="button" onClick={() => p.onOpenRecurring(r.recurringExpenseId!)} className="rounded p-0.5 hover:text-ink" aria-label={`Fast utgift: ${r.recurringExpenseName}`}>
            <Repeat className="size-3.5" />
          </button>
        </Tooltip>
      )}
      {r.recurringIncomeId && (
        <Tooltip content="Återkommande inkomst">
          <Repeat className="size-3.5" aria-label="Återkommande inkomst" />
        </Tooltip>
      )}
      {p.inReturn && (
        <Tooltip content="Returnerat köp: räknas inte i några summor">
          <Undo2 className="size-3.5" aria-label="Returnerad" />
        </Tooltip>
      )}
      {/* What the money turned into: a pryl, with its name in the tooltip. */}
      {r.items && r.items.length > 0 && (
        <Tooltip content={`Pryl: ${r.items.map((i) => i.name).join(", ")}`}>
          <Package className="size-3.5" aria-label={`Pryl: ${r.items.map((i) => i.name).join(", ")}`} />
        </Tooltip>
      )}
      {/* ...and what it bought, when the receipt is in. */}
      {r.receipt && (
        <Tooltip content={`Kvitto: ${r.receipt.lines} rader`}>
          <ReceiptText className="size-3.5" aria-label={`Kvitto med ${r.receipt.lines} rader`} />
        </Tooltip>
      )}
      {r.private && (
        <KeyHint label="Privat · gör vanlig" keys={["p"]}>
          <button type="button" onClick={() => p.onTogglePrivate(r.id)} className="rounded p-0.5 hover:text-ink" aria-label="Privat (gör vanlig)">
            <EyeOff className="size-3.5" />
          </button>
        </KeyHint>
      )}
      {canShare(r) && !p.from && (
        <KeyHint
          label={r.shared ? `Delat med ${p.partnerName}` : r.forOther ? (r.paidBy === "partner" ? "Helt mitt" : `Helt ${p.partnerName}s`) : "Eget · gör delat"}
          keys={["s"]}
        >
          <button
            type="button"
            onClick={() => p.onToggleShared(r.id)}
            aria-pressed={r.shared}
            aria-label={r.shared ? "Delat" : r.forOther ? "Helt den andras" : "Eget"}
            className={cn("flex items-center gap-0.5 rounded p-0.5 hover:text-ink", !(r.shared || r.forOther) && "opacity-0 group-hover:opacity-100 focus:opacity-100")}
          >
            {r.forOther ? <User className="size-3.5" /> : <Users className="size-3.5" />}
            {r.forOther && <span className="text-[11px] font-medium">{r.paidBy === "partner" ? "mitt" : p.partnerName}</span>}
          </button>
        </KeyHint>
      )}
    </>
  );
}
