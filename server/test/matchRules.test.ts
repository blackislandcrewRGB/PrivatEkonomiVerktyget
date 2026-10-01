import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findMatchingRule, isValidRegex, ruleMatches } from "../src/categorize/matchRules.js";
import { SEED_RULES } from "../src/db/seedData.js";

const rules = SEED_RULES.map((r, i) => ({ ...r, id: i + 1 }));
const categoryFor = (description: string) => findMatchingRule(rules, description)?.category;

describe("seed rules", () => {
  it("all regex patterns compile", () => {
    for (const r of SEED_RULES.filter((r) => r.matchType === "regex")) {
      expect(isValidRegex(r.pattern), r.pattern).toBe(true);
    }
  });

  it.each([
    ["LIDL 271 EXEMPEL", "Mat/Livsmedel"],
    ["ICA KVANTUM EXEM", "Mat/Livsmedel"],
    ["ICA TORNET STOC", "Mat/Livsmedel"],
    ["WILLYS BRO HANDE", "Mat/Livsmedel"],
    ["LIDLSVERIGEKB ,STOCKHOLM", "Mat/Livsmedel"],
    ["MCDONALDS EXEMPEL", "Mat/Restaurang & café"],
    ["K*MAX HAMBURG", "Mat/Restaurang & café"],
    ["PIZZERIA ROMA", "Mat/Restaurang & café"],
    ["CIRCLE K EXEMPELSTAD", "Bil/Drivmedel"],
    ["Swish Avanza", "Överföringar & sparande/Sparande"],
    ["Lysa Spar", "Överföringar & sparande/Sparande"],
    ["Swish AB STORSTOCKHOLM", "Resor/SL"],
    ["GOOGLE*CLOUD KLM", "AI & utveckling/Moln & hosting"],
    ["RUNPOD.IO", "AI & utveckling/Moln & hosting"],
    ["OPENAI *CHATGPT", "AI & utveckling/AI-tjänster"],
    ["ANTHROPIC", "AI & utveckling/AI-tjänster"],
    ["KjellCo Exempelstad", "Prylar & hem/Elektronik"],
    ["KJELL & CO 115", "Prylar & hem/Elektronik"],
    ["Swish Amazon Sweden", "Prylar & hem"],
    ["APPLE.COM/BILL", "Nöje/Streaming"],
    ["PodMe", "Nöje/Streaming"],
  ])("%s -> %s", (description, expected) => {
    expect(categoryFor(description)).toBe(expected);
  });

  it.each(["AMERICAN EXPRESS", "MUSICA SHOP", "PERPLEXITY AI", "COOPERATIVE X", "Swish skickad +46765550019", "Överföring via internet"])(
    "does not match %s",
    (description) => {
      expect(categoryFor(description)).toBeUndefined();
    },
  );

  it("matches the most common descriptions in the Swedbank sample", () => {
    const dir = path.resolve(__dirname, "fixtures/bank");
    const file = fs.readdirSync(dir).find((f) => f.startsWith("Transaktioner_") && f.endsWith(".csv"))!;
    const text = new TextDecoder("windows-1252").decode(fs.readFileSync(path.join(dir, file)));
    // Quick column grab for this test only; the real parser comes in step 2.
    const descriptions = text
      .split(/\r?\n/)
      .slice(2)
      .map((l) => l.match(/"([^"]*)",-?[\d.]+$/)?.[1]?.replace(/\s+/g, " ").trim())
      .filter((d): d is string => !!d);
    expect(descriptions.length).toBeGreaterThan(150);
    const matched = descriptions.filter((d) => categoryFor(d)).length;
    // Sanity check that the seeds cover a meaningful share, not a hard target.
    expect(matched / descriptions.length).toBeGreaterThan(0.4);
  });
});

describe("rule precedence", () => {
  it("prefers exact over contains, then the longest pattern", () => {
    const rs = [
      { id: 1, pattern: "Swish", matchType: "contains" as const },
      { id: 2, pattern: "Swish Avanza", matchType: "contains" as const },
      { id: 3, pattern: "swish avanza", matchType: "exact" as const },
    ];
    expect(findMatchingRule(rs, "Swish Avanza")?.id).toBe(3);
    expect(findMatchingRule(rs, "Swish Avanza AB")?.id).toBe(2);
    expect(findMatchingRule(rs, "Swish Exempel AB")?.id).toBe(1);
  });

  it("treats an invalid regex as no match instead of throwing", () => {
    expect(ruleMatches({ id: 1, pattern: "([", matchType: "regex" }, "anything")).toBe(false);
  });
});
