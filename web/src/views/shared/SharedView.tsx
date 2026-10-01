import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import { getJson, type SharedMonth } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { KeyHint } from "../../components/KeyHint";
import { notify } from "../../components/Toast";
import { Button } from "../../components/ui/button";
import { isTyping } from "../../shell/hotkeys";
import { openTransactions } from "../../shell/openTransactions";
import { HeaderActions } from "../../shell/PageHeader";
import { setSearch, useSearch } from "../../shell/routes";
import { Group, ListHeader, PartnerPaidList, PartnerPaidPanel, SwishList, groupTitle, type Act } from "./SharedLists";
import { Card } from "../../components/Card";
import { monthLabel, settlementSummary } from "./summary";
import { Notices } from "./Notices";
import { Hero } from "./Hero";
import { Receipt } from "./Receipt";
import { History } from "./History";

const pad = (n: number) => String(n).padStart(2, "0");
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const shiftMonth = (m: string, delta: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

/**
 * Delad ekonomi per month, by the day money leaves my account: the result
 * with its calculation, the last six months' settlements, what I paid and
 * what the partner paid side by side, and the Swish between us. The month
 * lives in the URL (?manad=2026-08); ←/→ and T move, N adds what she paid.
 */
export function SharedView() {
  const params = new URLSearchParams(useSearch());
  const current = thisMonth();
  const requested = params.get("manad");
  const month = requested && /^\d{4}-\d{2}$/.test(requested) && requested <= current ? requested : current;
  const go = (m: string) => setSearch(m === current ? "" : `?manad=${m}`);
  const [data, setData] = useState<SharedMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);

  const load = useCallback(() => {
    getJson<SharedMonth>(`/shared/${month}`).then(setData, (e) => setError(String(e)));
  }, [month]);
  useEffect(load, [load]);

  const act: Act = async (fn) => {
    setError(null);
    try {
      await fn();
      load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const copy = async () => {
    if (!data) return;
    const text = settlementSummary(data);
    try {
      await navigator.clipboard.writeText(text);
      notify({ text: "Sammanfattningen är kopierad." });
    } catch {
      notify({ text });
    }
  };

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.defaultPrevented || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    if (e.key === "ArrowLeft") return e.preventDefault(), go(shiftMonth(month, -1));
    if (e.key === "ArrowRight" && month < current) return e.preventDefault(), go(shiftMonth(month, 1));
    if (e.key === "t") return e.preventDefault(), go(current);
    if (e.key === "n" && data) return e.preventDefault(), setPanel(true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = data && data.month === month ? data : null;
  return (
    <div className="space-y-6">
      <HeaderActions>
        {/* Design v2's segmented look: ‹ the month › */}
        <div className="flex h-9 items-center gap-0.5 rounded-[10px] bg-segment p-[3px]">
          <button type="button" onClick={() => go(shiftMonth(month, -1))} aria-label="Föregående månad" className="grid h-full w-7 place-items-center rounded-lg text-ink-2 hover:bg-segment-on/50 hover:text-ink">
            <ChevronLeft className="size-4" />
          </button>
          <span className="flex h-full min-w-36 items-center justify-center rounded-lg bg-segment-on px-3 text-[13px] font-semibold text-ink shadow-segment">{monthLabel(month, true)}</span>
          <button
            type="button"
            onClick={() => go(shiftMonth(month, 1))}
            disabled={month >= current}
            aria-label="Nästa månad"
            className="grid h-full w-7 place-items-center rounded-lg text-ink-2 hover:bg-segment-on/50 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {month !== current && (
          <Button size="sm" variant="ghost" onClick={() => go(current)} className="h-9 rounded-[10px] text-[13px]">
            I dag
          </Button>
        )}
        <Button size="sm" onClick={copy} disabled={!shown} className="h-9 rounded-[10px] border-0 bg-card px-3.5 text-[13px] font-semibold text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)] hover:bg-card-inset">
          Kopiera sammanfattning
        </Button>
        <KeyHint keys={["n"]} label={`Lägg till något ${shown?.partnerName ?? "partnern"} betalat`}>
          <Button size="sm" onClick={() => setPanel(true)} disabled={!shown} className="h-9 rounded-[10px] border-0 bg-accent px-3.5 text-[13px] font-semibold text-white hover:bg-accent-hover">
            <Plus /> {shown?.partnerName ?? "Partnern"} har betalat
          </Button>
        </KeyHint>
      </HeaderActions>

      {error && <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      {shown && (
        <>
          <Notices data={shown} />
          <div className="@container">
            <section className="grid gap-4 @[56rem]:grid-cols-12">
              <div className="flex min-w-0 @[56rem]:col-span-7 [&>*]:flex-1">
                <Hero data={shown} act={act} />
              </div>
              <div className="flex min-w-0 @[56rem]:col-span-5 [&>*]:flex-1">
                <Receipt data={shown} />
              </div>
            </section>
          </div>
          <History data={shown} act={act} onPick={go} />
          <div className="@container">
            <section className="grid items-start gap-4 @[56rem]:grid-cols-2">
              <div className="space-y-2">
                <Card aria-labelledby="i-paid-title" className="overflow-hidden p-0 sm:p-0">
                  <ListHeader id="i-paid-title" title="Delat som jag betalat" total={-shown.iPaid.total} />
                  {shown.iPaid.groups.length === 0 && (
                    <div className="border-t border-hairline">
                      <EmptyState
                        icon={Users}
                        title="Inga delade utgifter den här månaden"
                        className="py-8"
                        action={<Button onClick={() => openTransactions({ period: shown.month })}>Visa månadens transaktioner</Button>}
                      >
                        Markera ett köp som delat med <b>S</b> i Transaktioner, så dyker det upp här.
                      </EmptyState>
                    </div>
                  )}
                  {shown.iPaid.groups.map((g) => (
                    <Group key={g.key} title={groupTitle(g)} total={g.total} rows={g.rows} />
                  ))}
                  {shown.forPartner.rows.length > 0 && (
                    <Group title={`${shown.partnerName}s köp som jag betalat (${shown.partnerName} betalar hela)`} total={shown.forPartner.total} rows={shown.forPartner.rows} />
                  )}
                </Card>
                <p className="px-1 text-[11px] text-ink-3">
                  Varje post räknas den dag pengarna lämnar ditt konto: Norwegian-köp när fakturan de ligger på betalas (köp 16:e–15:e, betalas den 25:e), fasta
                  utgifter på dragningsdagen och Swedbank-rader på bokföringsdagen.
                </p>
              </div>
              <div className="space-y-4">
                <Card aria-labelledby="partner-paid-title" className="overflow-hidden p-0 sm:p-0">
                  <ListHeader id="partner-paid-title" title={`${shown.partnerName} har betalat`} total={-(shown.partnerPaid.total + shown.forMe.total)} />
                  <PartnerPaidList data={shown} act={act} onAdd={() => setPanel(true)} />
                </Card>
                <Card aria-labelledby="transfers-title" className="overflow-hidden p-0 sm:p-0">
                  <div className="px-5 py-4 sm:px-6">
                    <h2 id="transfers-title" className="text-base font-semibold">
                      Överföringar mellan oss
                    </h2>
                  </div>
                  <SwishList data={shown} act={act} direction="from" />
                  <SwishList data={shown} act={act} direction="to" />
                  <p className="border-t border-hairline px-5 py-4 text-[11px] text-ink-3 sm:px-6">
                    Swish i kategorierna Inkomst › Från partner och Till partner. <b>Räkna inte</b> en Swish som reglerade något för sig, t.ex. din halva av ett delat
                    köp som {shown.partnerName} betalade på sitt kort. Vill du att köpet också syns i hushållets statistik: lägg in det under{" "}
                    <i>{shown.partnerName} har betalat</i> i stället och låt Swishen räknas.
                  </p>
                </Card>
              </div>
            </section>
          </div>
          <PartnerPaidPanel data={shown} open={panel} onOpenChange={setPanel} onSaved={load} />
        </>
      )}
    </div>
  );
}
