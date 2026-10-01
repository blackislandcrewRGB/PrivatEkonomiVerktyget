import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getJson, parseKr, sendJson, type Account, type Affordability, type Cashflow as Data, type PlannedPayment } from "../../../api";
import { notify } from "../../../components/Toast";
import { usePersistentState } from "../../../usePersistentState";
import { openSettings, type ViewId } from "../../../shell/routes";
import { useIntent } from "../../../shell/intents";
import { dm } from "../format";
import { AffordCard, EMPTY, type Scenario } from "./AffordCard";
import { CashChart, withScenario } from "./CashChart";
import { DayList } from "./DayList";
import { KeyFigures } from "./KeyFigures";

/** The answer waits this long after the last keystroke before it asks the server. */
const ANSWER_DELAY_MS = 300;

/**
 * Översikt › Kassaflöde: Privatkonto and e-sparkonto day by day 90 days
 * ahead, the lowest point, safe to spend (the lowest point minus the buffer),
 * and Har jag råd?: a purchase (amount, day, text, paid with, shared, from
 * the cash flow or the savings on ISK) drawn dashed on top, with the verdict
 * (green, yellow or red, and why) and the figures before and after. It can be
 * saved as a planned expense (an income too). A purchase on a card is drawn
 * on its invoice's pay day, and a shared one's half comes back with the
 * partner's next payment. ⌘K › Har jag råd? opens it.
 */
export function Cashflow({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const [opts, setOpts] = usePersistentState("cashflow.opts", {
    partner: true,
  });
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>(EMPTY);
  const [cards, setCards] = useState<Account[]>([]);
  const [verdict, setVerdict] = useState<Affordability | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [focusAsked, setFocusAsked] = useState(false);
  useIntent("cashflow.afford", () => setFocusAsked(true));
  useEffect(() => {
    if (!focusAsked || !data) return;
    sectionRef.current?.scrollIntoView?.({ block: "start" });
    amountRef.current?.focus();
    setFocusAsked(false);
  }, [focusAsked, data]);
  useEffect(() => {
    getJson<Account[]>("/accounts").then(
      (list) => setCards(list.filter((a) => a.kind === "credit_card")),
      () => setCards([]),
    );
  }, []);
  const load = useCallback(() => {
    getJson<Data>(`/cashflow${opts.partner ? "" : "?partner=0"}`).then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError((e as Error).message),
    );
  }, [opts.partner]);
  useEffect(load, [load]);

  // The scenario as a signed amount on a day in the window, when it is complete enough to draw.
  const amount = parseKr(scenario.amount);
  const active = !!data && amount !== null && amount > 0 && scenario.date >= data.today && scenario.date <= data.horizon;
  const signed = active ? (scenario.direction === "out" ? -amount! : amount!) : 0;
  const out = scenario.direction === "out";
  const accountId = out && scenario.accountId ? Number(scenario.accountId) : null;
  const shared = out && scenario.shared;
  const fromSavings = out && scenario.funding === "savings";
  // A purchase: the verdict, with when it leaves the bank (a card: the invoice's pay day) and a shared one's half back.
  useEffect(() => {
    if (!active || !out) return setVerdict(null);
    let live = true;
    const q = new URLSearchParams({
      amount: String(amount),
      date: scenario.date,
    });
    if (accountId !== null) q.set("accountId", String(accountId));
    if (shared) q.set("shared", "1");
    if (fromSavings) q.set("funding", "savings");
    if (!opts.partner) q.set("partner", "0");
    const timer = setTimeout(
      () =>
        getJson<Affordability>(`/afford?${q}`).then(
          (r) => live && setVerdict(r),
          () => live && setVerdict(null),
        ),
      ANSWER_DELAY_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, out, amount, scenario.date, accountId, shared, fromSavings, opts.partner, data?.foodOnly]);
  const pay: PlannedPayment | null = verdict && (verdict.payment.card || verdict.payment.partnerDate) ? verdict.payment : null;
  const payDate = pay?.payDate ?? scenario.date;
  // Taken from ISK: the cash flow only sees the half coming back.
  const cashSigned = fromSavings ? 0 : signed;
  const back = pay?.partnerDate && opts.partner ? { date: pay.partnerDate, amount: pay.partnerHalf } : null;
  const series = useMemo(
    () => (data ? withScenario(data.days, active ? [{ date: payDate, amount: cashSigned }, ...(back ? [back] : [])].filter((c) => c.amount !== 0) : []) : []),
    [data, active, payDate, cashSigned, back?.date, back?.amount],
  );
  const drawn = series.some((p) => p.scenario !== undefined);
  const seriesLowest = drawn
    ? series.reduce((lo, d) => ((d.scenario ?? d.balance) < lo.balance ? { date: d.date, balance: d.scenario ?? d.balance } : lo), {
        date: series[0].date,
        balance: series[0].scenario ?? series[0].balance,
      })
    : null;
  // The answer's lowest point when there is one (a purchase), else the curve's (an income).
  const scenarioLowest = verdict && out ? verdict.after.lowest : seriesLowest;

  if (error) return <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>;
  if (!data) return null;

  const save = async () => {
    try {
      const description = scenario.description.trim() || (signed < 0 ? "Planerad utgift" : "Planerad inkomst");
      await sendJson("POST", "/cashflow/planned", {
        date: scenario.date,
        amount: signed,
        description,
        accountId,
        shared,
      });
      // Taken from ISK: the money moved to the bank the day it is paid.
      if (fromSavings)
        await sendJson("POST", "/cashflow/planned", {
          date: payDate,
          amount: -signed,
          description: `Från ISK: ${description}`,
        });
      notify({
        text: `${scenario.description.trim() || "Köpet"} är sparat som planerat ${dm(scenario.date)}${fromSavings ? ", med pengarna från ISK" : ""}.`,
      });
      setScenario(EMPTY);
      load();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  const setFoodOnly = async (foodOnly: boolean) => {
    try {
      await sendJson("PUT", "/cashflow/settings", { foodOnly });
      load();
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  return (
    <div className="space-y-5">
      <KeyFigures data={data} partner={opts.partner} onPartner={(partner) => setOpts({ partner })} onFoodOnly={setFoodOnly} onBuffer={() => openSettings("kassaflode")}>
        <CashChart
          data={data}
          series={series}
          scenario={
            drawn && scenarioLowest
              ? {
                  description: scenario.description.trim() || (out ? "köpet" : "inkomsten"),
                  lowest: scenarioLowest,
                }
              : null
          }
          bankLabel={data.liquid.totalOre > 0 ? "Bankkontona + likvider på Avanza" : "Privatkonto + e-sparkonto"}
        />
      </KeyFigures>

      <AffordCard
        data={data}
        scenario={scenario}
        setScenario={setScenario}
        cards={cards}
        verdict={active && out ? verdict : null}
        active={active}
        onSave={save}
        onChanged={load}
        amountRef={amountRef}
        sectionRef={sectionRef}
        partner={opts.partner}
      />

      <DayList data={data} />
    </div>
  );
}
