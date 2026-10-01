import type { ReviewCounts } from "../../../api";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { setSearch, useSearch } from "../../../shell/routes";
import type { PageContext } from "../TransactionsPage";
import { Duplicates } from "./Duplicates";
import { ReviewInbox } from "./ReviewInbox";

type Tab = "groups" | "duplicates";

/** Att granska: the inbox of uncategorised merchants, and possible duplicates (?flik=dubbletter). */
export function ReviewView({ ctx, counts }: { ctx: PageContext; counts: ReviewCounts | null }) {
  const search = useSearch();
  const tab: Tab = new URLSearchParams(search).get("flik") === "dubbletter" ? "duplicates" : "groups";
  return (
    <div className="space-y-4">
      <SegmentedControl<Tab>
        label="Att granska"
        value={tab}
        onChange={(t) => setSearch(t === "duplicates" ? "?flik=dubbletter" : "")}
        options={[
          { value: "groups", label: `Okategoriserade${counts ? ` (${counts.uncategorized})` : ""}` },
          { value: "duplicates", label: `Möjliga dubbletter${counts ? ` (${counts.duplicates})` : ""}` },
        ]}
      />
      {tab === "groups" ? <ReviewInbox ctx={ctx} /> : <Duplicates ctx={ctx} />}
    </div>
  );
}
