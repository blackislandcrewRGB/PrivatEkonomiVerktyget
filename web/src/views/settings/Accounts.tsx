import { useCallback, useEffect, useState } from "react";
import { Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { formatSek, getJson, sendJson, syncSummary, type Account, type BankConnection, type BankStatus, type BankSyncReport } from "../../api";
import { Amount } from "../../components/Amount";
import { Switch } from "../../components/Switch";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { walletColour } from "../overview/wallet";
import { accountsWaiting, linkState, longDate, needsPreview, syncNow, type LinkTone } from "./bankSync";
import { useReportBadge } from "./badges";
import { NewAccount } from "./NewAccount";
import { BUTTON, FIELD, SettingsCard } from "./ui";

export const ACCOUNTS_TEXT = {
  title: "Konton och bankkopplingar",
  hint: "saldot uppdaterar du i Översikten · Enable Banking hämtar kl 06, 12 och 18 · fyra hämtningar per dygn utan inloggning",
};

const DOT: Record<LinkTone, string> = { green: "bg-positive", orange: "bg-caution", red: "bg-alarm", grey: "bg-neutral-bar" };
const TONE_TEXT: Record<LinkTone, string> = { green: "text-ink", orange: "text-caution-text", red: "text-alarm", grey: "text-ink" };

/** The brick's letters: MC, BN, or the first letter. */
const brickText = (a: Account) => (a.source === "mastercard" ? "MC" : /norwegian/i.test(a.name) ? "BN" : a.name.charAt(0).toLocaleUpperCase("sv"));

type Draft = Record<number, { name: string; note: string; trackBalance: boolean }>;

/**
 * Konton och bankkopplingar (Design v2): one card for the accounts and the
 * bank connections that feed them. A row per account: a brick in its wallet
 * colour, name and masked number, its role, how it gets its rows (Enable
 * Banking active, running out or run out, or by hand) and its balance, a debt
 * in orange. 'Ändra' turns the rows into their fields (name, note, follow the
 * balance) and shows which account each bank account feeds; a bank account
 * that feeds none is shown always. The consents, 'Förnya samtycke' and 'Ta
 * bort koppling' (confirmed) in the footer, with 'Koppla <bank>' for a bank not
 * connected. The first sync is previewed.
 */
export function Accounts({ accounts, onChanged, match }: { accounts: Account[]; onChanged: () => void; match: (...texts: string[]) => boolean }) {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<BankSyncReport | null>(null);
  const [removing, setRemoving] = useState<BankConnection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [adding, setAdding] = useState(false);
  const [dropping, setDropping] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => notify({ text: (e as Error).message });
  const load = useCallback(() => getJson<BankStatus>("/enable-banking/status").then(setStatus, fail), []);
  useEffect(() => {
    load();
  }, [load]);

  // Back from the bank: the outcome is in the address.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const outcome = q.get("bank");
    if (!outcome) return;
    if (outcome === "ok") {
      const unmatched = Number(q.get("okopplade") ?? 0);
      notify({ text: `${q.get("namn")} är kopplad (${q.get("konton")} konton).${unmatched ? ` ${unmatched} behöver ett konto här.` : " Synka för att hämta raderna."}` });
    } else notify({ text: q.get("meddelande") ?? "Kopplingen misslyckades." });
    window.history.replaceState(null, "", `${window.location.pathname}#konton`);
    document.getElementById("konton")?.scrollIntoView?.({ block: "start" });
  }, []);

  const connect = async (bank: string) => {
    setBusy(`connect:${bank}`);
    try {
      const { url } = await sendJson<{ url: string }>("POST", "/enable-banking/connect", { bank });
      window.location.assign(url);
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };
  const sync = async () => {
    if (!status) return;
    setBusy("sync");
    try {
      if (needsPreview(status)) setPreview(await syncNow({ dryRun: true }));
      else {
        notify({ text: syncSummary(await syncNow()) });
        onChanged();
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
      load();
    }
  };
  const fetchForReal = async () => {
    setPreview(null);
    setBusy("sync");
    try {
      notify({ text: syncSummary(await syncNow()) });
      onChanged();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
      load();
    }
  };
  const choose = (bankAccountId: number, accountId: number | null) =>
    sendJson("PUT", `/enable-banking/bank-accounts/${bankAccountId}`, { accountId }).then(load, fail);
  const remove = (c: BankConnection) =>
    sendJson("DELETE", `/enable-banking/connections/${c.id}`, {}).then(() => {
      setRemoving(null);
      notify({ text: `${c.bank} är bortkopplad. Raderna som hämtats ligger kvar.` });
      load();
    }, fail);

  const edit = () => {
    setError(null);
    setDraft(Object.fromEntries(accounts.map((a) => [a.id, { name: a.name, note: a.note ?? "", trackBalance: a.trackBalance }])));
  };
  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError(null);
    try {
      for (const a of accounts) {
        const d = draft[a.id];
        if (!d) continue;
        const patch: { name?: string; note?: string | null; trackBalance?: boolean } = {};
        if (d.name.trim() !== a.name) patch.name = d.name;
        if ((d.note.trim() || null) !== (a.note ?? null)) patch.note = d.note.trim() || null;
        if (d.trackBalance !== a.trackBalance) patch.trackBalance = d.trackBalance;
        if (Object.keys(patch).length) await sendJson("PATCH", `/accounts/${a.id}`, patch);
      }
      setDraft(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const drop = (a: Account) =>
    sendJson("DELETE", `/accounts/${a.id}`, {}).then(
      () => {
        setDropping(null);
        setDraft(null);
        notify({ text: `Kontot "${a.name}" är borttaget.` });
        onChanged();
      },
      (e) => {
        setDropping(null);
        notify({ text: (e as Error).message });
      },
    );
  const set = (id: number, patch: Partial<Draft[number]>) => setDraft((d) => (d ? { ...d, [id]: { ...d[id], ...patch } } : d));
  useReportBadge("konton", accountsWaiting(status));

  if (!match(ACCOUNTS_TEXT.title, ACCOUNTS_TEXT.hint, "nytt konto", "samtycke", "förnya samtycke", "synka nu", "koppla bort", "följ saldot", ...accounts.map((a) => `${a.name} ${a.note ?? ""}`), ...(status?.connections.map((c) => c.bank) ?? []))) return null;
  const connected = new Set(status?.connections.map((c) => c.bank));
  const unlinked = status?.connections.flatMap((c) => c.accounts.filter((a) => a.accountId === null).map((a) => ({ c, a }))) ?? [];
  const linked = status?.connections.flatMap((c) => c.accounts.filter((a) => a.accountId !== null).map((a) => ({ c, a }))) ?? [];
  const bankSelect = (c: BankConnection, a: BankConnection["accounts"][number]) => (
    <select
      aria-label={`Konto här för ${c.bank} ${a.maskedRef ?? ""}`}
      value={a.accountId ?? ""}
      onChange={(e) => choose(a.id, e.target.value ? Number(e.target.value) : null)}
      className={cn(FIELD, "h-8 w-auto min-w-44", a.accountId === null && "border-caution")}
    >
      <option value="">Hämtas inte</option>
      {accounts.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );

  return (
    <SettingsCard
      id="konton"
      title={ACCOUNTS_TEXT.title}
      description={
        <span title="Kontonumren binds vid första importen och visas maskerade. Rader som redan kommit från en fil länkas i stället för att läggas till igen.">
          saldot uppdaterar du i Översikten · Enable Banking hämtar kl {(status?.syncHours ?? [6, 12, 18]).map((h) => String(h).padStart(2, "0")).join(", ").replace(/, (\d+)$/, " och $1")} · fyra hämtningar per
          dygn utan inloggning
        </span>
      }
      aside={
        draft ? (
          <>
            <button type="button" className={BUTTON.blue} onClick={save} disabled={busy !== null}>
              Spara
            </button>
            <button type="button" className={BUTTON.link} onClick={() => (setDraft(null), setError(null))}>
              Avbryt
            </button>
          </>
        ) : (
          <>
            {status?.connections.length ? (
              <button type="button" className={BUTTON.grey} onClick={sync} disabled={busy !== null || status.syncing}>
                <RefreshCw className={cn("size-3.5", busy === "sync" && "animate-spin")} aria-hidden /> Synka nu
              </button>
            ) : null}
            <button type="button" className={BUTTON.grey} onClick={() => setAdding(true)}>
              <Plus className="size-3.5" aria-hidden /> Nytt konto
            </button>
            <button type="button" className={cn(BUTTON.link, "px-1")} onClick={edit}>
              Ändra
            </button>
          </>
        )
      }
      footer={
        <div className="w-full space-y-1.5">
          {status && !status.configured && <p>Enable Banking är inte konfigurerat: EB_APP_ID, EB_PRIVATE_KEY_PATH och EB_REDIRECT_URL behövs i .env.</p>}
          {status?.connections.map((c) => (
            <div key={c.id} data-bank={c.bank} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className={cn(c.expiresSoon || (c.daysLeft ?? 99) <= 30 ? "text-caution-text" : "text-ink-2")}>
                {c.bank}: samtycket gäller till {c.validUntil ? longDate(c.validUntil) : "–"}
                {c.daysLeft !== null && c.daysLeft >= 0 && ` (${c.daysLeft} dagar kvar)`}
                {" · "}senaste synk {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "aldrig"}
                {c.lastError && <span className="block text-alarm">{c.lastError}</span>}
              </span>
              <span className="flex items-center gap-2">
                <button type="button" className="text-[11px] font-medium text-accent hover:underline" onClick={() => connect(c.bank)} disabled={busy !== null}>
                  Förnya samtycke
                </button>
                <span aria-hidden>·</span>
                <button type="button" className={BUTTON.danger} onClick={() => setRemoving(c)} aria-label={`Ta bort kopplingen till ${c.bank}`}>
                  Ta bort koppling
                </button>
              </span>
            </div>
          ))}
          {status?.configured && status.banks.some((b) => !connected.has(b)) && (
            <div className="flex flex-wrap gap-3">
              {status.banks
                .filter((b) => !connected.has(b))
                .map((b) => (
                  <button key={b} type="button" className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline" onClick={() => connect(b)} disabled={busy !== null}>
                    <Link2 className="size-3" aria-hidden /> Koppla {b}
                  </button>
                ))}
            </div>
          )}
        </div>
      }
    >
      {error && <p className="px-6 pt-3 text-[12px] text-alarm">{error}</p>}
      {accounts.length === 0 && <p className="px-5 py-4 text-[13px] text-ink-2 sm:px-6">Inga konton än. Skapa ett med Nytt konto: ett för varje bankkonto och kreditkort du vill följa.</p>}
      <ul aria-label="Konton">
        {accounts.map((a) => {
          const s = linkState(a, status);
          const d = draft?.[a.id];
          const number = a.accountRef ? `${a.clearing ?? ""} ${a.accountRef}`.trim() : null;
          return (
            <li key={a.id} data-account={a.id} className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 border-t border-hairline px-5 py-3 first:border-t-0 sm:px-6 @[40rem]:grid-cols-[36px_minmax(0,1.4fr)_minmax(0,1fr)_7.5rem]">
              <span className={cn("row-span-2 grid size-9 place-items-center self-start rounded-[10px] text-[11px] font-bold @[40rem]:row-span-1 @[40rem]:self-center", walletColour(a), /norwegian/i.test(a.name) && a.kind === "credit_card" ? "text-[#0f2740]" : "text-white")} aria-hidden>
                {brickText(a)}
              </span>
              {d ? (
                <div className="col-span-2 grid min-w-0 gap-2 @[40rem]:col-span-3 @[40rem]:grid-cols-[1fr_1.4fr_auto] @[40rem]:items-center">
                  <input aria-label={`Namn på ${a.name}`} className={FIELD} value={d.name} onChange={(e) => set(a.id, { name: e.target.value })} />
                  <input aria-label={`Anteckning för ${a.name}`} placeholder="Anteckning" className={FIELD} value={d.note} onChange={(e) => set(a.id, { note: e.target.value })} />
                  <span className="flex items-center gap-3">
                  <Switch checked={d.trackBalance} onCheckedChange={(on) => set(a.id, { trackBalance: on })} label={`Följ saldot för ${a.name}`} title="Av: kontot har inget saldo att följa. Det visas inte, efterfrågas inte och räknas inte i prognosen.">
                    <span className="whitespace-nowrap text-[12px]">Följ saldot</span>
                  </Switch>
                  <button type="button" className={BUTTON.danger} onClick={() => setDropping(a)} aria-label={`Ta bort kontot ${a.name}`}>
                    Ta bort
                  </button>
                  </span>
                </div>
              ) : (
                <>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-[14px] font-semibold">{a.name}</span>
                      {number && <span className="font-mono text-[11px] text-ink-3">{number}</span>}
                    </span>
                    {(a.kind === "credit_card" || a.source === "csv" || a.note) && (
                      <span className="block text-[11px] text-ink-3">{[a.kind === "credit_card" && "kreditkort", a.source === "csv" && "CSV-import", a.note].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                  <span className="col-span-2 col-start-2 min-w-0 text-[11px] @[40rem]:col-span-1 @[40rem]:col-start-3 @[40rem]:row-start-1" data-link={s.tone}>
                    <span className={cn("flex items-center gap-1.5 font-medium", TONE_TEXT[s.tone])}>
                      <span className={cn("size-2 shrink-0 rounded-full", DOT[s.tone])} aria-hidden />
                      {s.label}
                    </span>
                    <span className="block pl-3.5 text-ink-3">{s.sub}</span>
                  </span>
                  <span className="col-start-3 row-start-1 text-right text-[14px] font-semibold tabular-nums @[40rem]:col-start-4" data-balance>
                    {a.trackBalance ? (
                      <Amount ore={a.balance} size="sm" kind="neutral" className={cn("font-semibold", a.balance < 0 && "text-caution-text")} />
                    ) : (
                      <span className="text-[13px] text-ink-3">inget saldo</span>
                    )}
                  </span>
                </>
              )}
            </li>
          );
        })}
        {/* A bank account that feeds no account here, always; in Ändra, which account each one feeds. */}
        {(draft ? [...linked, ...unlinked] : unlinked).map(({ c, a }) => (
          <li key={`bank-${a.id}`} className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline px-5 py-2.5 text-[12px] sm:px-6", a.accountId === null && "bg-caution-soft/50")}>
            <span className="min-w-0">
              <span className="font-medium">{c.bank}</span> <span className="font-mono text-ink-3">{a.maskedRef ?? "–"}</span> <span className="text-ink-2">{a.product ?? "Konto"}</span>
              {a.accountId === null && <span className="ml-2 text-caution-text">hämtas inte – välj konto här</span>}
              {a.pending.count > 0 && <span className="block text-ink-3">{a.pending.count} reserverade {formatSek(Math.abs(a.pending.amount))} (räknas inte än)</span>}
            </span>
            {bankSelect(c, a)}
          </li>
        ))}
      </ul>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent aria-describedby="bank-preview-desc">
          <DialogTitle>Första hämtningen</DialogTitle>
          <DialogDescription id="bank-preview-desc" className="mt-2">
            Så här blir det. Rader som redan finns från filerna länkas och ändras inte (kategori, delad, namn och anteckning står kvar).
          </DialogDescription>
          <ul className="mt-3 space-y-1 text-sm">
            {preview?.connections.flatMap((c) =>
              c.accounts.map((a) => (
                <li key={a.bankAccountId}>
                  <span className="font-medium">{a.accountName ?? `${c.bank} ${a.maskedRef ?? ""}`}</span>:{" "}
                  {a.error ? (
                    <span className="text-danger">{a.error}</span>
                  ) : a.fetched === 0 ? (
                    <span className="text-warning">banken gav inga rader alls – hämta inte, något är fel</span>
                  ) : (
                    <>
                      {a.booked} bokförda, <b>{a.rowsLinked}</b> länkas till befintliga, <b>{a.rowsNew}</b> nya
                      {a.rowsSkipped ? `, ${a.rowsSkipped} finns redan` : ""}
                      {a.pending ? `, ${a.pending} reserverade` : ""}
                    </>
                  )}
                </li>
              )),
            )}
          </ul>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Avbryt
            </Button>
            <Button variant="primary" onClick={fetchForReal}>
              Hämta
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <NewAccount open={adding} onOpenChange={setAdding} onCreated={onChanged} />
      <Dialog open={!!dropping} onOpenChange={(o) => !o && setDropping(null)}>
        <DialogContent aria-describedby="account-drop-desc">
          <DialogTitle>Ta bort {dropping?.name}?</DialogTitle>
          <DialogDescription id="account-drop-desc" className="mt-2">
            Det går bara om kontot inte har några transaktioner. Har det det får du ångra importerna först (Importer › Historik).
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDropping(null)}>
              Avbryt
            </Button>
            <Button variant="danger" onClick={() => dropping && drop(dropping)}>
              <Trash2 /> Ta bort
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent aria-describedby="bank-remove-desc">
          <DialogTitle>Koppla bort {removing?.bank}?</DialogTitle>
          <DialogDescription id="bank-remove-desc" className="mt-2">
            Samtycket avslutas hos banken och inget hämtas längre. Raderna som redan hämtats ligger kvar.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Avbryt
            </Button>
            <Button variant="danger" onClick={() => removing && remove(removing)}>
              <Trash2 /> Koppla bort
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
