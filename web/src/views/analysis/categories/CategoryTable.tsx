import { kronor } from "../../../csv";
import { Switch } from "../../../components/Switch";
import { cn } from "../../../lib/cn";
import { useResolvedTheme } from "../../../lib/theme";
import { useLocalStorage } from "../../../lib/useLocalStorage";
import { CsvButton, Money, monthLabel } from "../common";
import { chartColor } from "./colors";
import { wholeMonths } from "./figures";
import { HEAT_CLASS, heat } from "./heat";
import type { CategoryData, Series } from "./types";

const shortMonth = (m: string) => monthLabel(m).replace(".", "");

/**
 * Per kategori's table (Design v2): a row per category with its months and
 * its average (over the whole months) last, the first column staying put
 * while the months scroll sideways. A cell is toned by how its month stands
 * against the category's average ('Toner', on by default, remembered in
 * this browser); the month so far isn't toned. A cell opens its
 * transactions. The CSV is as before: the months and the sum.
 */
export function CategoryTable({
  data,
  to,
  clickable,
  onOpen,
  csvName,
}: {
  data: CategoryData;
  to: string;
  clickable: boolean;
  onOpen: (s: Series, month: string) => void;
  csvName: string;
}) {
  const [tones, setTones] = useLocalStorage("analysis.tones", true, (v) => (typeof v === "boolean" ? v : null));
  const theme = useResolvedTheme();
  const whole = new Set(wholeMonths(data.months, to));
  const wholeRows = data.data.filter((d) => whole.has(d.month));
  const sum = (key: string) => data.data.reduce((a, d) => a + (d[key] ?? 0), 0);
  const average = (key: string) => (wholeRows.length ? Math.round(wholeRows.reduce((a, d) => a + (d[key] ?? 0), 0) / wholeRows.length) : 0);
  const cell = "whitespace-nowrap px-1 py-1 text-right tabular-nums";

  return (
    <section className="@container overflow-hidden rounded-card bg-card text-ink shadow-card" aria-labelledby="category-table-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-4 sm:px-6">
        <h2 id="category-table-title" className="text-[15px] font-semibold">
          Tabell <span className="text-[12px] font-normal text-ink-3">· färgen visar hur månaden ligger mot kategorins snitt</span>
        </h2>
        <CsvButton
          filename={csvName}
          header={["Kategori", ...data.months, "Summa"]}
          rows={() => [
            ...data.series.map((s) => [s.name, ...data.data.map((d) => kronor(d[s.key])), kronor(sum(s.key))]),
            ["Totalt", ...data.data.map((d) => kronor(d.total)), kronor(sum("total"))],
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" aria-label="Utgifter per kategori och månad">
          <thead>
            <tr className="border-b border-hairline text-[11px] text-ink-3">
              <th className="sticky left-0 z-[1] bg-card py-2 pl-5 pr-3 text-left font-normal sm:pl-6">Kategori</th>
              {data.months.map((m) => (
                <th key={m} className="whitespace-nowrap px-2 py-2 text-right font-normal" data-month-head={m}>
                  {shortMonth(m)}
                  {!whole.has(m) && <span className="block text-[10px] text-ink-3">påbörjad</span>}
                </th>
              ))}
              <th className="whitespace-nowrap py-2 pl-3 pr-5 text-right font-normal sm:pr-6">snitt</th>
            </tr>
          </thead>
          <tbody>
            {data.series.map((s) => {
              const avg = average(s.key);
              return (
                <tr key={s.key} data-row={s.key} className="border-b border-hairline">
                  <td className="sticky left-0 z-[1] whitespace-nowrap bg-card py-1.5 pl-5 pr-3 font-medium sm:pl-6">
                    <span className="mr-2 inline-block size-2 rounded-full align-middle" style={{ background: chartColor(s.color, theme) }} aria-hidden />
                    {s.name}
                  </td>
                  {data.data.map((d) => {
                    const v = d[s.key] ?? 0;
                    const tone = tones && whole.has(d.month) ? heat(v, avg) : null;
                    const content = <Money ore={v} />;
                    return (
                      <td key={d.month} className={cell} data-cell={`${s.key}:${d.month}`} data-heat={tone ?? undefined}>
                        <span className={cn("block rounded-[6px] px-2 py-1", tone && HEAT_CLASS[tone])}>
                          {v && clickable ? (
                            <button type="button" onClick={() => onOpen(s, d.month)} className="hover:underline">
                              {content}
                            </button>
                          ) : (
                            content
                          )}
                        </span>
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap py-1.5 pl-3 pr-5 text-right text-ink-2 tabular-nums sm:pr-6" data-average={s.key}>
                    <Money ore={avg} />
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-ink font-semibold">
              <td className="sticky left-0 z-[1] bg-card py-2 pl-5 pr-3 sm:pl-6">Totalt</td>
              {data.data.map((d) => (
                <td key={d.month} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  <Money ore={d.total} />
                </td>
              ))}
              <td className="whitespace-nowrap py-2 pl-3 pr-5 text-right tabular-nums sm:pr-6" data-average="total">
                <Money ore={average("total")} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline px-5 py-3 text-[11px] text-ink-3 sm:px-6">
        <span>snitt över {wholeRows.length} hela månader</span>
        <span className="flex flex-wrap items-center gap-3">
          {tones && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px] bg-positive-soft ring-1 ring-black/5" aria-hidden /> under snitt
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px] bg-caution-soft ring-1 ring-black/5" aria-hidden /> över snitt
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px] bg-heat-high ring-1 ring-black/5" aria-hidden /> långt över
              </span>
            </>
          )}
          <Switch checked={tones} onCheckedChange={setTones} label="Toner">
            <span className="text-[11px] text-ink-2">Toner</span>
          </Switch>
        </span>
      </div>
    </section>
  );
}
