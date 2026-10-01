import { Puzzle } from "lucide-react";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { MODULE_INFO, type ModuleId } from "../lib/modules";
import { openSettings } from "./routes";

/** What a view of an optional part says when it is opened (a bookmark, a link) while the part is off. */
export function ModuleOff({ module }: { module: ModuleId }) {
  const { label, hint } = MODULE_INFO[module];
  return (
    <EmptyState
      icon={Puzzle}
      title={`${label} är avstängd`}
      action={
        <Button variant="primary" onClick={() => openSettings("moduler")}>
          Slå på under Moduler
        </Button>
      }
    >
      {label} är en valfri del av verktyget: {hint}
    </EmptyState>
  );
}
