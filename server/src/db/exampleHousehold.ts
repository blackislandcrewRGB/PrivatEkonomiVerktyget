import { accounts } from "./schema.js";
import type { Db } from "./client.js";
import { insertSeedRule, seedContacts } from "./seed.js";
import { EXAMPLE_CARD_RULES, SEED_ACCOUNTS, type SeedContact } from "./seedData.js";
import { seedManualBalances } from "../networth/manualBalances.js";
import { seedPensions } from "../networth/pension.js";

/**
 * An example household: four accounts at the banks the importers know, a
 * partner and two other contacts, rules for paying the cards' bills, example
 * pensions and a student loan and a car. For the demo data (`npm run db:demo`)
 * and the tests; a real database starts empty and the household makes its own.
 * Every Swish number here is made up.
 */
export const EXAMPLE_CONTACTS: SeedContact[] = [
  { counterparty: "+46765550019", name: "Mio", partner: true, note: "Partner" },
  { counterparty: "+46705550009", name: "Pappa" },
  { counterparty: "+46705550005", name: "Mamma" },
];

export function seedExampleHousehold(db: Db): void {
  const have = new Set(db.select({ name: accounts.name }).from(accounts).all().map((a) => a.name));
  for (const account of SEED_ACCOUNTS) if (!have.has(account.name)) db.insert(accounts).values(account).run();
  for (const rule of EXAMPLE_CARD_RULES) insertSeedRule(db, rule);
  seedContacts(db, EXAMPLE_CONTACTS);
  seedManualBalances(db);
  seedPensions(db);
}
