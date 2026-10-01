import type { Db } from "../db/client.js";
import { cashflow, monthStarts } from "../cashflow/cashflow.js";
import { endurance } from "../networth/endurance.js";
import { balanceSheet } from "../networth/networth.js";
import { flow } from "../networth/flow.js";
import { mainIncome } from "../overview/overview.js";
import { getPartnerName } from "../settings.js";
import type { Affordability } from "./afford.js";

/**
 * Kopiera läget: the financial position as short Markdown, to paste into a
 * Claude chat and ask about a purchase. Only what a judgement needs, rounded
 * to hundreds of kronor; on purpose without any name (the partner is 'the
 * partner'), account or card number, employer, landlord, address, single
 * purchases, merchants or holdings. The card's and the banks' names stay:
 * they say when a purchase is paid.
 *
 * It starts with how the month is counted, so the reader counts the same
 * way: what is left on the 1st, when the month's bills are paid with its
 * salary and the partner's Swish, is what I have over; the card invoices
 * belong to the next salary and are paid about the 25th.
 */

const VERDICT_TEXT = { green: "grönt", yellow: "gult", red: "rött" } as const;
const FUNDING_TEXT = { cash: "från kassaflödet", savings: "med pengar från sparandet på ISK" } as const;

/** Hundreds of kronor: '216 100 kr'. */
const kr = (ore: number) => `${(Math.round(ore / 10000) * 100).toLocaleString("sv-SE")} kr`;
const dm = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
const MONTH_NAMES = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];
const months1 = (m: number | null) => (m === null ? "okänt" : `${m.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} månader`);
const percent = (x: number | null) => (x === null ? "okänd" : `${Math.round(x * 100)} %`);

