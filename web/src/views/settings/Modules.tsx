import { Switch } from "../../components/Switch";
import { notify } from "../../components/Toast";
import { MODULE_INFO, setModule, useModules, type ModuleId } from "../../lib/modules";
import { SettingRow, SettingsCard } from "./ui";

const IDS: ModuleId[] = ["salary", "commute"];

/** Moduler: the optional parts of the tool, off until they are switched on here. They appear in the menu at once. */
export function Modules({ match }: { match: (...texts: string[]) => boolean }) {
  const { modules } = useModules();
  const whole = match("Moduler");
  const shown = IDS.filter((id) => whole || match(MODULE_INFO[id].label, MODULE_INFO[id].hint));
  if (!shown.length) return null;
  return (
    <SettingsCard id="moduler" title="Moduler" description="Valfria delar som är byggda för en viss sorts hushåll. De syns i menyn när de är på.">
      {shown.map((id) => (
        <SettingRow key={id} label={MODULE_INFO[id].label} hint={MODULE_INFO[id].hint}>
          <Switch checked={modules[id]} onCheckedChange={(on) => setModule(id, on).catch((e: Error) => notify({ text: e.message }))} label={MODULE_INFO[id].label}>
            {null}
          </Switch>
        </SettingRow>
      ))}
    </SettingsCard>
  );
}
