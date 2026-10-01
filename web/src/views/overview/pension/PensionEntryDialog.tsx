import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { parseKr, REGION_NAMES, sendJson, type FundRegion, type PensionEntry, type PensionKind } from "../../../api";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../components/ui/dialog";
import { notify } from "../../../components/Toast";
import { cn } from "../../../lib/cn";
import { todayIso } from "../../../lib/today";
import { dm, kr } from "../format";

const field = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";

const KIND_NAMES: Record<PensionKind, string> = {
  income_pension: "Inkomstpension",
  premium_pension: "Premiepension",
  occupational: "Tjänstepension",
  private: "Privat pension",
};

/** A decimal as typed ('1 234,5678'), or null. */
const parseNumber = (s: string) => {
  const t = s.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const krText = (ore: number | null) => (ore === null ? "" : (ore / 100).toLocaleString("sv-SE", { useGrouping: false, maximumFractionDigits: 2 }));
const decimalText = (v: number, digits: number) => v.toLocaleString("sv-SE", { useGrouping: false, maximumFractionDigits: digits });

interface FundDraft {
  fundName: string;
  amount: string;
  units: string;
  nav: string;
  fee: string;
  region: FundRegion;
  /** Last time's units, shown as a hint: they grow with every premium, so they are typed again. */
  prevUnits: string;
}

const emptyFund: FundDraft = { fundName: "", amount: "", units: "", nav: "", fee: "", region: "global", prevUnits: "" };

/**
 * Skriva av en pension från minpension.se: the value and the day it was true,
 * the premium, and the funds as they stand. The funds are given whole — the
 * list here replaces the stored one — since a statement says what is held
 * now and a fund sold since would otherwise be left behind.
 *
 * With no entry it adds a new one, and then also asks what kind it is.
 */
export function PensionEntryDialog({ entry, open, onOpenChange, onSaved }: { entry: PensionEntry | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [kind, setKind] = useState<PensionKind>("occupational");
  const [provider, setProvider] = useState("");
  const [name, setName] = useState("");
  const [placeable, setPlaceable] = useState(false);
  const [payoutFromAge, setPayoutFromAge] = useState("");
  const [amount, setAmount] = useState("");
  const [valueDate, setValueDate] = useState(todayIso());
  const [status, setStatus] = useState<PensionEntry["status"]>("active");
  const [premium, setPremium] = useState("");
  const [premiumDate, setPremiumDate] = useState("");
  const [note, setNote] = useState("");
  const [funds, setFunds] = useState<FundDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setKind(entry?.kind ?? "occupational");
    setProvider(entry?.provider ?? "");
    setName(entry?.name ?? "");
    setPlaceable(entry?.placeable ?? false);
    setPayoutFromAge(entry?.payoutFromAge != null ? String(entry.payoutFromAge) : "");
    // A new reading: the amount is typed again, the day is today's.
    setAmount("");
    setValueDate(todayIso());
    setStatus(entry?.status ?? "active");
    setPremium(krText(entry?.monthlyPremiumOre ?? null));
    setPremiumDate(entry?.premiumDate ?? "");
    setNote(entry?.note ?? "");
    setFunds(
      (entry?.funds ?? []).map((f) => ({
        fundName: f.fundName,
        amount: "",
        units: "",
        nav: "",
        prevUnits: decimalText(f.unitsE4 / 10000, 4),
        fee: f.feePctE4 === null ? "" : decimalText(f.feePctE4 / 10000, 4),
        region: f.region,
      })),
    );
  }, [open, entry]);

  const setFund = (i: number, patch: Partial<FundDraft>) => setFunds((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  /** A fund's value: as typed, else units × price. */
  const fundOre = (f: FundDraft) => {
    const typed = parseKr(f.amount);
    if (typed !== null) return typed;
    const units = parseNumber(f.units);
    const nav = parseKr(f.nav);
    return units !== null && nav !== null ? Math.round(units * nav) : null;
  };
  /** A fund's unit price: as typed, else value ÷ units. */
  const fundNav = (f: FundDraft) => {
    const typed = parseKr(f.nav);
    if (typed !== null) return typed;
    const units = parseNumber(f.units);
    const ore = parseKr(f.amount);
    return units && ore !== null ? Math.round(ore / units) : null;
  };
  const fundsOre = funds.length && funds.every((f) => fundOre(f) !== null) ? funds.reduce((s, f) => s + fundOre(f)!, 0) : null;
  // Left empty with funds given, the value is the funds' sum.
  const amountOre = parseKr(amount) ?? (amount.trim() === "" ? fundsOre : null);

  const save = async () => {
    if (amountOre === null) return setError("Fyll i värdet i kronor.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valueDate)) return setError("Fyll i dagen värdet gällde.");
    const premiumOre = premium.trim() === "" ? null : parseKr(premium);
    if (premium.trim() !== "" && premiumOre === null) return setError("Premien ska vara ett belopp i kronor.");
    const age = payoutFromAge.trim() === "" ? null : Number(payoutFromAge);
    if (age !== null && !Number.isInteger(age)) return setError("Uttagsåldern ska vara ett helt antal år.");
    const fundBodies = [];
    for (const f of funds) {
      const units = parseNumber(f.units);
      const navOre = fundNav(f);
      const ore = fundOre(f);
      const fee = f.fee.trim() === "" ? null : parseNumber(f.fee);
      if (!f.fundName.trim() || units === null || navOre === null || ore === null) return setError(`Fyll i namn, andelar och kurs eller värde för ${f.fundName.trim() || "varje fond"}.`);
      if (f.fee.trim() !== "" && fee === null) return setError(`${f.fundName}: avgiften ska vara ett tal i procent.`);
      fundBodies.push({
        fundName: f.fundName.trim(),
        amountOre: ore,
        unitsE4: Math.round(units * 10000),
        navOre,
        valueDate,
        feePctE4: fee === null ? null : Math.round(fee * 10000),
        region: f.region,
      });
    }
    const body = {
      provider,
      name,
      amountOre,
      valueDate,
      status,
      monthlyPremiumOre: premiumOre,
      premiumDate: premiumDate || null,
      note: note.trim() || null,
      placeable,
      payoutFromAge: age,
      funds: fundBodies,
    };
    try {
      if (entry) await sendJson("PUT", `/networth/pension/${entry.id}`, body);
      else await sendJson("POST", "/networth/pension", { ...body, kind });
      notify({ text: `${provider.trim() || "Pensionen"} – ${name.trim()}: ${kr(amountOre)} den ${dm(valueDate)}.` });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const label = "text-xs text-muted";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[44rem] max-w-[calc(100vw-2rem)]">
        <DialogTitle>{entry ? `${entry.provider} – ${entry.name}` : "Ny pensionspost"}</DialogTitle>
        <DialogDescription className="mt-1">
          Skriv av värdet från minpension.se och dagen det gällde.
          {entry && ` Förra värdet: ${kr(entry.amountOre)} den ${dm(entry.valueDate)} ${entry.valueDate.slice(0, 4)}.`}
        </DialogDescription>

        <form
          className="mt-3 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {!entry && (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className={label}>Slag</span>
                <select aria-label="Slag" value={kind} onChange={(e) => setKind(e.target.value as PensionKind)} className={cn(field, "mt-0.5")}>
                  {(Object.keys(KIND_NAMES) as PensionKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_NAMES[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={label}>Förvaltare</span>
                <input aria-label="Förvaltare" placeholder="Exempelbolaget Pension" value={provider} onChange={(e) => setProvider(e.target.value)} className={cn(field, "mt-0.5")} />
              </label>
              <label className="block">
                <span className={label}>Namn</span>
                <input aria-label="Namn" placeholder="Avtalspension SAF-LO" value={name} onChange={(e) => setName(e.target.value)} className={cn(field, "mt-0.5")} />
              </label>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className={label}>Värde (kr)</span>
              <input
                aria-label="Värde"
                inputMode="decimal"
                placeholder={fundsOre !== null ? krText(fundsOre) : ""}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={cn(field, "mt-0.5 text-right tabular-nums")}
              />
              {fundsOre !== null && amount.trim() === "" && <span className="mt-0.5 block text-xs text-subtle">Fondernas summa används.</span>}
            </label>
            <label className="block">
              <span className={label}>Gällde den</span>
              <input aria-label="Värdedatum" type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} className={cn(field, "mt-0.5")} />
            </label>
            <label className="block">
              <span className={label}>Status</span>
              <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as PensionEntry["status"])} className={cn(field, "mt-0.5")}>
                <option value="active">Aktiv, det betalas in</option>
                <option value="closed">Avslutad, inget betalas in</option>
              </select>
            </label>
            <label className="block">
              <span className={label}>Senaste premie (kr/mån, valfritt)</span>
              <input aria-label="Premie" inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value)} className={cn(field, "mt-0.5 text-right tabular-nums")} />
            </label>
            <label className="block">
              <span className={label}>Premiens datum</span>
              <input aria-label="Premiens datum" type="date" value={premiumDate} onChange={(e) => setPremiumDate(e.target.value)} className={cn(field, "mt-0.5")} />
            </label>
            <label className="block">
              <span className={label}>Uttag från (år, valfritt)</span>
              <input aria-label="Uttag från ålder" inputMode="numeric" value={payoutFromAge} onChange={(e) => setPayoutFromAge(e.target.value)} className={cn(field, "mt-0.5 tabular-nums")} />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input type="checkbox" checked={placeable} onChange={(e) => setPlaceable(e.target.checked)} />
              Placerbar — du väljer själv fonderna
            </label>
            <label className="block sm:col-span-3">
              <span className={label}>Anteckning (valfri)</span>
              <input aria-label="Anteckning" value={note} onChange={(e) => setNote(e.target.value)} className={cn(field, "mt-0.5")} />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Fonder</h3>
              <Button type="button" size="sm" variant="ghost" onClick={() => setFunds((fs) => [...fs, emptyFund])}>
                <Plus /> Lägg till fond
              </Button>
            </div>
            {funds.length === 0 ? (
              <p className="mt-1 text-xs text-subtle">Inga fonder. Traditionell förvaltning och inkomstpensionen har inga att fylla i.</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-subtle">Listan ersätter den sparade. Fyll i andelarna och antingen kursen eller värdet — det andra räknas fram.</p>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-1 pr-2 font-normal">Fond</th>
                      <th className="pb-1 pr-2 font-normal">Andelar</th>
                      <th className="pb-1 pr-2 font-normal">Kurs (kr)</th>
                      <th className="pb-1 pr-2 font-normal">Värde (kr)</th>
                      <th className="pb-1 pr-2 font-normal">Avgift %</th>
                      <th className="pb-1 pr-2 font-normal">Region</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {funds.map((f, i) => (
                      <tr key={i} className="align-top">
                        <td className="py-1 pr-2">
                          <input aria-label={`Fond ${i + 1}, namn`} value={f.fundName} onChange={(e) => setFund(i, { fundName: e.target.value })} className={field} />
                        </td>
                        <td className="w-24 py-1 pr-2">
                          <input aria-label={`Fond ${i + 1}, andelar`} inputMode="decimal" placeholder={f.prevUnits} value={f.units} onChange={(e) => setFund(i, { units: e.target.value })} className={cn(field, "text-right tabular-nums")} />
                        </td>
                        <td className="w-20 py-1 pr-2">
                          <input aria-label={`Fond ${i + 1}, kurs`} inputMode="decimal" value={f.nav} onChange={(e) => setFund(i, { nav: e.target.value })} className={cn(field, "text-right tabular-nums")} />
                        </td>
                        <td className="w-24 py-1 pr-2">
                          <input
                            aria-label={`Fond ${i + 1}, värde`}
                            inputMode="decimal"
                            placeholder={fundOre(f) !== null && f.amount.trim() === "" ? krText(fundOre(f)) : ""}
                            value={f.amount}
                            onChange={(e) => setFund(i, { amount: e.target.value })}
                            className={cn(field, "text-right tabular-nums")}
                          />
                        </td>
                        <td className="w-16 py-1 pr-2">
                          <input aria-label={`Fond ${i + 1}, avgift`} inputMode="decimal" value={f.fee} onChange={(e) => setFund(i, { fee: e.target.value })} className={cn(field, "text-right tabular-nums")} />
                        </td>
                        <td className="w-24 py-1 pr-2">
                          <select aria-label={`Fond ${i + 1}, region`} value={f.region} onChange={(e) => setFund(i, { region: e.target.value as FundRegion })} className={field}>
                            {(Object.keys(REGION_NAMES) as FundRegion[]).map((r) => (
                              <option key={r} value={r}>
                                {REGION_NAMES[r]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1">
                          <button type="button" aria-label={`Ta bort fond ${i + 1}`} onClick={() => setFunds((fs) => fs.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted hover:text-danger">
                            <X className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
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
