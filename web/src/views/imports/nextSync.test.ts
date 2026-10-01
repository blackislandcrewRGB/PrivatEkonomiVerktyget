import { describe, expect, it } from "vitest";
import type { BankConnection } from "../../api";
import { expiringConsent, hoursText, nextSync } from "./nextSync";

const HOURS = [6, 12, 18];
const at = (iso: string) => nextSync(new Date(iso), HOURS);

describe("nextSync", () => {
  it("names today's next run, and tomorrow's first after the last one", () => {
    expect(at("2026-09-25T07:10:00Z")).toEqual({ day: "i dag", time: "12:00" }); // 09:10
    expect(at("2026-09-25T15:59:00Z")).toEqual({ day: "i dag", time: "18:00" }); // 17:59
    expect(at("2026-09-25T16:00:00Z")).toEqual({ day: "i morgon", time: "06:00" }); // 18:00: that run is under way
  });

  it("around midnight, in Swedish time rather than UTC", () => {
    expect(at("2026-09-25T21:59:00Z")).toEqual({ day: "i morgon", time: "06:00" }); // 23:59
    expect(at("2026-09-25T22:01:00Z")).toEqual({ day: "i dag", time: "06:00" }); // 00:01 the next day
  });

  it("across the summer time switches", () => {
    // 25 October 2026: 03:00 summer time becomes 02:00. 04:30Z is 05:30 winter time: 06 is still ahead.
    expect(at("2026-10-24T22:30:00Z")).toEqual({ day: "i dag", time: "06:00" }); // 00:30 summer time
    expect(at("2026-10-25T04:30:00Z")).toEqual({ day: "i dag", time: "06:00" });
    expect(at("2026-10-25T05:00:00Z")).toEqual({ day: "i dag", time: "12:00" }); // 06:00 winter time
    // 28 March 2027: 02:00 becomes 03:00. 04:30Z is 06:30 summer time: 06 has run.
    expect(at("2027-03-28T04:30:00Z")).toEqual({ day: "i dag", time: "12:00" });
    expect(at("2027-03-27T22:59:00Z")).toEqual({ day: "i morgon", time: "06:00" }); // 23:59 winter time
    expect(at("2027-03-27T23:30:00Z")).toEqual({ day: "i dag", time: "06:00" }); // 00:30 on the day of the switch
  });

  it("says the hours as a list", () => {
    expect(hoursText(HOURS)).toBe("kl 06, 12 och 18");
    expect(hoursText([12, 6])).toBe("kl 06 och 12");
    expect(nextSync(new Date(), [])).toBeNull();
  });
});

describe("expiringConsent", () => {
  const conn = (id: number, daysLeft: number, validUntil: string, status: BankConnection["status"] = "active"): BankConnection => ({
    id,
    bank: `Bank ${id}`,
    status,
    validUntil,
    daysLeft,
    expiresSoon: daysLeft < 14,
    authorizedAt: null,
    lastSyncAt: null,
    lastError: null,
    accounts: [],
  });

  it("the first to run out within 30 days, none otherwise", () => {
    expect(expiringConsent([conn(1, 174, "2027-03-18"), conn(2, 31, "2026-10-26")])).toBeNull();
    expect(expiringConsent([conn(1, 30, "2026-10-25"), conn(2, 12, "2026-10-07"), conn(3, 174, "2027-03-18")])?.id).toBe(2);
    expect(expiringConsent([conn(1, -2, "2026-09-23", "expired")])?.id).toBe(1);
  });
});
