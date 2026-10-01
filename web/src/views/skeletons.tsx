import { Skeleton, SkeletonArea } from "../components/Skeleton";

/**
 * What each view looks like while it loads: the same boxes, in the same
 * places, at the same heights as the real thing. Built here rather than in
 * the views themselves so the three of them stay recognisably the same
 * family.
 */

/** Design v2's card (Översikt), without its content. */
const v2card = "min-w-0 rounded-card bg-card p-5 shadow-card sm:px-7 sm:py-6";

/**
 * Översikt: Pengar nu with its bar beside the rings, the tasks, the 14 days
 * beside the balances, and the month's treemap — the cards in the grid they
 * will have.
 */
export function OverviewSkeleton() {
  return (
    <SkeletonArea label="Översikten laddas" className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <section className={`${v2card} space-y-5 lg:col-span-7`}>
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-12 w-52" />
          </div>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-[26px] w-full rounded-[13px]" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </section>
        <section className={`${v2card} flex flex-col items-center gap-5 lg:col-span-5`}>
          <Skeleton className="h-4 w-44 self-start" />
          <Skeleton className="size-40 rounded-full" />
          <Skeleton className="h-16 w-full" />
        </section>
      </div>
      <Skeleton className="h-12 w-full rounded-wallet" />
      <div className="grid gap-5 lg:grid-cols-12">
        <section className={`${v2card} space-y-3 lg:col-span-7`}>
          <Skeleton className="h-4 w-40" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3.5">
              <Skeleton className="h-14 w-16 rounded-[10px]" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </section>
        <section className={`${v2card} space-y-3 lg:col-span-5`}>
          <Skeleton className="h-4 w-20" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[70px] w-full rounded-wallet" />
          ))}
        </section>
      </div>
      <section className={`${v2card} space-y-3`}>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-[22px] w-full rounded-[11px]" />
      </section>
    </SkeletonArea>
  );
}

/** Transaktioner's list: Design v2's card with a day band and rows of logo, name, category, account and amount. */
export function TransactionsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <SkeletonArea label="Transaktionerna laddas" className="overflow-hidden rounded-card bg-card shadow-card">
      <div className="bg-band px-4 py-2 sm:px-6">
        <Skeleton className="h-3.5 w-40" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid min-h-14 grid-cols-[36px_minmax(0,1fr)_minmax(0,200px)_minmax(0,120px)_128px] items-center gap-x-3 px-4 py-2.5 sm:px-6">
          <Skeleton className="size-9 rounded-[10px]" />
          <Skeleton className="h-3.5" style={{ width: `${45 + ((i * 17) % 40)}%` }} />
          <Skeleton className="h-3.5 w-28 max-sm:hidden" />
          <Skeleton className="h-3 w-20 max-sm:hidden" />
          <Skeleton className="ml-auto h-3.5 w-20" />
        </div>
      ))}
    </SkeletonArea>
  );
}

/** Transaktioner's two summary cards, while the first list loads. */
export function TransactionsSummarySkeleton() {
  return (
    <div aria-hidden className="@container">
      <div className="grid gap-4 @[56rem]:grid-cols-12">
        <div className={`${v2card} space-y-3 @[56rem]:col-span-5`}>
          <Skeleton className="h-3.5 w-44" />
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[58px] flex-1 rounded-inset" />
            ))}
          </div>
          <Skeleton className="h-3 w-64" />
        </div>
        <div className={`${v2card} space-y-3 @[56rem]:col-span-7`}>
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}

/** Fasta utgifter: the hero (the month with its salary bar; this month, Eget and Årsvis) and a group card of rows. */
export function RecurringSkeleton() {
  return (
    <SkeletonArea label="Fasta utgifter laddas" className="space-y-5">
      <div className="@container">
        <div className="grid gap-4 @[56rem]:grid-cols-12">
          <div className={`${v2card} space-y-4 @[56rem]:col-span-8`}>
            <Skeleton className="h-3.5 w-56" />
            <Skeleton className="h-12 w-48" />
            <Skeleton className="h-[22px] w-full rounded-[11px]" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <div className="grid content-start gap-4 @[56rem]:col-span-4">
            <div className={`${v2card} space-y-2`}>
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[0, 1].map((i) => (
                <div key={i} className={`${v2card} space-y-2 px-4 py-3.5`}>
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-card bg-card shadow-card">
        <div className="bg-band px-5 py-3">
          <Skeleton className="h-3.5 w-48" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-11 items-center gap-3 border-t border-hairline px-5">
            <Skeleton className="size-8 shrink-0 rounded-[9px]" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="ml-auto h-3.5 w-16" />
            <Skeleton className="h-3.5 w-24 max-sm:hidden" />
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </SkeletonArea>
  );
}
