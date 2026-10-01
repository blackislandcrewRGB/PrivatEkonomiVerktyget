import { cn } from "../lib/cn";

/**
 * A grey block standing in for something that is on its way. Skeletons are
 * built to the same shape as what replaces them, so nothing jumps when the
 * data lands — that is the whole point of them over a spinner, which says
 * 'wait' without saying what for.
 *
 * The slow pulse is the one thing in the app that animates without the user
 * doing anything; it lives only while something is loading, and
 * prefers-reduced-motion stops it with every other animation.
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden style={style} className={cn("block animate-pulse rounded bg-surface-muted", className)} />;
}

/** A whole area that is loading: hidden from screen readers, which get the message below instead. */
export function SkeletonArea({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className} aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <div aria-hidden>{children}</div>
    </div>
  );
}
