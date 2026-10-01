import { useMemo } from "react";
import { sendJson, type Category, type LabelRuleSaved, type LabelRuleSuggestion, type RuleSuggestion, type Transaction } from "../../api";
import { clearCategorySuggestions } from "../../components/CategoryPicker";
import { reloadCategories } from "../../categories";
import { COLLAPSE_MS, useMotionOn } from "../../lib/motion";
import type { PageContext } from "./TransactionsPage";

export type Owner = "own" | "shared" | "partner";
type Editable = Partial<Pick<Transaction, "categoryId" | "shared" | "note" | "label" | "amount" | "bookingDate" | "private" | "forOther">>;
type Snapshot = unknown[];
interface BulkResult {
  changed: number;
  unchanged: number;
  skipped: number;
  skipReason: string | null;
  /** Rows whose split across categories the change replaced. */
  splitsCleared?: number;
  before: Snapshot;
}

export const ownerOf = (r: Transaction): Owner => (r.shared ? "shared" : r.forOther ? "partner" : "own");
/** Transfers, settlement money and private rows are never shared. */
export const canShare = (r: Transaction) => !r.isTransfer && !r.isSettlement && !r.private;
const rows = (n: number) => `${n} ${n === 1 ? "rad" : "rader"}`;

/**
 * Everything the list, the detail panel, the bulk bar and the keyboard can do
 * to rows. One row: PATCH and keep the change locally; several rows: the
 * bulk endpoints, a reload, and a toast with 'Ångra'.
 */
