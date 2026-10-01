import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { parseKr, sendJson, type Overview } from "../../api";
import { Card } from "../../components/Card";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { formatKr } from "../../lib/format";
import { useIntent } from "../../shell/intents";
import { dm, kr } from "./format";
import { walletColour, walletInk } from "./wallet";

type Balance = Overview["balances"][number];

const age = (b: Balance) =>
  !b.updatedAt
    ? "inte ifyllt"
    : b.ageDays === 0
      ? "uppdaterat i dag"
      : `uppdaterat för ${b.ageDays} ${b.ageDays === 1 ? "dag" : "dagar"} sedan`;

/**
 * What a card's worked-out debt rests on: the invoice (paid or what is left
 * of it) and the purchases since its period, as far as they have been read.
 */
const debtText = (d: NonNullable<Balance["debt"]>) =>
  `${d.invoicePaid ? "fakturan betald" : `${kr(d.unpaid)} kvar på fakturan`} + ${kr(d.since)} köpt sedan ${dm(d.settledTo)}${d.lastPurchase ? ` (inläst t.o.m. ${dm(d.lastPurchase)})` : ""}`;

/**
 * Saldon as Wallet cards, stacked: the everyday account dark, savings blue,
 * the credit card gold with its invoice on the card. Click the amount to
 * change it (today's date). Cards have 'Ny faktura…' and 'markera betald'
 * in a menu. An account whose balance isn't followed (Inställningar ›
 * Konton) shows only its invoices, or a grey row when it has none.
 */
