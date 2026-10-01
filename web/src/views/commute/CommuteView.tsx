import { useCallback, useEffect, useState } from "react";
import { getJson, type FuelOverview } from "../../api";
import { notify } from "../../components/Toast";
import { openSettings } from "../../shell/routes";
import { HeaderActions } from "../../shell/PageHeader";
import { Deduction } from "./Deduction";
import { FuelHero } from "./FuelHero";
import { Odometer } from "./Odometer";
import { Receipts } from "./Receipts";
import { ShiftsCard } from "./ShiftsCard";

/** Inställningar › Bil. */
const toCarSettings = () => openSettings("bil");

/**
 * Pendling & bränsle (Design v2): this month's fuel from the number of work
 * shifts (what is left to buy goes into the overview's forecast) beside the
 * travel deduction, the shifts per month as bars and a table, the receipts
 * beside the odometer. Settings and diesel prices are under Inställningar › Bil.
 */
export function CommuteView() {
  const [data, setData] = useState<FuelOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => getJson<FuelOverview>("/fuel").then(setData, (e) => setError(String(e))), []);
  useEffect(() => {
    load();
  }, [load]);
  const fail = (e: unknown) => notify({ text: (e as Error).message });

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return null;
  const s = data.settings;

  return (
    <div className="space-y-5">
      <HeaderActions>
        <p className="text-[12px] text-ink-3">
          {s.kmPerShift} km per pass · {s.otherKmPerMonth} km övrig körning per månad ·{" "}
          <button type="button" className="font-medium text-accent hover:underline" onClick={toCarSettings}>
            ändra
          </button>
        </p>
      </HeaderActions>
      <div className="@container">
        <div className="grid gap-4 @[56rem]:grid-cols-12">
          <div className="flex min-w-0 @[56rem]:col-span-7 [&>*]:flex-1">
            <FuelHero data={data} onPrice={toCarSettings} />
          </div>
          <div className="flex min-w-0 @[56rem]:col-span-5 [&>*]:flex-1">
            <Deduction />
          </div>
        </div>
      </div>

      <ShiftsCard data={data} onChanged={load} onError={fail} />

      <div className="@container">
        <div className="grid items-start gap-4 @[56rem]:grid-cols-12">
          <div className="min-w-0 @[56rem]:col-span-7">
            <Receipts onChanged={load} onError={fail} />
          </div>
          <div className="min-w-0 @[56rem]:col-span-5">
            <Odometer data={data} onChanged={load} onError={fail} />
          </div>
        </div>
      </div>
    </div>
  );
}