export function useTxActions({
  ctx,
  applyLocal,
  reload,
  onRuleSuggestion,
  onLabelRuleSuggestion,
  onLeaving,
}: {
  ctx: PageContext;
  /** Keep an edited row's new values until the next reload. */
  applyLocal: (t: Transaction) => void;
  reload: () => void;
  onRuleSuggestion: (rowId: number, s: RuleSuggestion) => void;
  /** After one row is renamed: offer a name rule for new imports. */
  onLabelRuleSuggestion?: (rowId: number, s: LabelRuleSuggestion) => void;
  /** Rows that are about to go: the list collapses them before reloading. */
  onLeaving?: (ids: readonly number[]) => void;
}) {
  const motionOn = useMotionOn();
  return useMemo(() => {
    const categoryName = (id: number | null) => {
      const c = ctx.categories.find((x) => x.id === id);
      const p = c?.parentId != null ? ctx.categories.find((x) => x.id === c.parentId) : undefined;
      return c ? (p ? `${p.name} › ${c.name}` : c.name) : "";
    };
    const fail = (e: unknown) => ctx.notify({ text: (e as Error).message });
    const undoable = (text: string, before: Snapshot) =>
      ctx.notify({
        text,
        action: before.length
          ? {
              label: "Ångra",
              run: async () => {
                await sendJson("POST", "/transactions/undo", { rows: before });
                ctx.refreshCounts();
                reload();
              },
            }
          : undefined,
      });

    const patch = async (r: Transaction, body: Editable) => {
      try {
        const res = await sendJson<{
          transaction: Transaction;
          splitCleared?: boolean;
          ruleSuggestion: RuleSuggestion | null;
          labelRuleSuggestion?: LabelRuleSuggestion | null;
        }>("PATCH", `/transactions/${r.id}`, body);
        // The response lacks joined fields; keep them from the list row.
        applyLocal({ ...r, ...res.transaction, splits: res.splitCleared ? null : r.splits });
        // The new category applies to the whole amount, so the split is gone.
        if (res.splitCleared) ctx.notify({ text: "Uppdelningen togs bort: kategorin gäller hela köpet." });
        if (res.ruleSuggestion) onRuleSuggestion(r.id, res.ruleSuggestion);
        if (res.labelRuleSuggestion) onLabelRuleSuggestion?.(r.id, res.labelRuleSuggestion);
        if ("categoryId" in body) {
          clearCategorySuggestions();
          ctx.refreshCounts();
        }
        return res.transaction;
      } catch (e) {
        fail(e);
        return null;
      }
    };

    const bulk = async (targets: Transaction[], body: Record<string, unknown>, what: string) => {
      try {
        const r = await sendJson<BulkResult>("POST", "/transactions/bulk", { ids: targets.map((t) => t.id), ...body });
        undoable(
          `${rows(r.changed)} ${what}.` +
            (r.unchanged ? ` ${r.unchanged} var redan det.` : "") +
            (r.skipped ? ` ${r.skipped} hoppades över${r.skipReason ? ` (${r.skipReason})` : ""}.` : "") +
            (r.splitsCleared ? ` Uppdelningen togs bort på ${rows(r.splitsCleared)}.` : ""),
          r.before,
        );
        clearCategorySuggestions();
        await leave(targets.map((t) => t.id));
        ctx.refreshCounts();
        reload();
        onLeaving?.([]);
      } catch (e) {
        fail(e);
      }
    };

    const setCategory = (targets: Transaction[], c: Category) => {
      if (targets.length === 1) return void patch(targets[0], { categoryId: c.id });
      return void bulk(targets, { categoryId: c.id }, `fick ${categoryName(c.id)}`);
    };

    const unknown = (targets: Transaction[]) => {
      const id = ctx.categories.find((c) => c.systemKey === "unknown")?.id;
      if (!id) return;
      if (targets.length === 1) return void patch(targets[0], { categoryId: id });
      return void bulk(targets, { categoryId: id }, "satta till Vet ej (Övrigt › Okänt)");
    };

    const setOwner = (targets: Transaction[], owner: Owner) => {
      if (targets.length === 1) {
        const r = targets[0];
        const body: Editable =
          owner === "shared" ? { shared: true } : owner === "partner" ? { forOther: true } : r.forOther ? { forOther: false } : { shared: false };
        return void patch(r, body);
      }
      const label = owner === "shared" ? "delade" : owner === "own" ? "egna" : `${ctx.partnerName}s`;
      return void bulk(targets, { owner }, `markerade som ${label}`);
    };

    /** S: own ↔ shared (for what the partner paid: shared ↔ wholly mine). Several rows: all shared, or all own if they already are. */
    const toggleShared = (targets: Transaction[]) => {
      const eligible = targets.filter(canShare);
      if (eligible.length === 0) {
        return ctx.notify({ text: "Överföringar, avstämning och privata rader delas aldrig." });
      }
      if (eligible.length === 1 && targets.length === 1) {
        const r = eligible[0];
        if (r.paidBy === "partner") return setOwner([r], r.shared ? "partner" : "shared");
        return setOwner([r], r.shared ? "own" : "shared");
      }
      return setOwner(targets, eligible.every((r) => r.shared) ? "own" : "shared");
    };

    const togglePrivate = (targets: Transaction[]) => {
      const own = targets.filter((r) => r.paidBy !== "partner");
      if (own.length === 0) return ctx.notify({ text: "Det partnern betalat kan inte vara privat." });
      const makePrivate = !own.every((r) => r.private);
      if (targets.length === 1) return void patch(own[0], { private: makePrivate });
      return void bulk(targets, { private: makePrivate }, makePrivate ? "gjorda privata" : "inte längre privata");
    };

    /** The same note on every row; '' removes it. */
    const setNote = (targets: Transaction[], note: string) => {
      if (targets.length === 1) return void patch(targets[0], { note });
      return void bulk(targets, { note }, note ? `fick anteckningen ”${note}”` : "fick anteckningen borttagen");
    };

    /** The same name on every row; '' shows the bank's text again. */
    const setLabel = (targets: Transaction[], label: string) => {
      if (targets.length === 1) {
        const r = targets[0];
        if (!label && r.source === "manual") return;
        return void patch(r, { label: label || null });
      }
      return void bulk(targets, { label }, label ? `heter nu ”${label}”` : "visar bankens text igen");
    };

    /** The name on these rows, and a name rule so new imports (and other rows without a name) get it too. */
    const saveLabelRule = async (targets: Transaction[], label: string, pattern: string) => {
      try {
        const r = await sendJson<LabelRuleSaved>("POST", "/label-rules", { pattern, matchType: "contains", label, ids: targets.map((t) => t.id) });
        ctx.notify({
          text: r.renamed
            ? `${rows(r.renamed)} heter nu ”${label}”.` + (r.applied ? ` Regeln döpte om ${rows(r.applied)} till.` : "") + " Nya importer får namnet."
            : `Namnregel sparad: ${pattern} → ${label}.` + (r.applied ? ` ${rows(r.applied)} till fick namnet.` : "") + " Nya importer får det.",
          action: {
            label: "Ångra",
            run: async () => {
              await sendJson("POST", `/label-rules/${r.rule.id}/undo`, { previousLabel: r.previousLabel, before: r.before });
              reload();
            },
          },
        });
        reload();
      } catch (e) {
        fail(e);
      }
    };

    /** Lets the list collapse the rows before they are gone. */
    const leave = async (ids: number[]) => {
      if (!onLeaving || !motionOn) return;
      onLeaving(ids);
      await new Promise((r) => setTimeout(r, COLLAPSE_MS));
    };

    const remove = async (targets: Transaction[], showPrivate: boolean) => {
      try {
        if (targets.length === 1) {
          const r = targets[0];
          await sendJson("DELETE", `/transactions/${r.id}`, {});
          ctx.notify({
            text: r.private && !showPrivate ? "En privat rad togs bort." : `”${r.label ?? r.descriptionClean}” togs bort.`,
            action:
              r.source === "manual"
                ? undefined
                : {
                    label: "Ångra",
                    run: async () => {
                      await sendJson("POST", `/transactions/${r.id}/restore`, {});
                      ctx.refreshCounts();
                      reload();
                    },
                  },
          });
        } else {
          const r = await sendJson<{ soft: number; hard: number; before: Snapshot }>("POST", "/transactions/bulk-delete", {
            ids: targets.map((t) => t.id),
          });
          undoable(
            `${rows(r.soft + r.hard)} togs bort.` + (r.hard ? ` ${r.hard} manuella raderades på riktigt och går inte att ångra.` : ""),
            r.before,
          );
        }
        ctx.refreshCounts();
        reload();
      } catch (e) {
        fail(e);
      }
    };

    const createRule = async (s: RuleSuggestion, pattern = s.pattern) => {
      try {
        const r = await sendJson<{ rule: { id: number }; applied: number; previousCategoryId: number | null; before: Snapshot }>(
          "POST",
          "/rules",
          { pattern, matchType: s.matchType, direction: s.direction, categoryId: s.categoryId },
        );
        ctx.notify({
          text: `Regel sparad: ${pattern} → ${categoryName(s.categoryId)}.${r.applied ? ` ${rows(r.applied)} till fick kategori.` : ""}`,
          action: {
            label: "Ångra",
            run: async () => {
              await sendJson("POST", `/rules/${r.rule.id}/undo`, { previousCategoryId: r.previousCategoryId, before: r.before });
              clearCategorySuggestions();
              ctx.refreshCounts();
              reload();
            },
          },
        });
        clearCategorySuggestions();
        ctx.refreshCounts();
        reload();
        return true;
      } catch (e) {
        fail(e);
        return false;
      }
    };

    const duplicate = async (r: Transaction) => {
      try {
        await sendJson("POST", "/transactions", {
          label: r.label ?? r.descriptionClean,
          amount: r.amount,
          bookingDate: r.bookingDate,
          accountId: r.accountId,
          categoryId: r.categoryId,
          updateBalance: false,
        });
        ctx.notify({ text: "En manuell kopia skapades. Den påverkar inte kontots saldo." });
        reload();
      } catch (e) {
        fail(e);
      }
    };

    const undoReturn = async (r: Transaction) => {
      await sendJson("DELETE", `/transactions/${r.id}/return`, {});
      reload();
    };

    return {
      patch,
      setCategory,
      unknown,
      setOwner,
      toggleShared,
      togglePrivate,
      setNote,
      setLabel,
      saveLabelRule,
      remove,
      createRule,
      duplicate,
      undoReturn,
      categoryName,
      reloadCategories,
    };
  }, [ctx, applyLocal, reload, onRuleSuggestion, onLabelRuleSuggestion, onLeaving, motionOn]);
}

export type TxActions = ReturnType<typeof useTxActions>;
