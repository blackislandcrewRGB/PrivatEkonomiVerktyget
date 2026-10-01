import { useCallback, useEffect, useState } from "react";
import { Eraser, RotateCcw } from "lucide-react";
import { getJson, sendJson, type TransactionList } from "../../api";
import { Amount } from "../../components/Amount";
import { Button } from "../../components/ui/button";
import { formatKr } from "../../lib/format";
import type { PageContext } from "./TransactionsPage";

export function DeletedList({ ctx }: { ctx: PageContext }) {
  const [data, setData] = useState<TransactionList | null>(null);
  const accountName = (id: number | null) => ctx.accounts.find((a) => a.id === id)?.name ?? "–";
  const load = useCallback(() => {
    getJson<TransactionList>("/transactions?deleted=1").then(setData);
  }, []);
  useEffect(load, [load]);

  const restore = async (id: number) => {
    await sendJson("POST", `/transactions/${id}/restore`, {});
    ctx.refreshCounts();
    ctx.notify({ text: "Raden är återställd." });
    load();
  };

  /** The one step that can't be undone, so it asks first and has no Ångra in the toast. */
  const forget = async (id: number, what: string, amount: number) => {
    if (!confirm(`Glöm ${what} ${formatKr(amount)}?\n\nRaden försvinner helt ur verktyget, även härifrån, men kommer inte tillbaka vid nästa import. Det går inte att ångra.`)) return;
    await sendJson("POST", `/transactions/${id}/forget`, {});
    ctx.refreshCounts();
    ctx.notify({ text: "Raden är glömd." });
    load();
  };

  if (!data) return null;
  if (data.rows.length === 0) return <p className="text-sm text-muted">Inga borttagna rader.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Borttagna rader räknas inte någonstans men finns kvar så att de inte kommer tillbaka vid nästa import. Glöm en rad för att få bort den härifrån också – den
        stannar borta vid import, men går inte att återställa.
      </p>
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {data.rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
            <span className="w-24 shrink-0 text-muted tabular-nums">{r.bookingDate}</span>
            <span className="min-w-0 flex-1 truncate">{r.descriptionClean}</span>
            <Amount ore={r.amount} size="sm" />
            <Button size="sm" variant="ghost" onClick={() => restore(r.id)}>
              <RotateCcw /> Återställ
            </Button>
            <Button size="sm" variant="ghost" className="hover:text-danger" onClick={() => forget(r.id, r.descriptionClean, r.amount)}>
              <Eraser /> Glöm
            </Button>
            <span className="basis-full pl-[6.75rem] text-xs text-muted max-sm:pl-0">
              {accountName(r.accountId)}
              {r.deletedAt && ` · borttagen ${new Date(r.deletedAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
