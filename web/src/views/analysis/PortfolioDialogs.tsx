import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Trash2 } from "lucide-react";
import {
  ACCOUNT_NAMES,
  SIDE_NAMES,
  ZONE_NAMES,
  formatScaled,
  getJson,
  parseScaled,
  sendJson,
  shortDate,
  type Instrument,
  type InstrumentCurrency,
  type InstrumentDetail,
  type InstrumentKind,
  type InstrumentZone,
  type PortfolioValue,
  type SavingsTransfer,
  type TradeAccount,
  type TradeSide,
} from "../../api";
import { parseKr } from "../../api";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { ChartTooltip, Money, chart, kr } from "./common";
import { todayIso } from "../../lib/today";

/**
 * Att lägga in ett instrument, en affär och likviderna — and to look at one
 * holding on its own.
 *
 * Everything is typed the way it is written on the broker's page: '167,14',
 * '0,75', with a comma. The numbers are turned into integers at the door
 * (ten-thousandths of a share and of a price), so nothing rounds twice.
 *
 * The detail view shows what was paid beside what it is worth, as two
 * amounts. Neither is coloured and no percentage is drawn between them: it
 * is information about a purchase, not a verdict on it.
 */

const field = "h-8 w-full rounded-md border border-hairline bg-card px-2 text-sm outline-none focus:border-accent";
const label = "text-xs text-ink-2";

const today = todayIso;

function Field({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={label}>{text}</span>
      <span className="mt-0.5 block">{children}</span>
    </label>
  );
}

// ---------- Registrera affär ----------

