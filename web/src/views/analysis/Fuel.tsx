import { useEffect, useState } from "react";
import { getJson, type FuelMonth, type FuelSettings } from "../../api";
import type { ViewProps } from "./AnalysisView";
import { FuelFigures } from "./fuel/FuelFigures";
import { FuelBars } from "./fuel/FuelBars";
import { FuelTable } from "./fuel/FuelTable";
import { useWidth } from "../../lib/useWidth";


/**
 * Bränsle (Design v2): fuel bought per month, what a shift cost and l/100 km
 * from what was bought and the km the shifts give. Winter shows as a higher
 * consumption. Always the whole amount (the car isn't shared).
 */
export function Fuel({ from, to }: ViewProps) {
  const [data, setData] = useState<{ settings: FuelSettings; months: FuelMonth[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [measure, width] = useWidth(1000);
  useEffect(() => {
    let alive = true;
    getJson<{ settings: FuelSettings; months: FuelMonth[] }>(`/fuel/history?from=${from.slice(0, 7)}&to=${to.slice(0, 7)}`).then(
      (d) => alive && setData(d),
      (e) => alive && setError(String(e)),
    );
    return () => {
      alive = false;
    };
  }, [from, to]);
  if (error) return <p className="text-alarm">{error}</p>;
  if (!data) return null;

  const months = data.months;
  return (
    <div ref={measure} className="@container space-y-4">
      <FuelFigures months={months} base={data.settings.baseConsumption} />
      <FuelBars months={months} base={data.settings.baseConsumption} narrow={width < 560} />

      <FuelTable months={months} base={data.settings.baseConsumption} />
    </div>
  );
}
