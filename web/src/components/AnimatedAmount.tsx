import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { amountClass, amountKind, amountText, type AmountProps } from "./Amount";
import { useTransition } from "../lib/motion";

/**
 * A figure that counts from its old value to its new one, so it is obvious
 * *that* it changed and roughly by how much. Only for the few big numbers a
 * view is about — never for every amount in a list.
 *
 * The first render shows the value at once: the count is for a change the
 * user caused (a new month, an edit, fresh data), not for the page appearing.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  ...rest
}: {
  value: number;
  /** The number as text; gets whole öre, rounded. */
  format: (ore: number) => string;
  className?: string;
  title?: string;
  "aria-label"?: string;
}) {
  const transition = useTransition("number");
  const shown = useMotionValue(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      shown.set(value);
      return;
    }
    const run = animate(shown, value, transition);
    return () => run.stop();
    // `transition` is a fresh object every render; the value is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, shown]);

  const text = useTransform(shown, (v) => format(Math.round(v)));
  return (
    <motion.span className={className} {...rest}>
      {text}
    </motion.span>
  );
}

/** `Amount`, but counting to its new value. Same formatting, same colours, same sizes. */
export function AnimatedAmount({ ore, kind, whole, size = "md", className, strike }: AmountProps) {
  const k = amountKind(ore, kind);
  // While counting, a 'whole kronor' amount stays in whole kronor instead of
  // flickering through öre; where it lands is the exact amount, as in `Amount`.
  const format = (v: number) => amountText(whole && v !== ore ? Math.round(v / 100) * 100 : v, k, whole);
  return <AnimatedNumber value={ore} format={format} className={amountClass({ kind: k, size, strike, className })} />;
}