export function snapshot(db: Db, today: string, purchase: Affordability | null = null): string {
  const cash = cashflow(db, today);
  const sheet = balanceSheet(db, today);
  const e = endurance(db, today);
  const f = flow(db, today);
  const partner = getPartnerName(db);
  const main = mainIncome(db);
  // Anything that could carry the partner's name says 'partnern'.
  const anon = (s: string) => (partner ? s.split(partner).join("partnern") : s);

  const bank = cash.accounts.reduce((s, a) => s + a.balance, 0);
  const owed = sheet.liquid.find((r) => r.key === "partner")?.amountOre ?? 0;
  const owing = sheet.debts.find((r) => r.key === "partner")?.amountOre ?? 0;
  const cards = sheet.debts.filter((r) => r.key.startsWith("card:"));
  const invoices = cash.events.filter((x) => x.kind === "invoice");
  const incomes = cash.events.filter((x) => x.kind === "income");
  const fromPartner = cash.events.filter((x) => x.kind === "partner" && !x.plannedId);
  const planned = cash.planned;

  const lines: string[] = [];
  lines.push(`# Ekonomiskt läge ${dm(today)} ${today.slice(0, 4)}`, "");
  lines.push("Från mitt privatekonomiverktyg. Beloppen är avrundade till hundratal kronor. Namn, kontonummer och enskilda köp är utelämnade.", "");

  lines.push("## Så räknar jag");
  lines.push("- Det som finns kvar den 1:a i en månad, när den förra månadens räkningar är betalda med månadens lön och partnerns swish, är de pengar jag faktiskt har över.");
  lines.push("- Kortfakturorna (Bank Norwegian och Mastercard) hör till nästa månads lön: det jag handlar på korten under en månad betalar jag runt den 25:e månaden efter, när lönen har kommit. Maten och flera prenumerationer går på Norwegian.");
  lines.push("- Siffrorna nedan räknar så: ett kortköp dras från banken först på fakturans betaldag, och kortskulden är inga pengar som saknas i dag.");
  lines.push("");

  lines.push("## Pengar nu");
  lines.push(`- Bankkonton: ${kr(bank)}`);
  if (cash.liquid.totalOre) lines.push(`- Likvider på ISK (kan flyttas till banken): ${kr(cash.liquid.totalOre)}`);
  lines.push(`- Sparande i värdepapper på ISK: ${kr(e.capital.portfolioOre)}`);
  for (const c of cards) {
    const inv = invoices.find((x) => x.name.startsWith(c.name));
    const invoice = inv ? ` (nästa faktura ca ${kr(-inv.amount)} betalas ${dm(inv.date)}${inv.paced ? `, varav ca ${kr(inv.paced)} köp som väntas före brytdagen` : ""})` : "";
    lines.push(`- Skuld på ${c.name}: ${kr(c.amountOre)}${invoice}`);
  }
  if (owed) lines.push(`- Partnern är skyldig mig: ${kr(owed)} (delad ekonomi)`);
  if (owing) lines.push(`- Jag är skyldig partnern: ${kr(owing)}`);
  if (sheet.csn) lines.push(`- CSN-skuld: ${kr(sheet.csn.amountOre)}${f.csn?.rateOre ? `, betalas med ca ${kr(f.csn.rateOre)}/mån` : ""}`);
  lines.push("");

  lines.push("## Inkomster de kommande 90 dagarna");
  for (const i of incomes) {
    const salary = main && i.name.startsWith(main.name);
    const kind = /prognos/.test(i.name) ? "prognos" : i.estimate ? "uppskattning" : "väntad";
    lines.push(`- ${dm(i.date)}: ${salary ? "lön" : "annan inkomst"} ${kr(i.amount)} (${kind})`);
  }
  if (fromPartner.length) lines.push(`- Partnerns betalningar för det delade: ${fromPartner.map((x) => `${kr(x.amount)} den ${dm(x.date)}`).join(", ")} (uppskattade)`);
  lines.push("");

  lines.push(`## Utgifter (snitt ${f.from.slice(0, 7)} – ${f.to.slice(0, 7)})`);
  lines.push(`- Inkomst per månad: ${kr(f.perMonth.incomeOre)}`);
  lines.push(`- Fasta utgifter per månad: ${kr(f.perMonth.fixedOre)}`);
  lines.push(`- Rörliga utgifter per månad: ${kr(f.perMonth.variableOre)}`);
  lines.push(`- Över per månad: ${kr(f.perMonth.leftOre)}; sparkvot ${percent(f.savingsRate)}`);
  lines.push(`- Takt de senaste 30 dagarna, det jag betalar: ${kr(cash.variable.fullPerDay * 30)}/mån`);
  if (cash.foodOnly) lines.push(`- Kassaflödet nedan räknar bara med maten på kortet av de rörliga utgifterna (${kr(cash.variable.perDay * 30)}/mån, betalas med kortfakturan), plus bränsle`);
  lines.push(`- Det nödvändiga per månad (för uthålligheten, fasta utgifter + dagligvaror): ${kr(e.essential.monthlyOre)}`);
  lines.push("");

  const starts = monthStarts(cash);
  if (starts.length) {
    lines.push("## Kvar vid månadsskiftet (bankkonton + likvider på ISK)");
    const onIsk = cash.liquid.totalOre ? ` (varav ${kr(cash.liquid.totalOre)} på ISK)` : "";
    for (const m of starts) lines.push(`- ${dm(m.date)}, när ${monthName(m.month)}s räkningar är betalda: ${kr(m.balance)}${onIsk}`);
    lines.push("");
  }

  lines.push("## Kassaflöde 90 dagar (bankkonton + likvider på ISK)");
  lines.push(`- Lägsta punkt: ${kr(cash.lowest.balance)} den ${dm(cash.lowest.date)}`);
  lines.push(`- Buffert jag vill ha kvar: ${kr(cash.buffer)}; safe to spend (lägsta punkt − buffert): ${kr(cash.safeToSpend)}`);
  lines.push(`- Om 90 dagar: ${kr(cash.days.at(-1)!.balance)}`);
  for (const p of planned) lines.push(`- Redan planerat: ${kr(Math.abs(p.amount))} ${p.amount < 0 ? "ut" : "in"} den ${dm(p.payDate)}`);
  lines.push("");

  lines.push("## Uthållighet (hur länge pengarna räcker utan inkomst, med bara det nödvändiga)");
  lines.push(`- Buffert (kvar vid månadsskiftet): ${months1(e.essential.buffer.months)}`);
  lines.push(`- Med sparandet: ${months1(e.essential.withSavings.months)}`);
  if (e.essential.withAkassa.months !== null) lines.push(`- Med sparandet och a-kassa: ${months1(e.essential.withAkassa.months)}`);
  lines.push("");

  if (purchase) {
    const p = purchase;
    const how = [
      p.payment.card ? `på ${p.payment.card}, dras ${dm(p.payment.payDate)}` : "från bankkontot",
      p.input.shared ? "delat med partnern" : "eget",
      FUNDING_TEXT[p.input.funding],
    ].join(", ");
    lines.push("## Köpet jag funderar på");
    lines.push(`- ${kr(p.input.amount)} den ${dm(p.input.date)}, ${how}`);
    lines.push(`- Verktygets bedömning: ${VERDICT_TEXT[p.verdict]}, "${p.headline}"`);
    for (const r of p.reasons) lines.push(`  - ${r}`);
    lines.push(
      `- Med köpet: lägsta punkt ${kr(p.after.lowest.balance)} den ${dm(p.after.lowest.date)}, safe to spend ${kr(p.after.safeToSpend)}, uthållighet med sparandet ${months1(p.after.withSavingsMonths)}`,
    );
    for (const m of p.monthStarts.filter((x) => x.before !== x.after)) lines.push(`- Kvar vid månadsskiftet ${dm(m.date)}: ${kr(m.after)} med köpet, ${kr(m.before)} utan`);
    lines.push(`- Rött om uthålligheten med sparandet blir under ${months1(p.limits.redBelowMonths)}`);
    lines.push("");
    lines.push("Har jag råd med det här köpet? Vad bör jag tänka på, och finns det ett bättre sätt att betala det?");
  } else {
    lines.push("Hur ser mitt ekonomiska läge ut, och vad bör jag tänka på?");
  }
  return anon(lines.join("\n"));
}
