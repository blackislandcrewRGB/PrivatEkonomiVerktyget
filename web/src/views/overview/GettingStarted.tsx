import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { getJson, type Account, type ImportCoverage } from "../../api";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import { openSettings, type ViewId } from "../../shell/routes";

/**
 * The first minutes in a database with nothing in it: make the accounts, read in an export from the
 * bank, then give what is left over a category. Shown on Översikt until the first import has been
 * made; each step is ticked off when it is done. Nothing at all when the answers can't be read.
 */
export function GettingStarted({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const [state, setState] = useState<{ accounts: number; imported: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([getJson<Account[]>("/accounts"), getJson<ImportCoverage[]>("/imports/coverage")]).then(
      ([accounts, coverage]) => live && setState({ accounts: accounts.length, imported: coverage.some((c) => c.importedTo !== null) }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  if (!state || state.imported) return null;

  const steps = [
    {
      done: state.accounts > 0,
      title: "Skapa dina konton",
      text: "Ett för varje bankkonto och kreditkort du vill följa. Du väljer hur kontot fylls på: med en CSV-fil från banken, eller med Swedbanks och Bank Norwegians egna filer.",
      action: (
        <Button variant={state.accounts > 0 ? "ghost" : "primary"} size="sm" onClick={() => openSettings("konton")}>
          {state.accounts > 0 ? "Se kontona" : "Skapa konton"}
        </Button>
      ),
    },
    {
      done: false,
      title: "Läs in en export från banken",
      text: "Logga in hos banken som vanligt, exportera transaktionerna som CSV och släpp filen under Importer. Du ser först vad som kommer att hända. Filen sparas inte, bara raderna.",
      action: (
        <Button variant={state.accounts > 0 ? "primary" : "ghost"} size="sm" onClick={() => onNavigate("imports")}>
          Till Importer
        </Button>
      ),
    },
    {
      done: false,
      title: "Sätt kategori på det som blir över",
      text: "Under Transaktioner › Att granska grupperas det som saknar kategori per handlare. Med ”kom ihåg” görs en regel, och nästa import kategoriserar själv.",
    },
    {
      done: false,
      title: "Lägg in fasta utgifter, och partnern om ni delar",
      text: "Hyra, abonnemang och försäkringar under Fasta utgifter; er delning under Delad ekonomi. Då börjar prognosen och avstämningen bli användbara.",
    },
  ];

  return (
    <section aria-labelledby="getting-started" className="space-y-4 rounded-card bg-card p-5 text-ink shadow-card sm:px-6">
      <div>
        <h2 id="getting-started" className="text-[17px] font-semibold">
          Välkommen
        </h2>
        <p className="mt-0.5 text-[13px] text-ink-2">Databasen är tom. Så här kommer du igång, i den ordningen. Allt stannar på din egen dator.</p>
      </div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3.5" data-step-done={s.done || undefined}>
            <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold", s.done ? "bg-positive text-white" : "bg-segment text-ink-2")} aria-hidden>
              {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">{s.title}</p>
              <p className="mt-0.5 text-[12px] text-ink-2">{s.text}</p>
            </div>
            {s.action && <div className="shrink-0">{s.action}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
