import { useEffect, useState, type ReactNode } from "react";
import { BellRing, ChevronRight, Copy, ExternalLink, Repeat, Star, Trash2, Undo2 } from "lucide-react";
import { getJson, parseKr, sendJson, uploadIcon, type IconRef, type RuleSuggestion, type Transaction } from "../../api";
import { IconUpload } from "../../components/IconUpload";
import { MerchantIcon } from "../../components/MerchantIcon";
import { notify } from "../../components/Toast";
import { SidePanel } from "../../components/SidePanel";
import { Amount } from "../../components/Amount";
import { CategoryChip } from "../../components/CategoryChip";
import { SplitEditor } from "./SplitEditor";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Button } from "../../components/ui/button";
import { Kbd, KeyHint } from "../../components/KeyHint";
import { formatKr, longDate } from "../../lib/format";
import { openTransactions } from "../../shell/openTransactions";
import { navigate } from "../../shell/routes";
import { cn } from "../../lib/cn";
import { NoteInput, ReturnPanel } from "./editors";
import { TxItems } from "./TxItems";
import { TxReceipt } from "./TxReceipt";
import { PlanChangeFromCharge } from "./PlanChange";
import { canShare, ownerOf, type Owner, type TxActions } from "./useTxActions";
import type { PageContext } from "./TransactionsPage";

interface Details {
  id: number;
  descriptionRaw: string;
  postedDate: string | null;
  merchantCategory: string | null;
  cardMasked: string | null;
  counterRef: string | null;
  foreignAmount: number | null;
  foreignCurrency: string | null;
  exchangeRate: number | null;
  fingerprint: string;
  occurrenceIndex: number;
  createdAt: string;
  import: { id: number; filename: string; importedAt: string } | null;
  merchant: { label: string; query: string; since: string; count: number; total: number; average: number };
  rules: { id: number; pattern: string; matchType: string; direction: string; categoryId: number; hits: number; best: boolean; iconPath: string | null; icon?: IconRef }[];
  ruleSuggestion: RuleSuggestion | null;
}

const MATCH = { exact: "exakt", contains: "innehåller", regex: "regex" } as Record<string, string>;
const DIRECTION = { in: " (in)", out: " (ut)", any: "" } as Record<string, string>;
const SOURCE = { swedbank: "Swedbank", norwegian: "Bank Norwegian", mastercard: "Mastercard", manual: "Manuell" } as const;

/**
 * Everything about one transaction, all of it editable: label, category,
 * whose, private, note (amount and date on manual rows). Below: the same
 * merchant for 12 months, the rules that match, and technical details.
 * Non-modal, so ↑/↓ in the list moves it to the next row.
 */
