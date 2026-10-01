import type { IndexProvider } from "./provider.js";
import { OilBulletinProvider } from "./oilBulletin.js";
import { ScbKpiProvider } from "./scb.js";

/**
 * Källorna, i den ordning de körs.
 *
 * One place to add a source, so that the schedule, the interface and the
 * tests all see the same list. Nothing here is a fallback for anything else:
 * unlike a share price, one series is not another's stand-in.
 */
export function indexProviders(): IndexProvider[] {
  return [new ScbKpiProvider(), new OilBulletinProvider()];
}
