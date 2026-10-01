import { useEffect, useState } from "react";
import { getJson, sendJson, type WatchKind, type WatchSettings } from "../../api";
import { Switch } from "../../components/Switch";
import { notify } from "../../components/Toast";
import { SettingsCard } from "./ui";

export const WATCH_TEXT = {
  title: "Vakt",
  hint: "efter varje synk och import letar Vakten efter det här och lägger det i Översiktens Att göra, med en samlad notis · avfärdade fynd kommer inte tillbaka",
};

/** What each kind looks for, short. */
export const WATCH_HINT: Record<WatchKind, string> = {
  price_drift: "fast utgift eller abonnemang drog mer än 3 % från det vanliga",
  double_charge: "samma konto, handlare och belopp inom 2 dagar",
  unusual_amount: "rörligt köp över 500 kr och över 3 gånger det vanliga i kategorin (6 mån)",
  new_merchant: "första köpet hos en handlare, över 300 kr",
  missed_charge: "fast utgift syns inte 3 dagar efter sin dag",
  subscription_stopped: "fast utgift har inte dragits två månader i rad",
  yearly_renewal: "årsvis utgift förnyas eller ska vara betald inom sina påminnelsedagar (14)",
  charge_coming: "bevakad prenumeration dras snart (3 dagar före) – den du vill hinna säga upp",
  bet_zone_over: "en gång i månaden, inte en gång per synk",
  prices_stale: "inga kurser på tre dagar",
  fx_missing: "ett innehav kan inte värderas",
  buffer_low: "räcker mindre än 3 månaders utgifter",
  pension_stale: "ett pensionsvärde behöver skrivas av på nytt",
  pension_forecast_stale: "den senaste prognosen från minPension",
  warranty_ending: "garantin på en pryl går ut inom 30 dagar",
  return_deadline: "ångerrätten går ut inom 3 dagar",
  maybe_item: "köp i kategori som brukar vara saker, över tröskeln, som inte hör till någon pryl",
  isk_allowance: "innehav och likvider på ISK över 90 % av årets fribelopp, en gång i månaden",
  tax_return_missing: "ingen deklarationskvittens för förra inkomståret efter 2 maj",
};

/**
 * Vakt (Design v2): every kind of finding as a switch with what it looks
 * for, in two columns, saved at once; 'N av M på' in the heading; the price
 * series not watched (they vary) in the footer, each with 'Bevaka igen'.
 */
export function Watch({ match }: { match: (...texts: string[]) => boolean }) {
  const [data, setData] = useState<WatchSettings | null>(null);
  useEffect(() => {
    getJson<WatchSettings>("/watch/settings").then(setData, () => setData(null));
  }, []);
  if (!data) return null;
  const kinds = Object.keys(data.kinds) as WatchKind[];
  const whole = match(WATCH_TEXT.title, WATCH_TEXT.hint);
  const shown = kinds.filter((k) => whole || match(data.labels[k], WATCH_HINT[k] ?? ""));
  if (shown.length === 0 && !whole) return null;
  const on = kinds.filter((k) => data.kinds[k]).length;
  const toggle = (k: WatchKind, value: boolean) =>
    sendJson<WatchSettings>("PUT", "/watch/settings", { kinds: { [k]: value } }).then(setData, (e) => notify({ text: (e as Error).message }));

  return (
    <SettingsCard
      id="vakt"
      title={WATCH_TEXT.title}
      description={WATCH_TEXT.hint}
      aside={<span className="text-[12px] text-ink-2 tabular-nums">{on} av {kinds.length} på</span>}
      footer={
        data.muted.length > 0 && (
          <>
            <span>
              Priset bevakas inte (varierar): <b className="font-semibold text-ink">{data.muted.map((m) => m.name).join(", ")}</b>
            </span>
            <span className="flex flex-wrap gap-3">
              {data.muted.map((m) => (
                <button
                  key={m.series}
                  type="button"
                  aria-label={data.muted.length === 1 ? "Bevaka igen" : `Bevaka ${m.name} igen`}
                  className="font-medium text-accent hover:underline"
                  onClick={() => sendJson<WatchSettings>("POST", "/watch/unmute", { series: m.series }).then(setData)}
                >
                  {data.muted.length === 1 ? "Bevaka igen" : `Bevaka ${m.name} igen`}
                </button>
              ))}
            </span>
          </>
        )
      }
    >
      <ul className="grid @[40rem]:grid-cols-2 @[40rem]:gap-x-10 @[40rem]:px-6" aria-label="Vaktens regler">
        {shown.map((k) => (
          <li key={k} data-watch={k} className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-2.5 @[40rem]:px-0">
            <span className="min-w-0">
              <span className="block text-[13px]">{data.labels[k]}</span>
              <span className="block text-[11px] leading-snug text-ink-3">{WATCH_HINT[k]}</span>
            </span>
            <Switch checked={data.kinds[k]} onCheckedChange={(v) => toggle(k, v)} label={data.labels[k]}>
              {null}
            </Switch>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
