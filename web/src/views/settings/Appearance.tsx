import { SegmentedControl } from "../../components/SegmentedControl";
import { Switch } from "../../components/Switch";
import { setThemePreference, useThemePreference, type ThemePreference } from "../../lib/theme";
import { usePrivacy } from "../../privacy";
import { SettingRow, SettingsCard } from "./ui";

export const APPEARANCE_ROWS = [
  { label: "Tema", hint: "sparas i den här webbläsaren" },
  { label: "Visa privata rader", hint: 'annars visas de som en grå rad "Privat" utan beskrivning, belopp och kategori · ⌘K → Visa privata' },
];

/** Utseende: the theme, and whether private rows show (until the page is reloaded). */
export function Appearance({ match }: { match: (...texts: string[]) => boolean }) {
  const theme = useThemePreference();
  const { showPrivate, setShowPrivate } = usePrivacy();
  const [themeRow, privateRow] = APPEARANCE_ROWS;
  // The section's own name lets all its rows through; otherwise each row by its own text.
  const whole = match("Utseende");
  const showTheme = whole || match(themeRow.label, themeRow.hint, "ljust", "mörkt");
  const showPrivateRow = whole || match(privateRow.label, privateRow.hint);
  if (!showTheme && !showPrivateRow) return null;
  return (
    <SettingsCard id="utseende" title="Utseende">
      {showTheme && (
        <SettingRow label={themeRow.label} hint={themeRow.hint}>
          <SegmentedControl<ThemePreference>
            appearance="v2"
            size="sm"
            label="Tema"
            value={theme}
            onChange={setThemePreference}
            options={[
              { value: "system", label: "Följ systemet" },
              { value: "light", label: "Ljust" },
              { value: "dark", label: "Mörkt" },
            ]}
          />
        </SettingRow>
      )}
      {showPrivateRow && (
        <SettingRow label={privateRow.label} hint={privateRow.hint}>
          <Switch checked={showPrivate} onCheckedChange={setShowPrivate} label="Visa privata rader">
            {null}
          </Switch>
        </SettingRow>
      )}
    </SettingsCard>
  );
}
