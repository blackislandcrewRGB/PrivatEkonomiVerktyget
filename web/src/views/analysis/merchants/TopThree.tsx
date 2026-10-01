import { MerchantIcon } from "../../../components/MerchantIcon";
import { wholeKr } from "../common";
import { merchantName, type Merchant } from "./types";

/**
 * Topplista's first three (Design v2): a card each with the merchant's icon
 * (its own, else its initials) and a black place badge in its corner, the
 * name, the sum and "N köp · X kr per köp". A card opens the transactions.
 */
export function TopThree({ merchants, onOpen }: { merchants: Merchant[]; onOpen: (m: Merchant) => void }) {
  const top = merchants.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <ol className="grid grid-cols-1 gap-3 @[48rem]:grid-cols-3" aria-label="Topp 3">
      {top.map((m, i) => (
        <li key={m.key}>
          <button
            type="button"
            onClick={() => onOpen(m)}
            className="flex w-full min-w-0 items-center gap-4 rounded-[16px] bg-card px-5 py-4 text-left text-ink shadow-card hover:bg-band"
            data-top={i + 1}
          >
            <span className="relative shrink-0">
              <MerchantIcon decorative label={m.label} contact={m.contactName} text={m.texts[0]} icon={m.icon} size={48} shape="square" className="rounded-[12px]" />
              <span className="absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-ink text-[11px] font-bold text-card ring-2 ring-card" aria-label={`plats ${i + 1}`}>
                {i + 1}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold" data-name>{merchantName(m)}</span>
              <span className="block text-[20px] font-bold leading-tight tabular-nums">{wholeKr(m.total)}</span>
              <span className="block text-[11px] text-ink-3 tabular-nums">
                {m.count} köp · {wholeKr(m.avg)} per köp
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
