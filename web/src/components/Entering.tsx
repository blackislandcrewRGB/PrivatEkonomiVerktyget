import { useState, type ReactNode } from "react";
import { motion, type MotionProps } from "motion/react";

const TAGS = { div: motion.div, li: motion.li } as const;

/**
 * One row of a list that fades in. The entrance is decided when the row
 * mounts and then never changes: a list re-renders for all sorts of reasons
 * (and the transaction list is virtualised, so rows come and go while you
 * scroll), and a row that lost its `animate` halfway would be left sitting at
 * whatever opacity it had reached.
 *
 * Props given here win over the entrance, which is how a row that is leaving
 * collapses instead.
 */
export function Entering({
  as = "div",
  index,
  entrance,
  children,
  ...rest
}: {
  as?: keyof typeof TAGS;
  index: number;
  entrance: (index: number) => Partial<MotionProps>;
  children: ReactNode;
  className?: string;
} & MotionProps) {
  const Tag = TAGS[as];
  const [props] = useState(() => entrance(index));
  return (
    <Tag {...props} {...rest}>
      {children}
    </Tag>
  );
}
