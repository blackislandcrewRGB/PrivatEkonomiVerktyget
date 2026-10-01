import { useEffect, useId, useState, type ReactNode } from "react";
import { ExternalLink, FileText, Package, Trash2 } from "lucide-react";
import {
  getJson,
  parseKr,
  sendJson,
  shortDate,
  type ItemDetail,
  type ItemOwner,
  type ItemStatus,
} from "../../api";
import { AnimatedAmount } from "../../components/AnimatedAmount";
import { Amount } from "../../components/Amount";
import { MerchantIcon } from "../../components/MerchantIcon";
import { SegmentedControl } from "../../components/SegmentedControl";
import { SidePanel } from "../../components/SidePanel";
import { Button } from "../../components/ui/button";
import { notify } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { longDate } from "../../lib/format";
import { openTransactions } from "../../shell/openTransactions";
import { AttachmentDrop } from "./AttachmentDrop";

/**
 * One pryl, with everything about it editable where it stands: the picture,
 * what it cost, what is left of the warranty and of the right to send it
 * back, the receipt, the transactions that paid for it and what it has cost
 * per day of owning it.
 *
 * Every field saves when you leave it, and only when it actually changed —
 * the same way the transaction panel works.
 */

const field = "h-8 w-full rounded-md border border-border bg-surface px-2 text-sm outline-none focus:border-ring";

export const STATUS_LABELS: Record<ItemStatus, string> = { owned: "Ägd", sold: "Såld", returned: "Returnerad", broken: "Trasig" };

const kronor = (ore: number) => (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2 });

/** Whole days from today to a date; negative once it has passed. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/**
 * What the thing has cost per day of owning it: the price over the days since
 * the purchase, or, once it is sold, what it really cost (price − what it
 * went for) over the days it was owned. The day of the purchase counts as one.
 */
export function costPerDayOre(
  item: Pick<ItemDetail, "priceOre" | "purchaseDate" | "soldPriceOre" | "soldDate">,
  today: string,
): { ore: number; days: number } | null {
  const end = item.soldDate ?? today;
  const days = Math.max(1, daysUntil(end, item.purchaseDate) + 1);
  const cost = item.soldDate ? item.priceOre - (item.soldPriceOre ?? 0) : item.priceOre;
  if (days <= 0) return null;
  return { ore: Math.round(cost / days), days };
}

