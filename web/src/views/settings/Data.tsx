import { useState } from "react";
import { Braces, DatabaseBackup, FileSpreadsheet } from "lucide-react";
import { sendJson, type Health } from "../../api";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { BUTTON, SettingsCard } from "./ui";

export interface Backup {
  name: string;
  kind: string;
  createdAt: string;
  size: number;
}
export interface Backups {
  dir: string;
  backups: Backup[];
}

export const DATA_TEXT = { title: "Data", hint: "databasen, export och säkerhetskopior" };

const KIND: Record<string, { label: string; tone: string }> = {
  start: { label: "vid start", tone: "bg-card-inset text-ink-2" },
  "fore-migrering": { label: "före uppdatering", tone: "bg-caution-soft text-caution-text" },
  manuell: { label: "manuell", tone: "bg-accent-soft text-accent" },
  natt: { label: "natt", tone: "bg-purple-soft text-purple-text" },
};

/** The latest backup older than this (days) badges Data. */
export const BACKUP_STALE_DAYS = 2;
export const backupStale = (b: Backups | null, now = Date.now()) =>
  !!b && (b.backups.length === 0 || now - Math.max(...b.backups.map((x) => Date.parse(x.createdAt))) > BACKUP_STALE_DAYS * 86_400_000);

/**
 * Data (Design v2): the database's path and what is in it in the heading,
 * the exports and 'Säkerhetskopiera nu' to the right, the five latest
 * backups with their kind as a pill, and where they are and how they are
 * kept in the footer with 'Visa alla N'.
 */
export function Data({ health, backups, setBackups, match }: { health: Health | null; backups: Backups | null; setBackups: (b: Backups) => void; match: (...texts: string[]) => boolean }) {
  const [all, setAll] = useState(false);
  if (!match(DATA_TEXT.title, DATA_TEXT.hint, "säkerhetskopia", "export", "JSON", "CSV")) return null;
  const backupNow = async () => {
    try {
      const r = await sendJson<{ name: string; backups: Backup[] }>("POST", "/data/backups", {});
      if (backups) setBackups({ ...backups, backups: r.backups });
      notify({ text: `Säkerhetskopian ${r.name} är skapad.` });
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };
  const shown = backups ? (all ? backups.backups : backups.backups.slice(0, 5)) : [];
  return (
    <SettingsCard
      id="data"
      title="Data"
      description={
        health && (
          <>
            <span className="break-all font-mono">{health.databasePath}</span>
            <span className="block">
              {health.counts.transactions} transaktioner · {health.counts.accounts} konton · {health.counts.categories} kategorier · {health.counts.rules} regler
            </span>
          </>
        )
      }
      aside={
        <div className="flex flex-wrap gap-2 @[40rem]:justify-end">
          <a href="/api/data/export?format=json" download className={BUTTON.grey}>
            <Braces className="size-3.5" aria-hidden /> Allt som JSON
          </a>
          <a href="/api/data/export?format=csv" download className={BUTTON.grey}>
            <FileSpreadsheet className="size-3.5" aria-hidden /> Transaktioner som CSV
          </a>
          <button type="button" className={BUTTON.blue} onClick={backupNow}>
            <DatabaseBackup className="size-3.5" aria-hidden /> Säkerhetskopiera nu
          </button>
        </div>
      }
      footer={
        backups && (
          <>
            <span className="min-w-0 break-all">I {backups.dir}. En tas vid varje start (de 14 senaste sparas) och före varje uppdatering av databasen.</span>
            {backups.backups.length > 5 && (
              <button type="button" onClick={() => setAll((a) => !a)} className="shrink-0 font-medium text-accent hover:underline">
                {all ? "Visa färre" : `Visa alla ${backups.backups.length}`}
              </button>
            )}
          </>
        )
      }
    >
      {backups && backups.backups.length === 0 && <p className="px-6 py-3 text-[13px] text-ink-3">Inga säkerhetskopior ännu.</p>}
      <ul aria-label="Säkerhetskopior">
        {shown.map((b) => {
          const k = KIND[b.kind] ?? { label: b.kind, tone: "bg-card-inset text-ink-2" };
          return (
            <li key={b.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-hairline px-5 py-2.5 text-[12px] first:border-t-0 sm:px-6 @[40rem]:grid-cols-[8.5rem_7.5rem_minmax(0,1fr)_4rem]">
              <span className="tabular-nums">{new Date(b.createdAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}</span>
              <span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", k.tone)}>{k.label}</span>
              </span>
              <span className="col-span-3 min-w-0 truncate font-mono text-[11px] text-ink-3 @[40rem]:col-span-1" title={b.name}>
                {b.name}
              </span>
              <span className="col-start-3 row-start-1 text-right text-ink-2 tabular-nums @[40rem]:col-start-4">{(b.size / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB</span>
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}
