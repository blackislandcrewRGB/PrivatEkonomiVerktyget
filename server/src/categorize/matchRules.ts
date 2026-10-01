import type { MerchantRule } from "../db/schema.js";

export type RuleLike = Pick<MerchantRule, "id" | "pattern" | "matchType"> & { direction?: MerchantRule["direction"] };

const regexCache = new Map<string, RegExp | null>();

function compile(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern, "iu"));
    } catch {
      // An invalid user-supplied regex must never break an import.
      regexCache.set(pattern, null);
    }
  }
  return regexCache.get(pattern)!;
}

export function ruleMatches(rule: RuleLike, description: string): boolean {
  const text = description.toLocaleLowerCase("sv");
  switch (rule.matchType) {
    case "exact":
      return text === rule.pattern.toLocaleLowerCase("sv");
    case "contains":
      return text.includes(rule.pattern.toLocaleLowerCase("sv"));
    case "regex":
      return compile(rule.pattern)?.test(description) ?? false;
  }
}

function directionMatches(rule: RuleLike, amount: number | undefined): boolean {
  const direction = rule.direction ?? "any";
  if (direction === "any") return true;
  // A directional rule needs to know the amount's sign.
  if (amount === undefined) return false;
  return direction === "in" ? amount > 0 : amount < 0;
}

/**
 * Returns the best matching rule for a description (and amount, for rules that
 * only apply to money in or out), or undefined.
 * Precedence: exact match first, then the longest pattern (most specific) wins,
 * then a directional rule over an 'any' rule, ties broken by lowest id (oldest rule).
 */
export function findMatchingRule<R extends RuleLike>(
  rules: readonly R[],
  description: string,
  amount?: number,
): R | undefined {
  let best: R | undefined;
  for (const rule of rules) {
    if (!directionMatches(rule, amount)) continue;
    if (!ruleMatches(rule, description)) continue;
    if (!best || compareSpecificity(rule, best) < 0) best = rule;
  }
  return best;
}

function compareSpecificity(a: RuleLike, b: RuleLike): number {
  const exactA = a.matchType === "exact" ? 0 : 1;
  const exactB = b.matchType === "exact" ? 0 : 1;
  if (exactA !== exactB) return exactA - exactB;
  if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length;
  const dirA = a.direction && a.direction !== "any" ? 0 : 1;
  const dirB = b.direction && b.direction !== "any" ? 0 : 1;
  if (dirA !== dirB) return dirA - dirB;
  return a.id - b.id;
}

export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, "iu");
    return true;
  } catch {
    return false;
  }
}