export function ItemPanel({
  itemId,
  today,
  partnerName,
  onClose,
  onChanged,
}: {
  itemId: number | null;
  today: string;
  partnerName: string;
  onClose: () => void;
  /** After a change that the list also shows (price, name, picture, removal). */
  onChanged: () => void;
}) {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [tick, setTick] = useState(0);
  const listId = useId();

  useEffect(() => {
    if (itemId === null) return setItem(null);
    let live = true;
    getJson<ItemDetail>(`/items/${itemId}`).then(
      (d) => live && setItem(d),
      () => live && setItem(null),
    );
    return () => {
      live = false;
    };
  }, [itemId, tick]);

  const reload = () => {
    setTick((n) => n + 1);
    onChanged();
  };

  /** Saves one field, but only when it really changed. */
  const save = async (patch: Record<string, unknown>) => {
    if (!item) return;
    if (Object.entries(patch).every(([k, v]) => (item as unknown as Record<string, unknown>)[k] === v)) return;
    try {
      await sendJson("PATCH", `/items/${item.id}`, patch);
      reload();
    } catch (e) {
      notify({ text: (e as Error).message });
      setTick((n) => n + 1);
    }
  };

  const remove = async () => {
    if (!item) return;
    try {
      await sendJson("DELETE", `/items/${item.id}`, {});
      onClose();
      onChanged();
      notify({
        text: `${item.name} är borttagen.`,
        action: {
          label: "Ångra",
          run: () => {
            void sendJson("POST", `/items/${item.id}/restore`, {}).then(onChanged);
          },
        },
      });
    } catch (e) {
      notify({ text: (e as Error).message });
    }
  };

  const cost = item ? costPerDayOre(item, today) : null;
  const warrantyLeft = item?.warrantyEndsOn ? daysUntil(item.warrantyEndsOn, today) : null;
  const returnLeft = item?.returnDeadline ? daysUntil(item.returnDeadline, today) : null;

  return (
    <SidePanel
      modal={false}
      open={itemId !== null}
      onOpenChange={(o) => !o && onClose()}
      title={item?.name ?? ""}
      description={item ? `${longDate(item.purchaseDate)}${item.merchant ? ` · ${item.merchant}` : ""}` : undefined}
      footer={
        item && (
          <>
            <Button variant="danger" size="sm" onClick={() => void remove()}>
              <Trash2 /> Ta bort
            </Button>
            <span className="flex-1" />
            {item.purchaseUrl && (
              <a
                href={item.purchaseUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-sm text-link hover:underline"
              >
                Öppna köplänken <ExternalLink className="size-3.5" />
              </a>
            )}
          </>
        )
      }
    >
      {item && (
        <div className="space-y-6 text-sm">
          <Picture item={item} />

          <div>
            <div className="flex items-center gap-2">
              <input
                aria-label="Pris"
                defaultValue={kronor(item.priceOre)}
                key={`price-${item.id}-${item.priceOre}`}
                inputMode="decimal"
                onBlur={(e) => {
                  const ore = parseKr(e.target.value);
                  if (ore === null) {
                    notify({ text: "Skriv priset som ett tal, till exempel 4 490." });
                    e.target.value = kronor(item.priceOre);
                    return;
                  }
                  void save({ priceOre: ore });
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                className="w-40 rounded-md border border-border bg-surface px-2 py-1 text-xl font-semibold tabular-nums"
              />
              <span className="text-muted">kr</span>
            </div>
            {cost && (
              <p className="mt-1.5 text-muted">
                <AnimatedAmount ore={cost.ore} kind="neutral" size="sm" /> per dag i {cost.days} {cost.days === 1 ? "dag" : "dagar"}
                {item.soldDate && item.soldPriceOre !== null ? " (efter att den såldes)" : ""}
              </p>
            )}
          </div>

          <dl className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
            <Field label="Namn">
              <input
                aria-label="Namn"
                className={field}
                defaultValue={item.name}
                key={`name-${item.id}-${item.name}`}
                onBlur={(e) => void save({ name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </Field>
            <Field label="Köpt">
              <input
                type="date"
                aria-label="Köpt"
                className={field}
                defaultValue={item.purchaseDate}
                key={`date-${item.id}-${item.purchaseDate}`}
                onBlur={(e) => e.target.value && void save({ purchaseDate: e.target.value })}
              />
            </Field>
            <Field label="Kategori">
              <input
                aria-label="Kategori"
                className={field}
                list={listId}
                placeholder="Fritt, eller välj"
                defaultValue={item.category ?? ""}
                key={`cat-${item.id}-${item.category}`}
                onBlur={(e) => void save({ category: e.target.value || null })}
              />
              <datalist id={listId}>
                {item.categoryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Handlare">
              <input
                aria-label="Handlare"
                className={field}
                defaultValue={item.merchant ?? ""}
                key={`merchant-${item.id}-${item.merchant}`}
                onBlur={(e) => void save({ merchant: e.target.value || null })}
              />
            </Field>
            <Field label="Köplänk">
              <input
                aria-label="Köplänk"
                className={field}
                type="url"
                inputMode="url"
                placeholder="https://…"
                defaultValue={item.purchaseUrl ?? ""}
                key={`url-${item.id}-${item.purchaseUrl}`}
                onBlur={(e) => void save({ purchaseUrl: e.target.value || null })}
              />
            </Field>
            <Field label="Vems">
              <SegmentedControl<ItemOwner>
                size="sm"
                label="Vems"
                value={item.owner}
                onChange={(owner) => void save({ owner })}
                options={[
                  { value: "me", label: "Min" },
                  { value: "shared", label: "Delad" },
                  { value: "partner", label: `${partnerName}s` },
                ]}
              />
            </Field>
            <Field label="Status">
              <select aria-label="Status" className={field} value={item.status} onChange={(e) => void save({ status: e.target.value })}>
                {(Object.keys(STATUS_LABELS) as ItemStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            {item.status === "sold" && (
              <>
                <Field label="Såld för">
                  <input
                    className={`${field} text-right tabular-nums`}
                    inputMode="decimal"
                    aria-label="Såld för"
                    defaultValue={item.soldPriceOre === null ? "" : kronor(item.soldPriceOre)}
                    key={`sold-${item.id}-${item.soldPriceOre}`}
                    onBlur={(e) => void save({ soldPriceOre: e.target.value.trim() === "" ? null : parseKr(e.target.value) })}
                  />
                </Field>
                <Field label="Såld den">
                  <input
                    type="date"
                    className={field}
                    defaultValue={item.soldDate ?? ""}
                    key={`solddate-${item.id}-${item.soldDate}`}
                    onBlur={(e) => void save({ soldDate: e.target.value || null })}
                  />
                </Field>
              </>
            )}
            <Field label="Garanti" top>
              <div className="flex items-center gap-2">
                <input
                  className={`${field} w-20`}
                  inputMode="numeric"
                  aria-label="Garanti i månader"
                  defaultValue={item.warrantyMonths ?? ""}
                  key={`warranty-${item.id}-${item.warrantyMonths}`}
                  onBlur={(e) => void save({ warrantyMonths: e.target.value.trim() === "" ? null : Number(e.target.value.replace(/\D/g, "")) })}
                />
                <span className="text-muted">mån</span>
              </div>
              {item.warrantyEndsOn && warrantyLeft !== null && (
                <p className={cn("mt-1 text-xs", warrantyLeft < 0 ? "text-muted" : warrantyLeft <= 30 ? "text-danger" : "text-muted")}>
                  {warrantyLeft < 0 ? `Gick ut ${shortDate(item.warrantyEndsOn)}` : `${warrantyLeft} dagar kvar · t.o.m. ${item.warrantyEndsOn}`}
                </p>
              )}
            </Field>
            <Field label="Ångerrätt" top>
              <input
                type="date"
                className={field}
                aria-label="Ångerrätt t.o.m."
                defaultValue={item.returnDeadline ?? ""}
                key={`return-${item.id}-${item.returnDeadline}`}
                onBlur={(e) => void save({ returnDeadline: e.target.value || null })}
              />
              {returnLeft !== null && (
                <p className={cn("mt-1 text-xs", returnLeft < 0 ? "text-muted" : returnLeft <= 3 ? "text-danger" : "text-warning")}>
                  {returnLeft < 0 ? "Har gått ut" : returnLeft === 0 ? "Sista dagen i dag" : `${returnLeft} dagar kvar att ångra köpet`}
                </p>
              )}
            </Field>
            <Field label="Anteckning" top>
              <input
                aria-label="Anteckning"
                className={field}
                placeholder="Lägg till en anteckning"
                defaultValue={item.note ?? ""}
                key={`note-${item.id}-${item.note}`}
                onBlur={(e) => void save({ note: e.target.value || null })}
              />
            </Field>
          </dl>

          <Section title="Bilder och kvitton">
            {item.attachments.length > 0 && (
              <ul className="mb-2 grid grid-cols-3 gap-2">
                {item.attachments.map((a) => (
                  <li key={a.id} className="group relative">
                    <a
                      href={a.url ?? "#"}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={a.originalFilename ?? undefined}
                      className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted"
                    >
                      {a.thumbnailUrl ? (
                        <img src={a.thumbnailUrl} alt={a.originalFilename ?? "Bilaga"} className="size-full object-cover" />
                      ) : (
                        <FileText className="size-6 text-muted" />
                      )}
                    </a>
                    <button
                      type="button"
                      aria-label={`Ta bort ${a.originalFilename ?? "bilagan"}`}
                      onClick={() => {
                        void sendJson("DELETE", `/items/${item.id}/attachments/${a.id}`, {}).then(reload, (e: Error) => notify({ text: e.message }));
                      }}
                      className="absolute right-1 top-1 rounded bg-surface/90 p-1 text-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <AttachmentDrop itemId={item.id} acceptPaste onDone={reload} />
          </Section>

          <Section title="Betald med">
            {item.transactions.length === 0 ? (
              <p className="text-muted">Ingen transaktion är kopplad.</p>
            ) : (
              <ul className="space-y-1">
                {item.transactions.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => openTransactions({ period: "custom", from: t.bookingDate, to: t.bookingDate, q: t.descriptionClean })}
                      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-hover"
                    >
                      <MerchantIcon decorative text={t.descriptionClean} icon={t.icon ?? undefined} size={20} />
                      <span className="min-w-0 flex-1 truncate">{t.label ?? t.descriptionClean}</span>
                      <span className="shrink-0 text-xs text-muted">{shortDate(t.bookingDate)}</span>
                      <Amount ore={t.amount} size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </SidePanel>
  );
}

/** The big picture: the item's own, otherwise the merchant's icon on a plain plate. */
function Picture({ item }: { item: ItemDetail }) {
  const image = item.attachments.find((a) => a.kind === "image");
  if (!image) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted/40">
        {item.icon ? <MerchantIcon decorative text={item.merchant ?? item.name} icon={item.icon} size={40} /> : <Package className="size-8 text-muted" />}
      </div>
    );
  }
  return (
    <a href={image.url ?? "#"} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg border border-border" title="Öppna bilden">
      <img src={image.url ?? image.thumbnailUrl ?? ""} alt={item.name} className="max-h-64 w-full object-contain" />
    </a>
  );
}

function Field({ label, top, children }: { label: string; top?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className={cn("text-muted", top && "self-start pt-1.5")}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}
