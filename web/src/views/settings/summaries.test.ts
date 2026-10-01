import { describe, expect, it } from "vitest";
import type { Category, FuelOverview, NetworthSettings, SalaryOverview } from "../../api";
import { backupStale } from "./Data";
import { accountsWaiting, linkState } from "./bankSync";
import { sectionOf } from "./sections";
import {
  carSummary,
  cashflowSummary,
  contactsSummary,
  digestSummary,
  enduranceSummary,
  incomeSummary,
  itemsSummary,
  partnerSummary,
  pensionSummary,
  pricesSummary,
  referenceSummary,
  salarySummary,
} from "./summaries";

const plain = (s: string) => s.replace(/\s/g, " ");
const cat = (id: number, name: string, parentId: number | null): Category => ({ id, name, parentId, color: null, isTransfer: false, isSettlement: false, systemKey: null });
const CATS = [cat(1, "Prylar & hem", null), cat(29, "Elektronik", 1), cat(30, "Kläder", 1), cat(2, "Bil", null), cat(9, "Drivmedel", 2)];
const NETWORTH: NetworthSettings = {
  akassa: { incomeCapOre: 3400000, daysPerMonth: 22, steps: [{ days: 100, rate: 0.8 }, { days: 100, rate: 0.7 }, { days: 100, rate: 0.65 }], taxRate: null, incomeMonths: 12 },
  bufferAccount: { id: 2, name: "Swedbank e-sparkonto" },
  payslipTaxRate: 0.19096,
  pension: { incomeBaseAmounts: [{ year: 2026, amountOre: 8340000, source: "regeringsbeslut 6/11 2025" }], incomeMonths: 12 },
} as NetworthSettings;

