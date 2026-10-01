import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Search } from "lucide-react";
import { getJson, type Account, type Contact, type Health, type IncomeSuggestion, type RecurringIncome, type Settings } from "../../api";
import { HeaderActions } from "../../shell/PageHeader";
import { Accounts } from "./Accounts";
import { Appearance } from "./Appearance";
import { Modules } from "./Modules";
import { CompactList, useOpenSections } from "./compact";
import { BadgeContext } from "./badges";
import { backupStale, Data, type Backups } from "./Data";
import { SECTIONS, type SectionId } from "./sections";
import { fold } from "../categories/treeFilter";
import { SettingsNav } from "./SettingsNav";
import { useSectionHash } from "./useSectionHash";
import { Watch } from "./Watch";
import { CarSection } from "./sections/Car";
import { CashflowSection } from "./sections/Cashflow";
import { ContactsSection } from "./sections/Contacts";
import { DigestSection } from "./sections/Digest";
import { EnduranceSection } from "./sections/Endurance";
import { IncomeSection } from "./sections/Income";
import { ItemsSection } from "./sections/Items";
import { PartnerSection } from "./sections/Partner";
import { PensionSection } from "./sections/Pension";
import { PricesSection } from "./sections/Prices";
import { ReferenceSection } from "./sections/Reference";
import { SalarySection } from "./sections/Salary";
import { TaxReturnsSection } from "./sections/TaxReturns";

/**
 * Inställningar (Design v2): a section nav on the left (kept in the address,
 * #vakt) and the sections on the right in the nav's order. Utseende, Konton
 * och bankkopplingar, Vakt and Data are cards of their own; the twelve others
 * are rows in one card, each what it is set to in a sentence, folded out in
 * place with a click (?oppen=bil). The search in the header narrows the
 * sections and their rows to what matches by label and explanation.
 */
export function SettingsView() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomes, setIncomes] = useState<RecurringIncome[]>([]);
  const [suggestions, setSuggestions] = useState<IncomeSuggestion[]>([]);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [ownName, setOwnName] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState("partnern");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [backups, setBackups] = useState<Backups | null>(null);
  const [q, setQ] = useState("");
  const { active, go } = useSectionHash();
  const { open, toggle } = useOpenSections();
  // The search: a section or row is shown when its label, explanation or sentence contains it.
  const needle = fold(q.trim());
  const match = useCallback((...texts: string[]) => !needle || texts.some((t) => fold(t).includes(needle)), [needle]);
  const section = (id: string) => ({ open: open.has(id), onToggle: () => toggle(id), match });
  // Which sections are on the page after the search (each decides for itself, with its own data).
  const [shown, setShown] = useState<Set<SectionId> | null>(null);
  useLayoutEffect(() => {
    if (!needle) return setShown(null);
    const next = new Set(SECTIONS.filter((x) => document.getElementById(x.id)).map((x) => x.id));
    setShown((prev) => (prev && prev.size === next.size && [...next].every((x) => prev.has(x)) ? prev : next));
  });
  // What waits, per section: reported by the sections that know (Konton, Lön), the rest from here.
  const [reported, setReported] = useState<Partial<Record<SectionId, number>>>({});
  const report = useCallback((id: SectionId, n: number) => setReported((b) => (b[id] === n ? b : { ...b, [id]: n })), []);
  const badges = { ...reported, inkomster: suggestions.length, data: backupStale(backups) ? 1 : 0 };

  const reload = useCallback(() => {
    getJson<Account[]>("/accounts").then(setAccounts);
    getJson<RecurringIncome[]>("/recurring-income").then(setIncomes);
    getJson<IncomeSuggestion[]>("/recurring-income/suggestions").then(setSuggestions);
    getJson<Settings>("/settings").then((s) => {
      setNumbers(s.partnerSwishNumbers);
      setOwnName(s.ownName);
      setPartnerName(s.partnerName);
    });
    getJson<Contact[]>("/contacts").then(setContacts);
    getJson<Health>("/health").then(setHealth);
    getJson<Backups>("/data/backups").then(setBackups, () => setBackups(null));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 nav:grid-cols-[220px_minmax(0,1fr)] nav:gap-8">
      <HeaderActions>
        <label className="relative max-nav:w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            aria-label="Sök inställning"
            placeholder="Sök inställning"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 w-60 rounded-[10px] bg-segment pl-8 pr-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-accent/30 max-nav:w-full"
          />
        </label>
      </HeaderActions>
      <SettingsNav active={active} badges={badges} matches={shown} onGo={go} />
      <BadgeContext.Provider value={report}>
      <div className="min-w-0 space-y-4">
        {shown !== null && shown.size === 0 && (
          <p className="rounded-card bg-card px-6 py-8 text-center text-[13px] text-ink-3 shadow-card">Ingen inställning matchar "{q.trim()}".</p>
        )}
        <Appearance match={match} />
        <Modules match={match} />
        <Accounts accounts={accounts} onChanged={reload} match={match} />
        <Watch match={match} />
        <CompactList>
          <ItemsSection {...section("prylar")} />
          <CashflowSection {...section("kassaflode")} />
          <EnduranceSection {...section("uthallighet")} />
          <PensionSection {...section("pension")} />
          <ReferenceSection {...section("referensbudget")} />
          <PricesSection {...section("priser")} />
          <DigestSection {...section("veckodigest")} />
          <IncomeSection {...section("inkomster")} incomes={incomes} suggestions={suggestions} accounts={accounts} onChanged={reload} />
          <CarSection {...section("bil")} />
          <SalarySection {...section("lon")} />
          <TaxReturnsSection {...section("deklaration")} />
          <PartnerSection {...section("partner")} numbers={numbers} setNumbers={setNumbers} ownName={ownName} setOwnName={setOwnName} partnerName={partnerName} contacts={contacts} />
          <ContactsSection {...section("kontakter")} contacts={contacts} onChanged={reload} />
        </CompactList>
        <Data health={health} backups={backups} setBackups={setBackups} match={match} />
      </div>
      </BadgeContext.Provider>
    </div>
  );
}