export function TradeDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [transfers, setTransfers] = useState<SavingsTransfer[]>([]);
  const [instrumentId, setInstrumentId] = useState("");
  const [account, setAccount] = useState<TradeAccount>("isk");
  const [side, setSide] = useState<TradeSide>("buy");
  const [date, setDate] = useState(today());
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [rate, setRate] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    getJson<Instrument[]>("/savings/instruments").then(setInstruments, () => setInstruments([]));
    getJson<SavingsTransfer[]>("/savings/transfers").then(setTransfers, () => setTransfers([]));
    setError(null);
  }, [open]);

  const instrument = instruments.find((i) => String(i.id) === instrumentId);
  const quantityE4 = parseScaled(quantity, 4);
  const priceE4 = parseScaled(price, 4);
  const feeOre = fee.trim() === "" ? 0 : parseKr(fee);
  const rateE6 = rate.trim() === "" ? null : parseScaled(rate, 6);
  const ready = instrument && quantityE4 !== null && quantityE4 > 0 && priceE4 !== null && feeOre !== null && (rate.trim() === "" || rateE6 !== null);

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson("POST", "/savings/trades", {
        instrumentId: instrument!.id,
        account,
        side,
        date,
        quantityE4,
        priceE4,
        feeOre,
        fxRateE6: rateE6,
        transactionId: transactionId === "" ? null : Number(transactionId),
      });
      notify({ text: `${SIDE_NAMES[side]} av ${instrument!.name} är inlagt.` });
      onOpenChange(false);
      setQuantity("");
      setPrice("");
      setFee("");
      setRate("");
      setTransactionId("");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[34rem] max-w-[calc(100vw-2rem)]">
        <DialogTitle>Registrera affär</DialogTitle>
        <DialogDescription className="mt-1">Antal och kurs som de står hos Avanza. Courtaget är i kronor.</DialogDescription>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field text="Instrument">
            <select aria-label="Instrument" value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} className={field}>
              <option value="">Välj…</option>
              {instruments.map((i) => (
                <option key={i.id} value={String(i.id)}>
                  {i.name} ({i.currency})
                </option>
              ))}
            </select>
          </Field>
          <Field text="Konto">
            <select aria-label="Konto" value={account} onChange={(e) => setAccount(e.target.value as TradeAccount)} className={field}>
              {(["isk", "depot"] as const).map((a) => (
                <option key={a} value={a}>
                  {ACCOUNT_NAMES[a]}
                </option>
              ))}
            </select>
          </Field>
          <Field text="Sort">
            <select aria-label="Sorts affär" value={side} onChange={(e) => setSide(e.target.value as TradeSide)} className={field}>
              {(["buy", "sell", "opening"] as const).map((s) => (
                <option key={s} value={s}>
                  {SIDE_NAMES[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field text="Datum">
            <input aria-label="Datum" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </Field>
          <Field text="Antal">
            <input aria-label="Antal" inputMode="decimal" placeholder="73" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={cn(field, "tabular-nums")} />
          </Field>
          <Field text={`Kurs${instrument ? ` (${instrument.currency})` : ""}`}>
            <input aria-label="Kurs" inputMode="decimal" placeholder="167,14" value={price} onChange={(e) => setPrice(e.target.value)} className={cn(field, "tabular-nums")} />
          </Field>
          <Field text="Courtage (kr)">
            <input aria-label="Courtage" inputMode="decimal" placeholder="0" value={fee} onChange={(e) => setFee(e.target.value)} className={cn(field, "tabular-nums")} />
          </Field>
          {instrument && instrument.currency !== "SEK" && (
            <Field text="Växelkurs (valfri)">
              <input
                aria-label="Växelkurs"
                inputMode="decimal"
                placeholder="dagens kurs"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className={cn(field, "tabular-nums")}
              />
            </Field>
          )}
        </div>

        {instrument && instrument.currency !== "SEK" && (
          <p className="mt-1 text-xs text-ink-2">
            Kursen du faktiskt betalade, om du vet den. Annars används Riksbankens kurs för dagen — och vad ett köp kostade i kronor avgörs den dag det görs.
          </p>
        )}

        {transfers.length > 0 && (
          <div className="mt-3">
            <Field text="Hör till överföringen (valfritt)">
              <select aria-label="Överföring" value={transactionId} onChange={(e) => setTransactionId(e.target.value)} className={field}>
                <option value="">Ingen</option>
                {transfers.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {shortDate(t.date)} · {t.text} · {kr(t.amountOre)}
                    {t.linked ? " (redan kopplad)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {quantityE4 !== null && priceE4 !== null && instrument && (
          <p className="mt-3 text-sm text-ink-2">
            {formatScaled(quantityE4, 4)} × {formatScaled(priceE4, 4, 2)} {instrument.currency}
            {feeOre ? ` + ${kr(feeOre)} courtage` : ""}
          </p>
        )}
        {error && <p className="mt-2 text-sm text-alarm">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
            Spara affär
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Nytt instrument ----------

export function InstrumentDialog({
  open,
  instrument,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  instrument?: Instrument | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [isin, setIsin] = useState("");
  const [currency, setCurrency] = useState<InstrumentCurrency>("USD");
  const [kind, setKind] = useState<InstrumentKind>("stock");
  const [zone, setZone] = useState<InstrumentZone>("bet");
  const [ticker, setTicker] = useState("");
  const [avanzaId, setAvanzaId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(instrument?.name ?? "");
    setIsin(instrument?.isin ?? "");
    setCurrency(instrument?.currency ?? "USD");
    setKind(instrument?.kind ?? "stock");
    setZone(instrument?.zone ?? "bet");
    setTicker(instrument?.tickerYahoo ?? "");
    setAvanzaId(instrument?.tickerAvanza ?? "");
    setError(null);
  }, [open, instrument]);

  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    const body = { name, isin: isin || null, currency, kind, zone, tickerYahoo: ticker || null, tickerAvanza: avanzaId.trim() || null };
    try {
      if (instrument) await sendJson("PUT", `/savings/instruments/${instrument.id}`, body);
      else await sendJson("POST", "/savings/instruments", body);
      notify({ text: `${name.trim()} är ${instrument ? "ändrat" : "tillagt"}.` });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[32rem] max-w-[calc(100vw-2rem)]">
        <DialogTitle>{instrument ? "Ändra instrument" : "Nytt instrument"}</DialogTitle>
        <DialogDescription className="mt-1">
          Tickern är symbol och börs ihop: EXFG.DE är Xetra i euro, EXFG.L är London i dollar. Avanza-id:t är reserv när Yahoo säger nej — siffrorna i adressen
          till instrumentets sida hos Avanza.
        </DialogDescription>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field text="Namn">
            <input aria-label="Namn" value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </Field>
          <Field text="ISIN (valfri)">
            <input aria-label="ISIN" placeholder="IE00EXEMPEL1" value={isin} onChange={(e) => setIsin(e.target.value.toUpperCase())} className={cn(field, "tabular-nums")} />
          </Field>
          <Field text="Valuta">
            <select aria-label="Valuta" value={currency} onChange={(e) => setCurrency(e.target.value as InstrumentCurrency)} className={field}>
              {(["SEK", "USD", "EUR"] as const).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field text="Sort">
            <select aria-label="Sorts instrument" value={kind} onChange={(e) => setKind(e.target.value as InstrumentKind)} className={field}>
              <option value="etf">Fond/ETF</option>
              <option value="stock">Aktie</option>
            </select>
          </Field>
          <Field text="Zon">
            <select aria-label="Zon" value={zone} onChange={(e) => setZone(e.target.value as InstrumentZone)} className={field}>
              {(["base", "bet"] as const).map((z) => (
                <option key={z} value={z}>
                  {ZONE_NAMES[z]}
                </option>
              ))}
            </select>
          </Field>
          <Field text="Ticker (Yahoo)">
            <input aria-label="Ticker" placeholder="EXFG.DE" value={ticker} onChange={(e) => setTicker(e.target.value)} className={field} />
          </Field>
          <Field text="Avanza-id (valfritt)">
            <input
              aria-label="Avanza-id"
              inputMode="numeric"
              placeholder="1000001"
              value={avanzaId}
              onChange={(e) => setAvanzaId(e.target.value)}
              className={cn(field, "tabular-nums")}
            />
          </Field>
        </div>

        {error && <p className="mt-2 text-sm text-alarm">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            Spara
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Likvider ----------

export function CashDialog({
  open,
  accounts,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  accounts: PortfolioValue["accounts"];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [account, setAccount] = useState<TradeAccount>("isk");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const current = accounts.find((a) => a.account === account);
    setAmount(current?.cashOre != null ? (current.cashOre / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 }) : "");
    setError(null);
  }, [open, account, accounts]);

  const amountOre = parseKr(amount);
  const save = async () => {
    if (amountOre === null || busy) return;
    setBusy(true);
    try {
      await sendJson("PUT", "/savings/cash", { account, date, amountOre });
      notify({ text: `Likvider på ${ACCOUNT_NAMES[account]}: ${kr(amountOre)}.` });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[26rem] max-w-[calc(100vw-2rem)]">
        <DialogTitle>Likvider</DialogTitle>
        <DialogDescription className="mt-1">
          Pengar som står på kontot utan att vara placerade. Avanzas eget värde räknar med dem, så avstämningen behöver dem för att gå ihop.
        </DialogDescription>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field text="Konto">
            <select aria-label="Konto" value={account} onChange={(e) => setAccount(e.target.value as TradeAccount)} className={field}>
              {(["isk", "depot"] as const).map((a) => (
                <option key={a} value={a}>
                  {ACCOUNT_NAMES[a]}
                </option>
              ))}
            </select>
          </Field>
          <Field text="Datum">
            <input aria-label="Datum" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </Field>
          <Field text="Belopp (kr)">
            <input aria-label="Belopp" inputMode="decimal" placeholder="12 480,25" value={amount} onChange={(e) => setAmount(e.target.value)} className={cn(field, "tabular-nums")} />
          </Field>
        </div>
        {error && <p className="mt-2 text-sm text-alarm">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button variant="primary" disabled={amountOre === null || busy} onClick={() => void save()}>
            Spara
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Ett instrument ----------

export function InstrumentPanel({ instrumentId, onOpenChange, onChanged }: { instrumentId: number | null; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<InstrumentDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (instrumentId === null) return;
    getJson<InstrumentDetail>(`/savings/instruments/${instrumentId}`).then(setDetail, () => setDetail(null));
  };
  useEffect(() => {
    setDetail(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrumentId]);

  if (instrumentId === null) return null;

  const removeTrade = async (id: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await sendJson("DELETE", `/savings/trades/${id}`, {});
      load();
      onChanged();
      notify({ text: "Affären är borttagen." });
    } catch (e) {
      notify({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] w-[38rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
          {detail === null ? (
            <DialogTitle>Hämtar…</DialogTitle>
          ) : (
            <>
              <DialogTitle>{detail.instrument.name}</DialogTitle>
              <DialogDescription className="mt-1">
                {ZONE_NAMES[detail.instrument.zone]} · {detail.instrument.currency}
                {detail.instrument.tickerYahoo && ` · ${detail.instrument.tickerYahoo}`}
                {detail.instrument.isin && ` · ${detail.instrument.isin}`}
              </DialogDescription>

              <div className="mt-3 grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-ink-2">Antal</p>
                  <p className="text-sm tabular-nums">{formatScaled(detail.quantityE4, 4)} st</p>
                </div>
                <div>
                  <p className="text-xs text-ink-2">Värde</p>
                  <p className="text-sm tabular-nums">{detail.valueOre === null ? "–" : kr(detail.valueOre)}</p>
                  {detail.priceDate && (
                    <p className="text-xs text-ink-3">
                      {formatScaled(detail.priceE4!, 4, 2)} {detail.instrument.currency} {shortDate(detail.priceDate)}
                      {detail.priceSource && ` · ${detail.priceSource}`}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-ink-2">Insatt netto</p>
                  <p className="text-sm tabular-nums">{detail.investedUnknown || detail.investedOre === null ? "okänt" : kr(detail.investedOre)}</p>
                  <p className="text-xs text-ink-3">köp minus sälj, i kronor</p>
                </div>
              </div>

              {detail.history.length > 1 && (
                <div className="mt-3 h-32 w-full">
                  <ResponsiveContainer>
                    <LineChart data={detail.history.map((h) => ({ ...h, label: shortDate(h.date) }))} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chart.grid} />
                      <XAxis dataKey="label" tick={chart.tick} stroke={chart.grid} />
                      <YAxis
                        tick={chart.tick}
                        width={52}
                        stroke={chart.grid}
                        domain={["auto", "auto"]}
                        tickFormatter={(v: number) => formatScaled(v, 4, 0)}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0].payload as { label: string; priceE4: number; source: string };
                          return <ChartTooltip title={row.label} lines={[{ name: row.source, value: `${formatScaled(row.priceE4, 4, 2)} ${detail.instrument.currency}` }]} />;
                        }}
                      />
                      <Line type="monotone" dataKey="priceE4" stroke={chart.line} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-2">Affärer</h3>
              <ul className="mt-1 divide-y divide-hairline rounded-md border border-hairline text-sm">
                {detail.trades.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2 px-2 py-1.5">
                    <span className="w-12 shrink-0 text-ink-2 tabular-nums">{shortDate(t.date)}</span>
                    <span className="min-w-0 flex-1">
                      {SIDE_NAMES[t.side]} {formatScaled(t.quantityE4, 4)} × {formatScaled(t.priceE4, 4, 2)} {detail.instrument.currency}
                      <span className="pl-1.5 text-xs text-ink-3">
                        {ACCOUNT_NAMES[t.account]}
                        {t.feeOre > 0 && ` · ${kr(t.feeOre)} courtage`}
                        {t.fxRateE6 && ` · kurs ${formatScaled(t.fxRateE6, 6, 4)}`}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{t.amountOre === null ? "–" : <Money ore={t.amountOre} />}</span>
                    <button
                      type="button"
                      aria-label={`Ta bort affären ${shortDate(t.date)}`}
                      disabled={busy}
                      onClick={() => void removeTrade(t.id)}
                      className="rounded p-1 text-ink-2 hover:text-alarm"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex justify-between gap-2">
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Ändra instrumentet
                </Button>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Stäng
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <InstrumentDialog
        open={editing}
        instrument={detail?.instrument}
        onOpenChange={setEditing}
        onSaved={() => {
          load();
          onChanged();
        }}
      />
    </>
  );
}