describe("the compact sections' sentences", () => {
  it("as agreed, with the test instance's values", () => {
    expect(plain(itemsSummary({ categoryIds: [29], minAmount: 50000, defaultMinAmount: 50000 }, CATS).summary)).toBe("Fråga vid köp från 500 kr i Prylar & hem › Elektronik");
    expect(itemsSummary({ categoryIds: [29, 30], minAmount: 50000, defaultMinAmount: 50000 }, CATS).summary).toMatch(/Elektronik och 1 till$/);
    expect(itemsSummary({ categoryIds: [], minAmount: 50000, defaultMinAmount: 50000 }, CATS).summary).toBe("Ingen kategori vald: inga köp föreslås");
    expect(plain(cashflowSummary(200000, 3).summary)).toBe("Buffert 2 000 kr · rött under 3 månader med sparandet");
    expect(plain(enduranceSummary(NETWORTH).summary)).toBe("Buffertkonto Swedbank e-sparkonto · tak 34 000 kr/mån · 80/70/65 % · skatt 19,1 %");
    expect(enduranceSummary(NETWORTH).hint).toBe("a-kassan räknas på snittet av lönespecarna · skatten enligt specarna · 22 dagar/mån");
    expect(plain(pensionSummary(NETWORTH).summary)).toBe("Inkomstbasbelopp 2026: 83 400 kr");
    expect(pensionSummary(NETWORTH).hint).toBe("regeringsbeslut 6/11 2025 · nytt varje november");
    expect(pricesSummary(null, "2026-09-25").summary).toBe("Startmånad 2025-09 (12 månader bakåt)");
    expect(pricesSummary("2025-01", "2026-09-25").summary).toBe("Startmånad 2025-01");
    expect(digestSummary({ canSend: false, sentAt: null })).toEqual({ summary: "Söndagar 19:00 via ntfy · inte skickad än", hint: "ingen ntfy-topic satt – NTFY_TOPIC i .env" });
    expect(contactsSummary([{ id: 1, counterparty: "+46XX5550001", name: "Mamma", note: null }, { id: 2, counterparty: "+46XX5550002", name: "Mio", note: null }]).summary).toBe("Mamma · Mio");
    expect(partnerSummary(["+46XX5550002"], [{ id: 2, counterparty: "+46XX5550002", name: "Mio", note: null }], "Mio", null)).toEqual({
      summary: "+46XX5550002 · Mio",
      hint: "Swish från numret blir Inkomst › Från partner · ditt namn: inte angivet",
    });
  });

  it("Referensbudget: the year, the persons, and what isn't counted", () => {
    const options = {
      year: 2026,
      ageGroups: [],
      food: [],
      items: [
        { key: "water_sewage", name: "Vatten och avlopp", scope: "household" as const },
        { key: "household_electricity", name: "Hushållsel", scope: "household" as const },
      ],
    };
    const household = { persons: [{ role: "me" as const, ageGroup: "25-50", food: "food_home", age: null }, { role: "partner" as const, ageGroup: "25-50", food: "food_home", age: null }], excluded: ["water_sewage", "household_electricity"] };
    expect(referenceSummary({ household, options, partnerName: "Mio" })).toEqual({ summary: "Konsumentverket 2026 · 2 personer", hint: "räknas inte: vatten och avlopp, hushållsel" });
    expect(referenceSummary({ household: null, options, partnerName: "Mio" }).summary).toBe("Inte inställt än");
  });

  it("Återkommande inkomster: the income, and a suggestion waiting", () => {
    const income = { id: 1, name: "Lön", amount: 2150000, dayOfMonth: 24, accountId: 2, active: true, matchPattern: "LÖN", lastReceived: null, recent: [], recentMin: null, recentAvg: null, overrides: [] };
    const account = { id: 2, name: "Swedbank e-sparkonto" } as never;
    expect(plain(incomeSummary([income], [], [account]).summary)).toBe("Lön 21 500 kr den 24:e på Swedbank e-sparkonto");
    const suggestion = { name: "Lön", accountId: 2, accountName: "Swedbank e-sparkonto", amount: 2300000, dayOfMonth: 24, matchPattern: "SWED2609240EXEMPEL", basedOn: [] };
    const s = incomeSummary([income], [suggestion], [account]);
    expect(plain(s.summary)).toBe("Lön 21 500 kr den 24:e på Swedbank e-sparkonto · 1 förslag väntar");
    expect(plain(s.hint)).toBe("förslag: Lön 23 000 kr den 24:e (SWED2609240EXEMPEL) · Lägg till");
  });

  it("Bil: the distances, the consumption in use and the latest diesel price", () => {
    const fuel = {
      settings: { kmPerShift: 40, otherKmPerMonth: 200, baseConsumption: 6.5, congestionPerShift: 0, useCalibrated: true, categoryId: null, fuelCategoryId: 9 },
      latestPrice: { id: 1, date: "2026-09-19", price: 1949, ageDays: 6 },
      prices: Array.from({ length: 12 }, (_, i) => ({ id: i, date: "2026-09-19", price: 1949 })),
      calibration: { l100: 5.6179 },
    } as unknown as FuelOverview;
    expect(carSummary(fuel, CATS)).toEqual({
      summary: "40 km/pass · 200 km/mån · 5,6 l/100 km · diesel 19,49 kr/l (19/9)",
      hint: "12 sparade priser · trängselskatt: ingen · tankning: Bil › Drivmedel",
    });
  });

  it("Lön: the payslips, the months the constants are from, and the model to the öre on the monthly ones", () => {
    const constant = (validFrom: string) => ({ validFrom, monthlySalary: 2650000, mertidRate: 19207, vacationHourlyRate: 25338 });
    const row = (diff: number | null) => ({ diff });
    const o = {
      constants: [constant("2026-04"), constant("2026-05"), constant("2026-06")],
      payslips: Array.from({ length: 9 }),
      backtest: [row(null), row(null), row(null), row(null), row(-130000), row(0), row(0), row(0), row(0)],
      settings: { taxTable: 32 },
    } as unknown as SalaryOverview;
    const s = salarySummary(o);
    expect(s.summary).toBe("Konstanter från 9 specar · april, maj och juni 2026 · tabell 32");
    expect(plain(s.hint)).toBe("månadslön 26 500 · mertid 192,07 · semestertimlön 253,38 · modellen stämmer på öret för 4 av 5 månadsspecar");
  });
});