export function Balances({
  data,
  act,
  className,
}: {
  data: Overview;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  className?: string;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [bill, setBill] = useState<Balance | null>(null);
  useIntent("overview.editBalance", ({ accountId }) => {
    if (data.balances.some((b) => b.id === accountId)) setEditing(accountId);
    document
      .querySelector(`[data-balance="${accountId}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  const save = (b: Balance, text: string) => {
    const negative = /^\s*[-−]/.test(text);
    const ore = parseKr(text.replace(/^\s*[-−]/, ""));
    if (ore === null) return;
    // Card balances are debts: a positive number typed for a card means a debt.
    const balance =
      b.kind === "credit_card" ? -Math.abs(ore) : negative ? -ore : ore;
    setEditing(null);
    act(() =>
      sendJson("PUT", `/accounts/${b.id}/balance`, {
        balance,
        date: data.today,
      }),
    );
  };
  const markPaid = (b: Balance, paid: boolean) =>
    act(() =>
      sendJson("PUT", `/statements/${b.invoice!.statementId}/paid`, { paid }),
    ).then(() => {
      if (paid)
        notify({
          text: `Fakturan för ${b.name} är markerad som betald.`,
          action: { label: "Ångra", run: () => markPaid(b, false) },
        });
    });

  const menu = (b: Balance, onDark: boolean) =>
    b.kind === "credit_card" && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className={cn("-mr-2 size-7 shrink-0", onDark ? "-mt-0.5 text-(--wallet-fg)/85 hover:bg-white/15 hover:text-(--wallet-fg)" : "-my-1")}
            aria-label={`Mer för ${b.name}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
          {b.trackBalance && <DropdownMenuItem onSelect={() => setEditing(b.id)}>Uppdatera skuld</DropdownMenuItem>}
          {b.source !== "norwegian" && (
            <DropdownMenuItem onSelect={() => setBill(b)}>{b.invoiceImported ? "Lägg in faktura för hand…" : "Ny faktura…"}</DropdownMenuItem>
          )}
          {b.invoice && (
            <>
              <DropdownMenuSeparator />
              {b.invoice.status !== "paid" ? (
                <DropdownMenuItem onSelect={() => markPaid(b, true)}>Markera fakturan betald</DropdownMenuItem>
              ) : b.invoice.paidBy === "manual" ? (
                <DropdownMenuItem onSelect={() => markPaid(b, false)}>Ångra markerad betald</DropdownMenuItem>
              ) : null}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <Card aria-labelledby="balances-title" className={cn("flex flex-col gap-3.5 sm:py-5", className)}>
      <h2 id="balances-title" className="text-base font-semibold">
        Saldon
      </h2>
      <div className="flex flex-col gap-3">
        {data.balances.map((b) => {
          const invoiceOnly = !b.trackBalance && (b.invoice || b.nextInvoice);
          // Not followed and nothing to show: a quiet grey row.
          if (!b.trackBalance && !invoiceOnly) {
            return (
              <div key={b.id} data-balance={b.id} className="flex items-center justify-between gap-3 rounded-wallet bg-card-inset px-[18px] py-3 text-xs text-ink-2">
                <span>
                  <h3 className="inline font-semibold text-ink">{b.name}</h3> · inget saldo följs för kontot.
                </span>
                {menu(b, false)}
              </div>
            );
          }
          return (
            <div
              key={b.id}
              data-balance={b.id}
              className={cn("flex min-h-[70px] flex-col gap-2.5 rounded-wallet px-[18px] py-4 text-(--wallet-fg)", walletColour(b), walletInk(b))}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <h3 className="text-xs font-medium text-(--wallet-fg)/85">{b.name}</h3>
                  <span className="text-[11px] text-(--wallet-fg)/75">
                    {!b.trackBalance ? (
                      "inget saldo följs för kontot"
                    ) : b.debt ? (
                      <span title="Räknat fram: det som är kvar på senaste fakturan plus köpen på kortet efter fakturaperioden. Köp som inte lästs in än syns inte.">
                        skuld · {debtText(b.debt)}
                      </span>
                    ) : (
                      <>
                        {b.kind === "credit_card" && b.balance !== 0 && "skuld · "}
                        {age(b)}
                        {(b.source === "norwegian" || b.invoiceImported) && b.updatedAt && " · från fakturan"}
                        {b.stale && b.kind === "bank" && <b className="ml-1.5 rounded-full bg-white/25 px-1.5 font-semibold text-(--wallet-fg)">gammalt</b>}
                      </>
                    )}
                  </span>
                </div>
                {b.trackBalance &&
                  (editing === b.id ? (
                    <BalanceInput b={b} onSave={(t) => save(b, t)} onCancel={() => setEditing(null)} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(b.id)}
                      title={b.kind === "credit_card" ? "Uppdatera skulden" : "Uppdatera saldot"}
                      className="-mx-1 shrink-0 rounded-md px-1 text-right hover:bg-white/15"
                    >
                      {b.kind === "credit_card" && b.balance !== 0 && <span className="sr-only">skuld</span>}
                      <span className="whitespace-nowrap text-[22px] font-semibold tabular-nums">{formatKr(b.kind === "credit_card" ? Math.abs(b.balance) : b.balance)}</span>
                    </button>
                  ))}
                {menu(b, true)}
              </div>

              {(b.invoice || b.nextInvoice) && (
                // A band under the small print: white on the gold needs a darker one (UI-SPEC, Kontrast), Norwegian's light blue a lighter one.
                <div className="-mx-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[10px] bg-(--wallet-band) px-2.5 py-1.5 text-[11px]">
                  {b.invoice && (
                    <span className={cn(b.invoice.status !== "paid" && b.invoice.daysUntilDue < 0 && "font-semibold")}>
                      Faktura <b className="font-semibold tabular-nums">{kr(b.invoice.amountDue)}</b> · {b.invoice.daysUntilDue < 0 ? "förföll" : "förfaller"} {dm(b.invoice.dueDate)}
                      {b.invoice.status !== "paid" && b.invoice.daysUntilDue >= 0 && ` om ${b.invoice.daysUntilDue} ${b.invoice.daysUntilDue === 1 ? "dag" : "dagar"}`} ·{" "}
                      <b className="rounded-full bg-white/25 px-[7px] py-px font-semibold">
                        {b.invoice.status === "paid"
                          ? "betald"
                          : b.invoice.status === "partial"
                            ? `delbetald ${kr(b.invoice.paidAmount)}`
                            : b.invoice.daysUntilDue < 0
                              ? "förfallen"
                              : "obetald"}
                      </b>
                    </span>
                  )}
                  {b.nextInvoice && (
                    <span
                      className="tabular-nums"
                      title={`Köp ${dm(b.nextInvoice.periodFrom)} – i dag ${kr(b.nextInvoice.soFar)} + fasta utgifter på kortet till ${dm(b.nextInvoice.periodTo)} ${kr(b.nextInvoice.expectedFixed)}`}
                    >
                      nästa ca {kr(b.nextInvoice.estimate)} · {dm(b.nextInvoice.dueDate)}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <BillDialog account={bill} onClose={() => setBill(null)} act={act} />
    </Card>
  );
}

function BalanceInput({
  b,
  onSave,
  onCancel,
}: {
  b: Balance;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(
    String(Math.abs(b.balance) / 100).replace(".", ","),
  );
  return (
    <form
      className="flex max-w-[15rem] items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <input
        autoFocus
        onFocus={(e) => e.target.select()}
        aria-label={
          b.kind === "credit_card" ? `Skuld på ${b.name}` : `Saldo på ${b.name}`
        }
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="h-8 w-full min-w-0 rounded-md border border-transparent bg-card px-2 text-right text-ink tabular-nums outline-none focus:border-accent"
      />
      <span className="text-sm text-(--wallet-fg)/85">kr</span>
      <Button type="submit" size="sm" variant="primary">
        Spara
      </Button>
    </form>
  );
}

/** A card invoice entered by hand: amount and due date. */
function BillDialog({
  account,
  onClose,
  act,
}: {
  account: Balance | null;
  onClose: () => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const field =
    "h-8 rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";
  return (
    <Dialog
      open={!!account}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent aria-describedby="bill-desc">
        <DialogTitle>Ny faktura: {account?.name}</DialogTitle>
        <DialogDescription id="bill-desc" className="mt-1">
          Beloppet att betala och förfallodagen. Den räknas av i prognosen tills
          den är betald.
        </DialogDescription>
        <form
          className="mt-4 grid grid-cols-2 gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const ore = parseKr(amount);
            if (ore === null || !due || !account) return;
            act(() =>
              sendJson("POST", "/statements", {
                accountId: account.id,
                amountDue: ore,
                dueDate: due,
              }),
            );
            setAmount("");
            setDue("");
            onClose();
          }}
        >
          <label className="grid gap-1">
            <span className="text-xs text-muted">Belopp (kr)</span>
            <input
              autoFocus
              className={`${field} text-right tabular-nums`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted">Förfaller</span>
            <input
              type="date"
              className={field}
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <div className="col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Avbryt
            </Button>
            <Button type="submit" variant="primary">
              Spara
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
