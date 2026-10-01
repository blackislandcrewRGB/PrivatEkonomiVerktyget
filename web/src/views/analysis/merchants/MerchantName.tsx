import { categoryPath } from "./Toolbar";
import { merchantName, type Merchant, type MerchantCategory } from "./types";

/** Up to three, then '+N': 'Exempelstad, Exempelby, Exempelvik +2'. */
export function shortList(items: string[], max = 3): string {
  return items.slice(0, max).join(", ") + (items.length > max ? ` +${items.length - max}` : "");
}

/**
 * A row's name: with 'Slå ihop', a row holding several of the bank's texts
 * gets a blue 'N namn' pill. Under it the category, and the towns the bank
 * gave – or, without towns, the bank's texts – shortened.
 */
export function MerchantName({ m, categories }: { m: Merchant; categories: MerchantCategory[] }) {
  const name = merchantName(m);
  const merged = m.texts.length > 1;
  const texts = m.texts.filter((t) => t !== name);
  const where = m.areas.length > 0 ? m.areas : texts;
  const sub = [categoryPath(m.categoryId, categories), merged ? `${m.texts.length} namn` : null, where.length > 0 ? shortList(where) : null].filter(Boolean).join(" · ");
  return (
    <span className="block min-w-0">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium">{name}</span>
        {merged && (
          <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-semibold text-accent" data-pill="names">
            {m.texts.length} namn
          </span>
        )}
      </span>
      {sub && (
        <span className="block truncate text-[11px] text-ink-3" title={[...m.texts, ...m.areas].join(", ")}>
          {sub}
        </span>
      )}
    </span>
  );
}