export function TxPanel({
  row,
  ctx,
  actions,
  showPrivate,
  onClose,
  onOpenPicker,
  onChanged,
  onNameRule,
}: {
  row: Transaction | null;
  ctx: PageContext;
  actions: TxActions;
  showPrivate: boolean;
  onClose: () => void;
  onOpenPicker: (anchor: HTMLElement) => void;
  onChanged: () => void;
  /** Opens the name dialog for this row, with a name rule for new imports. */
  onNameRule?: (row: Transaction) => void;
}) {
  const [details, setDetails] = useState<Details | null>(null);
  const [returning, setReturning] = useState(false);
  // Bumped after a picture changes, to fetch the rules' icons again.
  const [iconTick, setIconTick] = useState(0);
  const detailsKey = row ? `${row.id}:${row.categoryId}:${iconTick}` : "";
  useEffect(() => {
    setReturning(false);
  }, [row?.id]);
  useEffect(() => {
    if (!row) return setDetails(null);
    let live = true;
    getJson<Details>(`/transactions/${row.id}/details`).then((d) => live && setDetails(d), () => live && setDetails(null));
    return () => {
      live = false;
    };
    // Refetch when the category changes (rules and the suggested rule depend on it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsKey]);

  const masked = !!row && row.private && !showPrivate;
  const accountName = row ? (ctx.accounts.find((a) => a.id === row.accountId)?.name ?? "Inget konto") : "";

  return (
    <SidePanel
      modal={false}
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title={!row ? "" : masked ? "Privat" : (row.label ?? row.descriptionClean)}
      description={row ? `${longDate(row.bookingDate)} · ${accountName}` : undefined}
      footer={
        row &&
        !masked && (
          <>
            <KeyHint keys={["d"]} label="Ta bort">
              <Button variant="danger" size="sm" onClick={() => actions.remove([row], showPrivate)}>
                <Trash2 /> Ta bort
              </Button>
            </KeyHint>
            <Button size="sm" onClick={() => actions.duplicate(row)}>
              <Copy /> Duplicera som manuell
            </Button>
            <span className="flex-1" />
            <span className="flex items-center gap-1 text-xs text-muted">
              <Kbd keys={["↑"]} />
              <Kbd keys={["↓"]} /> nästa
            </span>
          </>
        )
      }
    >
      {row && masked && <p className="text-sm text-muted">Raden är privat. Slå på Visa privata (⌘K) för att se och ändra den.</p>}
      {row && !masked && (
        <PanelBody
          key={row.id}
          row={row}
          ctx={ctx}
          actions={actions}
          details={details}
          returning={returning}
          setReturning={setReturning}
          onOpenPicker={onOpenPicker}
          onChanged={onChanged}
          onIconChanged={() => {
            setIconTick((n) => n + 1);
            onChanged();
          }}
          onNameRule={onNameRule}
        />
      )}
    </SidePanel>
  );
}

function PanelBody({
  row: r,
  ctx,
  actions,
  details,
  returning,
  setReturning,
  onOpenPicker,
  onChanged,
  onIconChanged,
  onNameRule,
}: {
  row: Transaction;
  ctx: PageContext;
  actions: TxActions;
  details: Details | null;
  returning: boolean;
  setReturning: (v: boolean) => void;
  onOpenPicker: (anchor: HTMLElement) => void;
  onChanged: () => void;
  /** A picture was added or removed: the rules' icons and the list change. */
  onIconChanged: () => void;
  onNameRule?: (row: Transaction) => void;
}) {
  const manual = r.source === "manual";
  const inReturn = r.returnGroupId !== null;
  const [label, setLabel] = useState(r.label ?? "");
  const [amount, setAmount] = useState((r.amount / 100).toLocaleString("sv-SE"));
  const [pattern, setPattern] = useState<string | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [watching, setWatching] = useState(false);

  /**
   * 'Remind me before it draws again': the charge becomes a fixed expense the
   * Vakt asks about in time. The toast says where it went and undoes it, since
   * a button that quietly adds something to Fasta utgifter would be a surprise.
   */
  const watchCharge = async () => {
    if (watching) return;
    setWatching(true);
    try {
      const expense = await sendJson<{ id: number; name: string; remindDays: number | null }>("POST", `/transactions/${r.id}/watch-charge`, {});
      onChanged();
      notify({
        text: `${expense.name} är nu en fast utgift. Vakten säger till ${expense.remindDays ?? 3} dagar innan varje dragning.`,
        action: {
          label: "Ångra",
          run: async () => {
            await sendJson("DELETE", `/recurring-expenses/${expense.id}`, {});
            onChanged();
          },
        },
      });
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setWatching(false);
    }
  };
  const [draft, setDraft] = useState<RecurringDraft | null>(null);
  useEffect(() => setDraft(null), [r.id]);

  /** 'Gör till fast utgift…': the form starts from the purchase (name and bank's text to change). */
  const startRecurring = async () => {
    try {
      const d = await getJson<Omit<RecurringDraft, "cycle">>(`/transactions/${r.id}/recurring-draft`);
      setDraft({ ...d, cycle: "yearly" });
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  const makeRecurring = async () => {
    if (!draft) return;
    try {
      const expense = await sendJson<{ id: number; name: string }>("POST", `/transactions/${r.id}/make-recurring`, { name: draft.name, cycle: draft.cycle, pattern: draft.pattern });
      setDraft(null);
      onChanged();
      notify({
        text: `${expense.name} är nu en fast utgift (${draft.cycle === "yearly" ? "årsvis" : "månadsvis"}).`,
        action: {
          label: "Ångra",
          run: async () => {
            await sendJson("DELETE", `/recurring-expenses/${expense.id}`, {});
            onChanged();
          },
        },
      });
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  useEffect(() => setLabel(r.label ?? (manual ? r.descriptionClean : "")), [r.label, r.descriptionClean, manual]);
  useEffect(() => setAmount((r.amount / 100).toLocaleString("sv-SE")), [r.amount]);
  useEffect(() => setPattern(null), [details?.ruleSuggestion?.pattern]);

  const ownerOptions: { value: Owner; label: string }[] =
    r.paidBy === "partner"
      ? [
          { value: "shared", label: "Delat" },
          { value: "partner", label: "Mitt" },
        ]
      : [
          { value: "own", label: "Eget" },
          { value: "shared", label: "Delat" },
          { value: "partner", label: `${ctx.partnerName}s` },
        ];
  const saveLabel = () => {
    const v = label.trim();
    if (v !== (r.label ?? "") && (v || !manual)) actions.patch(r, { label: v || null });
  };
  const saveAmount = () => {
    const negative = /^[-−]/.test(amount.trim());
    const ore = parseKr(amount.replace(/^[-−]/, ""));
    if (ore && (negative ? -ore : ore) !== r.amount) actions.patch(r, { amount: negative ? -ore : ore });
  };
  const suggestion = details?.ruleSuggestion ?? null;

  return (
    <div className="space-y-6 text-sm">
      <div>
        {manual ? (
          <div className="flex items-center gap-2">
            <input
              aria-label="Belopp"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={saveAmount}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="w-40 rounded-md border border-border bg-surface px-2 py-1 text-xl font-semibold tabular-nums"
            />
            <span className="text-muted">kr</span>
          </div>
        ) : (
          <Amount ore={r.amount} size="lg" kind={r.isTransfer ? "transfer" : undefined} strike={inReturn} />
        )}
        {manual && (
          <input
            type="date"
            aria-label="Datum"
            defaultValue={r.bookingDate}
            key={r.bookingDate}
            onBlur={(e) => e.target.value && e.target.value !== r.bookingDate && actions.patch(r, { bookingDate: e.target.value })}
            className="mt-2 rounded-md border border-border bg-surface px-2 py-1"
          />
        )}
      </div>

      <dl className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        <Field label="Etikett" keys={["l"]}>
          <input
            value={label}
            placeholder={r.descriptionClean}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={saveLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setLabel(r.label ?? "");
            }}
            className="w-full rounded-md border border-border bg-surface px-2 py-1"
          />
          {/* The list shows only the new name; here is what the bank called it. */}
          {r.label && !manual && r.label !== r.descriptionClean && (
            <p className="mt-1 flex min-w-0 items-baseline gap-2 text-xs text-muted">
              <span className="truncate">Bankens text: {r.descriptionClean}</span>
              {onNameRule && (
                <button type="button" onClick={() => onNameRule(r)} className="shrink-0 text-link hover:underline" title="Ge nya importer med samma text samma namn">
                  Namnregel…
                </button>
              )}
            </p>
          )}
        </Field>
        <Field label="Kategori" keys={["c"]} top={!!r.splits || splitting}>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {r.isTransfer && r.transferPairId ? (
                <span className="text-transfer">Överföring mellan egna konton</span>
              ) : null}
              {r.splits ? (
                // A split purchase: every part with its own amount, instead of one category.
                <ul className="min-w-0 flex-1 space-y-0.5">
                  {r.splits.map((p) => (
                    <li key={p.categoryId} className="flex min-w-0 items-center gap-2">
                      <CategoryChip categoryId={p.categoryId} className="min-w-0 border-border" />
                      <span className="ml-auto shrink-0 tabular-nums text-muted">{formatKr(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <CategoryChip
                  data-panel-category=""
                  categoryId={r.categoryId}
                  onClick={(e) => onOpenPicker(e.currentTarget)}
                  className="border-border"
                />
              )}
              {r.categoryId === null && !r.isTransfer && (
                <KeyHint keys={["u"]} label="Övrigt › Okänt, utan regel">
                  <Button size="sm" variant="ghost" onClick={() => actions.unknown([r])}>
                    Vet ej
                  </Button>
                </KeyHint>
              )}
            </div>
            {!r.isTransfer && !splitting && (
              <div className="flex flex-wrap items-center gap-x-3 text-xs">
                <button type="button" onClick={() => setSplitting(true)} className="text-link hover:underline">
                  {r.splits ? "Ändra uppdelningen" : "Dela upp på kategorier…"}
                </button>
                {r.splits && (
                  <button
                    type="button"
                    onClick={() => {
                      void sendJson("DELETE", `/transactions/${r.id}/splits`, {}).then(
                        () => {
                          notify({ text: "Uppdelningen togs bort." });
                          onChanged();
                        },
                        (e: Error) => notify({ text: e.message }),
                      );
                    }}
                    className="text-link hover:underline"
                  >
                    Ta bort uppdelningen
                  </button>
                )}
              </div>
            )}
            {splitting && (
              <SplitEditor
                row={r}
                onSaved={() => {
                  setSplitting(false);
                  onChanged();
                }}
                onCancel={() => setSplitting(false)}
              />
            )}
          </div>
        </Field>
        <Field label="Vems" keys={["s"]}>
          {canShare(r) ? (
            <SegmentedControl<Owner>
              size="sm"
              label="Vems"
              value={ownerOf(r)}
              onChange={(o) => actions.setOwner([r], o)}
              options={ownerOptions}
            />
          ) : (
            <span className="text-muted">
              {r.private ? "Privata rader delas aldrig" : "Överföringar och avstämning delas aldrig"}
            </span>
          )}
        </Field>
        <Field label="Privat" keys={["p"]}>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={r.private}
              disabled={r.paidBy === "partner"}
              onChange={(e) => actions.patch(r, { private: e.target.checked })}
              className="size-4 accent-[var(--warning)]"
            />
            <span className="text-muted">{r.paidBy === "partner" ? "Går inte för det partnern betalat" : "Döljs när Visa privata är av"}</span>
          </label>
        </Field>
        <Field label="Anteckning" keys={["n"]} top>
          <NoteInput
            value={r.note ?? ""}
            rowId={r.id}
            autoFocus={false}
            placeholder="Lägg till en anteckning"
            onDone={(v) => v !== (r.note ?? "") && actions.patch(r, { note: v })}
          />
        </Field>
      </dl>

      {(r.recurringExpenseId || inReturn || (r.amount < 0 && !r.isTransfer)) && (
        <section className="space-y-2">
          {r.recurringExpenseId ? (
            <button onClick={() => ctx.openRecurring(r.recurringExpenseId!)} className="flex items-center gap-2 text-link hover:underline">
              <Repeat className="size-4" /> Fast utgift: {r.recurringExpenseName}
            </button>
          ) : (
            r.amount < 0 &&
            !r.isTransfer &&
            !inReturn && (
              // A subscription started for a while: the tool can't cancel it,
              // but it can ask in time, before it takes money again.
              <>
                <PlanChangeFromCharge row={r} foreign={details ? { amount: details.foreignAmount, currency: details.foreignCurrency } : null} onChanged={onChanged} />
                <button onClick={() => void watchCharge()} disabled={watching} className="flex items-center gap-2 text-muted hover:text-foreground">
                  <BellRing className="size-4" /> Påminn innan nästa dragning…
                </button>
                {draft ? (
                  <RecurringForm draft={draft} onChange={setDraft} onSave={() => void makeRecurring()} onCancel={() => setDraft(null)} />
                ) : (
                  <button onClick={() => void startRecurring()} className="flex items-center gap-2 text-muted hover:text-foreground">
                    <Repeat className="size-4" /> Gör till fast utgift…
                  </button>
                )}
              </>
            )
          )}
          {inReturn ? (
            <p className="flex items-center gap-2 text-muted">
              <Undo2 className="size-4" />
              {r.returnGroupId === r.id ? "Returnerat köp" : "Återbetalning för ett returnerat köp"}: räknas inte i några summor.
              <button className="text-link underline" onClick={() => actions.undoReturn(r)}>
                Ångra
              </button>
            </p>
          ) : (
            r.amount < 0 &&
            !r.isTransfer &&
            (returning ? (
              <div className="rounded-md border border-border p-3">
                <ReturnPanel
                  purchase={r}
                  onClose={() => setReturning(false)}
                  onDone={() => {
                    setReturning(false);
                    ctx.notify({ text: "Markerad som returnerad. Köpet och återbetalningen räknas inte längre." });
                    onChanged();
                  }}
                />
              </div>
            ) : (
              <button onClick={() => setReturning(true)} className="flex items-center gap-2 text-muted hover:text-foreground">
                <Undo2 className="size-4" /> Markera som returnerad…
              </button>
            ))
          )}
        </section>
      )}

      {/* What the money turned into. Never for a transfer or settlement money. */}
      {!r.isTransfer && !r.isSettlement && <TxItems row={r} onChanged={onChanged} />}
      {!r.isTransfer && !r.isSettlement && <TxReceipt row={r} onChanged={onChanged} />}

      {details && (
        <>
          <Section title="Samma handlare, 12 månader">
            {details.merchant.count > 0 ? (
              <div className="flex items-center gap-3">
                <p className="flex-1">
                  {details.merchant.count} {details.merchant.count === 1 ? "gång" : "gånger"} ·{" "}
                  <span className="tabular-nums">{formatKr(details.merchant.total, { whole: true })}</span>
                  <span className="text-muted"> · snitt {formatKr(details.merchant.average, { whole: true })}</span>
                </p>
                <button
                  className="flex items-center gap-1 text-link hover:underline"
                  onClick={() => openTransactions({ period: "custom", from: details.merchant.since, to: "", q: details.merchant.query })}
                >
                  Visa <ChevronRight className="size-3.5" />
                </button>
              </div>
            ) : (
              <p className="text-muted">Inga andra rader.</p>
            )}
          </Section>

          <MerchantPicture row={r} rule={details.rules.find((x) => x.best) ?? null} onChanged={onIconChanged} />

          <Section title="Regler">
            {details.rules.length === 0 && <p className="text-muted">Ingen regel träffar raden.</p>}
            <ul className="space-y-1">
              {details.rules.map((rule) => (
                <li key={rule.id} className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-xs">{rule.pattern}</span>
                  <span className="shrink-0 text-xs text-subtle">
                    {MATCH[rule.matchType]}
                    {DIRECTION[rule.direction]}
                  </span>
                  <span className="text-subtle">→</span>
                  <CategoryChip categoryId={rule.categoryId} short />
                  {rule.best && (
                    <span title="Den här regeln gäller (mest specifik)">
                      <Star className="size-3.5 fill-current text-warning" />
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {suggestion && (
              <div className="mt-3 space-y-2 rounded-md border border-border bg-surface-muted p-3">
                <p>
                  {suggestion.existingRuleId ? "Ändra regeln så att" : "Skapa en regel så att"} texten som innehåller
                </p>
                <input
                  aria-label="Mönster"
                  value={pattern ?? suggestion.pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
                />
                <p className="flex items-center gap-1.5">
                  får <CategoryChip categoryId={suggestion.categoryId} />
                  {suggestion.direction !== "any" && <span className="text-muted">({suggestion.direction === "in" ? "pengar in" : "pengar ut"})</span>}
                </p>
                <Button size="sm" variant="primary" onClick={() => actions.createRule(suggestion, (pattern ?? suggestion.pattern).trim())}>
                  {suggestion.existingRuleId ? "Ändra regeln" : "Skapa regel"}
                </Button>
              </div>
            )}
          </Section>

          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" /> Tekniskt
            </summary>
            <dl className="mt-2 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <Tech label="Bankens text">
                <span className="font-mono">{details.descriptionRaw}</span>
              </Tech>
              <Tech label="Källa">{SOURCE[r.source]}</Tech>
              {details.import && (
                <Tech label="Import">
                  <button className="inline-flex items-center gap-1 text-link hover:underline" onClick={() => navigate("imports")}>
                    {details.import.filename} · {details.import.importedAt.slice(0, 10)} <ExternalLink className="size-3" />
                  </button>
                </Tech>
              )}
              {details.postedDate && <Tech label="Bokföringsdag">{details.postedDate}</Tech>}
              {r.transactionDate && r.transactionDate !== r.bookingDate && <Tech label="Transaktionsdag">{r.transactionDate}</Tech>}
              {details.merchantCategory && <Tech label="Norwegian-kategori">{details.merchantCategory}</Tech>}
              {details.cardMasked && <Tech label="Kort">{details.cardMasked}</Tech>}
              {details.foreignCurrency && details.foreignAmount !== null && (
                <Tech label="Valuta">
                  {(details.foreignAmount / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 })} {details.foreignCurrency}
                  {details.exchangeRate !== null && ` · kurs ${details.exchangeRate.toLocaleString("sv-SE")}`}
                </Tech>
              )}
              {details.counterRef && <Tech label="Motkonto">{details.counterRef}</Tech>}
              <Tech label="Fingeravtryck">
                <span className="font-mono" title={details.fingerprint}>
                  {details.fingerprint.slice(0, 16)}… #{details.occurrenceIndex}
                </span>
              </Tech>
              <Tech label="Id">{r.id}</Tech>
            </dl>
          </details>
        </>
      )}
    </div>
  );
}

function Field({ label, keys, top, children }: { label: string; keys: string[]; top?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className={`flex items-center gap-1.5 text-muted ${top ? "self-start pt-1" : ""}`}>
        {label}
        <Kbd keys={keys} className="h-4 min-w-4 text-[10px]" />
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Tech({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/** The merchant's picture, on the rule that decides the row (every purchase there). Without a rule there is nowhere to put it. */
function MerchantPicture({
  row,
  rule,
  onChanged,
}: {
  row: Transaction;
  rule: { id: number; pattern: string; iconPath: string | null; icon?: IconRef } | null;
  onChanged: () => void;
}) {
  const preview = <MerchantIcon label={row.label} contact={row.counterpartyName} text={row.descriptionClean} icon={rule ? (rule.icon ?? null) : row.icon} size={40} />;
  return (
    <Section title="Ikon för handlaren">
      {rule ? (
        <IconUpload
          preview={preview}
          hasOwn={!!rule.iconPath}
          onFile={async (file) => {
            await uploadIcon(`/rules/${rule.id}/icon`, file);
            notify({ text: `Bilden gäller alla köp hos ${rule.pattern}.` });
            onChanged();
          }}
          onRemove={async () => {
            await sendJson("DELETE", `/rules/${rule.id}/icon`, {});
            onChanged();
          }}
        >
          <span>
            Gäller alla köp som regeln <span className="font-mono">{rule.pattern}</span> träffar.
          </span>
        </IconUpload>
      ) : (
        <div className="flex items-center gap-3">
          {preview}
          <p className="text-xs text-muted">Bilder sätts på en regel. Skapa en regel för handlaren nedan, så går det att lägga in en bild.</p>
        </div>
      )}
    </Section>
  );
}

interface RecurringDraft {
  name: string;
  pattern: string;
  amount: number;
  date: string;
  accountName: string | null;
  cycle: "monthly" | "yearly";
}

const CYCLE_OPTIONS: { value: RecurringDraft["cycle"]; label: string }[] = [
  { value: "monthly", label: "Månadsvis" },
  { value: "yearly", label: "Årsvis" },
];

/**
 * 'Gör till fast utgift…': a name, monthly or yearly, and the bank's text it
 * is recognised by. The amount, the account and the day are the purchase's.
 */
function RecurringForm({ draft, onChange, onSave, onCancel }: { draft: RecurringDraft; onChange: (d: RecurringDraft) => void; onSave: () => void; onCancel: () => void }) {
  const day = Number(draft.date.slice(8, 10));
  const when =
    draft.cycle === "yearly"
      ? `varje år ${new Date(`${draft.date}T00:00:00`).toLocaleDateString("sv-SE", { day: "numeric", month: "long" })}`
      : `varje månad den ${day}:e`;
  const input = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";
  return (
    <form
      aria-label="Gör till fast utgift"
      className="space-y-2 rounded-lg border border-border bg-canvas p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <p className="text-sm font-medium">Gör till fast utgift</p>
      <label className="block text-xs text-muted">
        Namn
        <input className={input} value={draft.name} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>
      <SegmentedControl label="Betalas" options={CYCLE_OPTIONS} value={draft.cycle} onChange={(cycle) => onChange({ ...draft, cycle })} size="sm" />
      <label className="block text-xs text-muted">
        Bankens text
        <input className={cn(input, "font-mono")} value={draft.pattern} onChange={(e) => onChange({ ...draft, pattern: e.target.value })} />
      </label>
      <p className="text-xs text-muted tabular-nums">
        {formatKr(draft.amount)} {when}
        {draft.accountName ? ` från ${draft.accountName}` : ""}. Tidigare köp med samma text kopplas också.
      </p>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={!draft.name.trim() || draft.pattern.trim().length < 3}>
          Skapa
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          Avbryt
        </Button>
      </div>
    </form>
  );
}
