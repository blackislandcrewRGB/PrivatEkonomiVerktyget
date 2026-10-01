import type { ManualDataItem } from "../../../api";
import { cn } from "../../../lib/cn";
import { requestIntent } from "../../../shell/intents";
import { navigate, scrollToAnchor } from "../../../shell/routes";
import { DOT } from "./StatusFilter";
import { ageText, asOfText, filterOf, STATUS_WORD } from "./status";

export const INPUT: Record<ManualDataItem["input"], string> = {
  upload: "Ladda upp fil",
  amount: "Belopp och datum",
  form: "Formulär",
  fetch: "Hämta med knapp",
  login: "BankID",
  click: "Knapptryck",
  file: "Fil i projektet",
};

/** Goes to where the figure is typed in: the view, its tab, and the card or dialog. */
export function open(link: ManualDataItem["link"]) {
  navigate(link.view, { search: link.search ?? "" });
  if (link.editBalance !== undefined) requestIntent({ kind: "overview.editBalance", accountId: link.editBalance });
  if (link.anchor) scrollToAnchor(link.anchor);
}

/** Uppgift, typ och hur ofta, senast, Fyll i; on a phone a small card. */
const COLUMNS = "@[44rem]:grid @[44rem]:grid-cols-[minmax(0,1fr)_12rem_11rem_6rem] @[44rem]:items-center @[44rem]:gap-x-4";

/**
 * One thing to fill in: what and where it comes from, what kind of input and
 * how often, when it was last given with the status as a dot (its word as
 * the label), and the way there — a blue button where it needs doing, a
 * text link elsewhere (a button on a phone).
 */
export function Row({ item: i, thisYear, action }: { item: ManualDataItem; thisYear: string; action: "button" | "link" }) {
  const word = STATUS_WORD[i.status];
  return (
    <li className={cn("flex flex-col gap-2 py-3.5", COLUMNS)} data-item={i.key}>
      <div className="min-w-0">
        <p className="text-sm font-medium">{i.title}</p>
        <p className="text-[11px] text-ink-3">
          Från: {i.source}
          {i.note && ` · ${i.note}`}
        </p>
      </div>
      <div className="text-xs">
        <span className="text-ink-2">{INPUT[i.input]}</span>
        <span className="text-ink-3 @[44rem]:block">
          <span className="@[44rem]:hidden"> · </span>
          {i.cadence}
        </span>
      </div>
      <div className="flex items-start gap-2 text-xs tabular-nums" aria-label="Senast">
        <span role="img" aria-label={word} title={word} className={cn("mt-1 size-2 shrink-0 rounded-full", DOT[filterOf(i.status)])} data-status={i.status} />
        {i.asOf ? (
          <span>
            <b className="block font-semibold">{asOfText(i.asOf, thisYear)}</b>
            <span className="block text-ink-2">
              {i.ageDays !== null && ageText(i.ageDays)}
              {i.enteredOn && i.enteredOn !== i.asOf && `${i.ageDays !== null ? " · " : ""}ifyllt ${asOfText(i.enteredOn, thisYear)}`}
            </span>
          </span>
        ) : (
          <span className="text-ink-2">{word.toLocaleLowerCase("sv")}</span>
        )}
      </div>
      <div className="@[44rem]:text-right">
        {action === "button" ? (
          <button type="button" onClick={() => open(i.link)} className="h-8 w-full rounded-lg bg-accent text-[13px] font-semibold text-white hover:bg-accent-hover @[44rem]:w-[90px]">
            Fyll i
          </button>
        ) : (
          <button
            type="button"
            onClick={() => open(i.link)}
            className="h-8 w-full rounded-lg bg-card-inset text-[13px] font-medium text-accent hover:underline @[44rem]:h-auto @[44rem]:w-auto @[44rem]:bg-transparent"
          >
            Fyll i<span aria-hidden className="hidden @[44rem]:inline"> ›</span>
          </button>
        )}
      </div>
    </li>
  );
}
