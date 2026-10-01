import { useCallback, useEffect, useMemo, useState } from "react";
import { getJson, type Account, type ReviewCounts, type Settings } from "../../api";
import { useCategories } from "../../categories";
import { notify, type ToastMessage } from "../../components/Toast";
import { refreshBadges } from "../../shell/badges";
import { HeaderTabs } from "../../shell/PageHeader";
import { navigate, useSubPath } from "../../shell/routes";
import { cn } from "../../lib/cn";
import { TransactionsView } from "./TransactionsView";
import { ReviewView } from "./review/ReviewView";
import { DeletedList } from "./DeletedList";

type Tab = "list" | "review" | "deleted";
const SUB: Record<Tab, string> = { list: "", review: "granska", deleted: "borttagna" };

export interface PageContext {
  accounts: Account[];
  categories: ReturnType<typeof useCategories>;
  notify: (t: Omit<ToastMessage, "id">) => void;
  /** Call after anything that changes counts (categorising, deleting, restoring). */
  refreshCounts: () => void;
  openRecurring: (id: number) => void;
  partnerName: string;
}

/** Transaktioner, Att granska (/transaktioner/granska) and Borttagna (/transaktioner/borttagna). */
export function TransactionsPage({ onOpenRecurring }: { onOpenRecurring: (id: number) => void }) {
  const sub = useSubPath();
  const tab: Tab = sub === "granska" ? "review" : sub === "borttagna" ? "deleted" : "list";
  const [accounts, setAccounts] = useState<Account[]>([]);
  const categories = useCategories();
  const [counts, setCounts] = useState<ReviewCounts | null>(null);
  const [partnerName, setPartnerName] = useState("partnern");

  const refreshCounts = useCallback(() => {
    getJson<ReviewCounts>("/review/counts").then(setCounts);
    refreshBadges();
  }, []);
  useEffect(() => {
    getJson<Account[]>("/accounts").then(setAccounts);
    getJson<Settings>("/settings").then((s) => setPartnerName(s.partnerName));
    refreshCounts();
  }, [refreshCounts]);

  const ctx = useMemo<PageContext>(
    () => ({ accounts, categories, notify, refreshCounts, openRecurring: onOpenRecurring, partnerName }),
    [accounts, categories, refreshCounts, onOpenRecurring, partnerName],
  );

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "list", label: "Alla" },
    { id: "review", label: "Att granska", badge: counts ? counts.uncategorized + counts.duplicates : undefined },
    { id: "deleted", label: "Borttagna", badge: counts?.deleted || undefined },
  ];

  return (
    <div className="space-y-4">
      {/* Design v2's segmented look, right after the title; Att granska's count in orange. */}
      <HeaderTabs>
        <nav className="flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-segment p-[3px] text-[13px]" aria-label="Transaktioner">
          {tabs.map((t) => (
            <a
              key={t.id}
              href={`/transaktioner${SUB[t.id] ? `/${SUB[t.id]}` : ""}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigate("transactions", SUB[t.id] ? { sub: SUB[t.id] } : {});
              }}
              aria-current={tab === t.id ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-ink transition-colors",
                tab === t.id ? "bg-segment-on font-semibold shadow-segment" : "hover:bg-segment-on/50",
              )}
            >
              {t.label}
              {t.badge !== undefined && t.badge > 0 && (
                <span
                  data-badge={t.id}
                  className={cn(
                    "min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-semibold leading-[18px] tabular-nums",
                    t.id === "review" ? "bg-caution text-white" : "bg-ink/10 text-ink-2",
                  )}
                >
                  {t.badge}
                </span>
              )}
            </a>
          ))}
        </nav>
      </HeaderTabs>

      {categories.length > 0 &&
        (tab === "list" ? (
          <TransactionsView ctx={ctx} />
        ) : tab === "review" ? (
          <ReviewView ctx={ctx} counts={counts} />
        ) : (
          <DeletedList ctx={ctx} />
        ))}
    </div>
  );
}
