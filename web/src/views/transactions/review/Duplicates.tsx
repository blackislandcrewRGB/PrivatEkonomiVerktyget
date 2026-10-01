import { useCallback, useEffect, useRef, useState } from "react";
import { CopyCheck } from "lucide-react";
import { getJson, sendJson, type DuplicatePair, type Transaction } from "../../../api";
import { useShowPrivate } from "../../../privacy";
import { Amount } from "../../../components/Amount";
import { AccountBadge } from "../../../components/AccountBadge";
import { CategoryChip } from "../../../components/CategoryChip";
import { EmptyState } from "../../../components/EmptyState";
import { Kbd } from "../../../components/KeyHint";
import { Button } from "../../../components/ui/button";
import { isTyping } from "../../../shell/hotkeys";
import { cn } from "../../../lib/cn";
import type { PageContext } from "../TransactionsPage";

/**
 * Possible duplicates: the two rows side by side (same account, transaction
 * day, amount and text, another booking day, from different imports), with
 * 'Ta bort den nyare' (D) and 'Behåll båda' (B). ⇧J/⇧K or ↓/↑ move.
 */
export function Duplicates({ ctx }: { ctx: PageContext }) {
  const [pairs, setPairs] = useState<DuplicatePair[] | null>(null);
  const [active, setActive] = useState(0);
  const showPrivate = useShowPrivate();
  const load = useCallback(() => {
    getJson<DuplicatePair[]>("/review/duplicates").then(setPairs);
  }, []);
  useEffect(load, [load]);

  const deleteNewer = useCallback(
    async (p: DuplicatePair) => {
      await sendJson("DELETE", `/transactions/${p.newer.id}`, {});
      ctx.refreshCounts();
      load();
      ctx.notify({
        text: "Den nyare raden togs bort.",
        action: {
          label: "Ångra",
          run: async () => {
            await sendJson("POST", `/transactions/${p.newer.id}/restore`, {});
            ctx.refreshCounts();
            load();
          },
        },
      });
    },
    [ctx, load],
  );
  const keepBoth = useCallback(
    async (p: DuplicatePair) => {
      await sendJson("POST", "/review/duplicates/dismiss", { olderId: p.older.id, newerId: p.newer.id });
      ctx.refreshCounts();
      load();
    },
    [ctx, load],
  );

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (!pairs?.length || e.defaultPrevented || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    const p = pairs[Math.min(active, pairs.length - 1)];
    if (e.key === "J" || e.key === "ArrowDown") return e.preventDefault(), setActive((i) => Math.min(pairs.length - 1, i + 1));
    if (e.key === "K" || e.key === "ArrowUp") return e.preventDefault(), setActive((i) => Math.max(0, i - 1));
    if (e.key === "d") return e.preventDefault(), void deleteNewer(p);
    if (e.key === "b") return e.preventDefault(), void keepBoth(p);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!pairs) return null;
  if (pairs.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState icon={CopyCheck} title="Inga möjliga dubbletter">
          Hit hamnar rader från olika importer med samma konto, transaktionsdag, belopp och text men olika bokföringsdag, som om banken har ändrat en rad.
        </EmptyState>
      </div>
    );
  }
  const accountName = (id: number | null) => ctx.accounts.find((a) => a.id === id)?.name ?? null;
  const accountKind = (id: number | null) => ctx.accounts.find((a) => a.id === id)?.kind ?? null;
  const side = (t: Transaction, label: string) => (
    <div className="min-w-0 flex-1 space-y-1 rounded-lg border border-border bg-surface-muted/50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="truncate font-medium">{t.private && !showPrivate ? "Privat" : (t.label ?? t.descriptionClean)}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>bokförd <span className="font-medium text-foreground">{t.bookingDate}</span></span>
        <span>transaktionsdag {t.transactionDate}</span>
        <AccountBadge name={accountName(t.accountId)} kind={accountKind(t.accountId)} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <CategoryChip categoryId={t.categoryId} short />
        <Amount ore={t.amount} />
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {pairs.length} {pairs.length === 1 ? "par" : "par"}. Samma konto, transaktionsdag, belopp och text men olika bokföringsdag, från olika importer:
        troligen har banken ändrat raden mellan två exporter.
      </p>
      {pairs.map((p, i) => (
        <div
          key={`${p.older.id}-${p.newer.id}`}
          onClick={() => setActive(i)}
          className={cn(
            "card-click rounded-xl border bg-surface p-4",
            i === active ? "border-ring shadow-panel ring-1 ring-ring" : "border-border",
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row">
            {side(p.older, "Äldre import")}
            {side(p.newer, "Nyare import")}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => deleteNewer(p)}>
              Ta bort den nyare <Kbd keys={["d"]} className="border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground" />
            </Button>
            <Button size="sm" onClick={() => keepBoth(p)}>
              Behåll båda <Kbd keys={["b"]} />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
