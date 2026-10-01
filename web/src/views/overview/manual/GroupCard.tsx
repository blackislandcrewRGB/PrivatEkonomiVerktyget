import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible as C } from "radix-ui";
import type { ManualDataItem } from "../../../api";
import { Card } from "../../../components/Card";
import { cn } from "../../../lib/cn";
import { Row } from "./Row";
import { foldedByDefault, oldest, summary } from "./status";

const PILL = {
  ok: "bg-positive-soft text-positive-text",
  neutral: "bg-card-inset text-ink-2",
  soon: "bg-caution-soft text-caution-text",
  late: "bg-alarm-soft text-alarm",
} as const;

/** A group's own choice to be open or folded, remembered on this device (null: none made). */
const KEY = (group: string) => `manual.group.${group}`;
export function storedOpen(group: string): boolean | null {
  try {
    const v = localStorage.getItem(KEY(group));
    return v === "open" ? true : v === "closed" ? false : null;
  } catch {
    return null;
  }
}
function storeOpen(group: string, open: boolean) {
  try {
    localStorage.setItem(KEY(group), open ? "open" : "closed");
  } catch {
    // Not remembered beyond this view; fine.
  }
}

/**
 * One group of Att fylla i as a card that folds: its name, a pill summing
 * it up, how old its oldest row is and a chevron. Folded by default when
 * everything in it is up to date or only needed now and then; a group
 * opened or folded by hand stays so. With a status filter on, every group
 * with rows is open (and a fold then isn't remembered).
 */
export function GroupCard({ group, items, thisYear, filtered }: { group: string; items: ManualDataItem[]; thisYear: string; filtered: boolean }) {
  const [choice, setChoice] = useState<boolean | null>(() => storedOpen(group));
  const [openInFilter, setOpenInFilter] = useState(true);
  const open = filtered ? openInFilter : (choice ?? !foldedByDefault(items));
  const setOpen = (o: boolean) => {
    if (filtered) return setOpenInFilter(o);
    setChoice(o);
    storeOpen(group, o);
  };
  const pill = summary(items);
  const age = oldest(items, thisYear);

  return (
    <C.Root open={open} onOpenChange={setOpen} asChild>
      <Card aria-label={group} className="@container py-0 sm:py-0" data-open={open}>
        <h2>
          <C.Trigger className="flex w-full items-center gap-3 py-4 text-left sm:py-5">
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="whitespace-nowrap text-[15px] font-semibold">{group}</span>
              <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", PILL[pill.tone])}>{pill.text}</span>
              {age && <span className="w-full text-xs font-normal text-ink-3 @[36rem]:ml-auto @[36rem]:w-auto">äldst {age}</span>}
            </span>
            <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
          </C.Trigger>
        </h2>
        <C.Content>
          <ul className="divide-y divide-hairline border-t border-hairline pb-2">
            {items.map((i) => (
              <Row key={i.key} item={i} thisYear={thisYear} action="link" />
            ))}
          </ul>
        </C.Content>
      </Card>
    </C.Root>
  );
}