describe("how an account gets its rows", () => {
  const connection = (over: object = {}) => ({
    id: 1,
    bank: "Swedbank",
    status: "active" as const,
    validUntil: "2027-03-18",
    daysLeft: 174,
    expiresSoon: false,
    authorizedAt: null,
    lastSyncAt: null,
    lastError: null,
    accounts: [{ id: 10, maskedRef: "••1234", product: "Privatkonto", accountId: 1, accountName: null, lastBookingDate: "2026-09-25", lastSyncAt: null, pending: { count: 1, amount: -1000 } }],
    ...over,
  });
  const status = (over: object = {}) => ({ configured: true, syncing: false, syncHours: [6, 12, 18], banks: [], connections: [connection(over)] });

  it("Enable Banking active: green, fetched through when, reserved rows not counted", () => {
    expect(linkState({ id: 1, source: "swedbank" }, status())).toMatchObject({ tone: "green", label: "Enable Banking · aktiv", sub: "hämtat t.o.m. 25 sep · 1 reserverad räknas inte" });
  });
  it("by hand: grey, the Mastercard by its invoice PDF", () => {
    expect(linkState({ id: 3, source: "mastercard" }, status())).toMatchObject({ tone: "grey", label: "manuell", sub: "faktura-PDF eller för hand" });
    expect(linkState({ id: 3, source: "swedbank" }, null)).toMatchObject({ tone: "grey", sub: "fil eller för hand" });
  });
  it("a consent running out within 30 days: orange; run out: red", () => {
    expect(linkState({ id: 1, source: "swedbank" }, status({ daysLeft: 30 }))).toMatchObject({ tone: "orange", label: "Enable Banking · går ut om 30 dagar" });
    expect(linkState({ id: 1, source: "swedbank" }, status({ daysLeft: 31 })).tone).toBe("green");
    expect(linkState({ id: 1, source: "swedbank" }, status({ status: "expired", daysLeft: -2 }))).toMatchObject({ tone: "red", label: "Enable Banking · samtycket har gått ut" });
  });
  it("what waits under Konton: a consent running out, a failing sync, a bank account feeding nothing", () => {
    expect(accountsWaiting(status())).toBe(0);
    expect(accountsWaiting(status({ daysLeft: 12 }))).toBe(1);
    expect(accountsWaiting(status({ lastError: "401" }))).toBe(1);
    expect(accountsWaiting(status({ accounts: [{ ...connection().accounts[0], accountId: null }] }))).toBe(1);
  });
});

describe("the page's anchors and Data", () => {
  it("the old anchors lead to their sections", () => {
    expect(sectionOf("#vakt")).toBe("vakt");
    expect(sectionOf("#banks")).toBe("konton");
    expect(sectionOf("#reference-budget")).toBe("referensbudget");
    expect(sectionOf("#bil-title")).toBe("bil");
    expect(sectionOf("#nothing")).toBeNull();
  });
  it("Data waits when the latest backup is more than two days old, or there is none", () => {
    const now = Date.parse("2026-09-25T12:00:00Z");
    const b = (at: string) => ({ dir: "/x", backups: [{ name: "a.db", kind: "start", createdAt: at, size: 1 }] });
    expect(backupStale(b("2026-09-24T12:00:00Z"), now)).toBe(false);
    expect(backupStale(b("2026-09-23T11:00:00Z"), now)).toBe(true);
    expect(backupStale({ dir: "/x", backups: [] }, now)).toBe(true);
    expect(backupStale(null, now)).toBe(false);
  });
});
