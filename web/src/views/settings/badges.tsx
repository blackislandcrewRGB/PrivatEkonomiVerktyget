import { createContext, useContext, useEffect } from "react";
import type { SectionId } from "./sections";

/** Where a section tells the nav how many things wait in it (an orange badge). */
export const BadgeContext = createContext<(id: SectionId, n: number) => void>(() => {});

/** Reports this section's waiting count to the nav while it is shown. */
export function useReportBadge(id: SectionId, n: number) {
  const report = useContext(BadgeContext);
  useEffect(() => {
    report(id, n);
  }, [report, id, n]);
}
