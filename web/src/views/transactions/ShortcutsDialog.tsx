import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { Kbd } from "../../components/KeyHint";

export type ShortcutGroups = { group: string; items: { keys: string[][]; label: string }[] }[];

/** Every shortcut in the transaction list, as the '?' box shows them. */
export const TX_SHORTCUTS: ShortcutGroups = [
  {
    group: "Flytta",
    items: [
      { keys: [["↓"], ["j"]], label: "Nästa rad" },
      { keys: [["↑"], ["k"]], label: "Föregående rad" },
      { keys: [["Home"], ["End"]], label: "Första / sista raden" },
      { keys: [["enter"]], label: "Öppna detaljpanelen (följer med när du flyttar)" },
      { keys: [["esc"]], label: "Stäng panel, väljare eller regelfråga, sedan avmarkera" },
    ],
  },
  {
    group: "Markera",
    items: [
      { keys: [["x"]], label: "Markera raden" },
      { keys: [["shift", "x"]], label: "Markera allt från förra markeringen hit" },
      { keys: [["mod", "a"]], label: "Markera alla rader i listan" },
    ],
  },
  {
    group: "Ändra (markerade rader, annars raden du står på)",
    items: [
      { keys: [["c"]], label: "Kategori (1–9 väljer ett förslag)" },
      { keys: [["s"]], label: "Delat / eget" },
      { keys: [["p"]], label: "Privat" },
      { keys: [["u"]], label: "Vet ej (Övrigt › Okänt, ingen regel)" },
      { keys: [["n"]], label: "Anteckning (markerade rader: samma på alla)" },
      { keys: [["l"]], label: "Etikett, döp om (markerade rader: samma namn på alla)" },
      { keys: [["d"], ["Delete"]], label: "Ta bort (med Ångra)" },
      { keys: [["r"]], label: "Skapa regeln som föreslås efter en kategoriändring" },
      { keys: [["mod", "z"]], label: "Ångra (medan meddelandet med Ångra visas)" },
    ],
  },
  {
    group: "Period och sök",
    items: [
      { keys: [["←"], ["→"]], label: "Föregående / nästa månad" },
      { keys: [["t"]], label: "Den här månaden" },
      { keys: [["/"]], label: "Sök (Enter eller Esc tillbaka till listan)" },
      { keys: [["?"]], label: "Den här rutan" },
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
  title = "Kortkommandon i Transaktioner",
  groups = TX_SHORTCUTS,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title?: string;
  groups?: ShortcutGroups;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Fungerar när du inte skriver i ett fält. ⌃1–⌃8 byter vy och ⌘K söker överallt.</DialogDescription>
        <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g.group}>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{g.group}</h3>
              <ul className="space-y-1 text-sm">
                {g.items.map((i) => (
                  <li key={i.label} className="flex items-start gap-3">
                    <span className="flex w-24 shrink-0 flex-wrap gap-1">
                      {i.keys.map((k) => (
                        <Kbd key={k.join("+")} keys={k} />
                      ))}
                    </span>
                    <span>{i.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
