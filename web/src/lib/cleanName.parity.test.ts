import { describe, expect, it } from "vitest";
import { cleanName } from "./monogram";
import { cleanName as serverCleanName } from "../../../server/src/items/merchantName";

// Prylar's merchant names are cleaned on the server (server/src/items/merchantName.ts)
// with a copy of the monogram's cleanName; the two must not drift apart.
const TEXTS = [
  "AMAZON.SE* KP6TV",
  "AMAZON SE* 514ZK",
  "AmazonMktplc*KR7SN4821",
  "K*WILLYS EXEMPELSTAD",
  "GOOGLE *Google Play Ap",
  "PAYPAL *STEAM",
  "HOSTBOX INC",
  "Swish betalning Exempel Gym",
  "Tele2 Sverige AB",
  "Kjell & Company",
  "P12ABC3456",
];

describe("the merchant name on the server", () => {
  it("is cleaned the same way as the monogram", () => {
    for (const t of TEXTS) expect(serverCleanName(t), t).toBe(cleanName(t));
  });
});
