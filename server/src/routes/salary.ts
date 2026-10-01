import { Hono } from "hono";
import { annualIncome } from "../salary/annualIncome.js";
import type { Db } from "../db/client.js";
import { todayLocal } from "../overview/dates.js";
import {
  backtest,
  deriveConstants,
  obRatesFor,
  vacationPayout,
  getSalarySettings,
  importPayslip,
  importPayslipPdf,
  listConstants,
  listMonths,
  listPayslips,
  modelMonth,
  notePendingChanges,
  overtimeByMonth,
  clearPendingChanges,
  pendingChanges,
  removeMonth,
  setConstant,
  setMonth,
  setSalarySettings,
  type MonthInput,
} from "../salary/salary.js";
import { fetchTaxTable, storedTaxYears, taxCurve } from "../salary/tax.js";
import { salaryActuals } from "../overview/overview.js";
import { usualSalary } from "../recurring/estimates.js";
import { shiftsByMonth } from "../fuel/fuel.js";
import { scheduleDeadlines, setScheduleReceived } from "../salary/schedule.js";
import { isIsoDate } from "../import/text.js";

const MAX_BYTES = 2 * 1024 * 1024;

/** Löneprognos (/api/salary): payslips, constants, settings, the tax table, the model and the backtest. */
export function salaryRoutes(db: Db) {
  const app = new Hono();
  const guard = async (run: () => unknown) => {
    try {
      return Response.json(await run());
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  };

  /** Inställningar › Lön: everything at once. */
  app.get("/", (c) => {
    const s = getSalarySettings(db);
    const curve = taxCurve(db);
    return c.json({
      today: todayLocal(),
      settings: s,
      constants: listConstants(db),
      // The OB levels and what they pay for this month's work.
      obRates: obRatesFor(db, todayLocal().slice(0, 7)),
      payslips: listPayslips(db).map(({ lines, sha256: _, ...p }) => ({ ...p, codes: [...new Set(lines.map((l) => l.code))] })),
      taxYears: storedTaxYears(db, s.taxTable),
      curve: {
        points: curve,
        min: curve.length ? Math.min(...curve.map((p) => p.rate)) : null,
        max: curve.length ? Math.max(...curve.map((p) => p.rate)) : null,
      },
      backtest: backtest(db),
      shifts: Object.fromEntries(shiftsByMonth(db)),
      // The overtime per shift/week each month's marked days give (for months with days).
      overtimeFromDays: overtimeByMonth(db),
      vacationPayout: vacationPayout(db),
      // 'Snitt 12 mån': the same average as Fasta utgifter's usual salary, over twelve.
      average: usualSalary(db, todayLocal(), 12),
      // New values from a payslip not yet looked at (the to-do in Att göra, the badge on Inställningar › Lön).
      pendingChanges: pendingChanges(db),
    });
  });

  /** Lön › Årsinkomst: the income years' salaries, and where this year is likely to land. */
  app.get("/annual", (c) => c.json(annualIncome(db, todayLocal())));

  app.get("/payslips", (c) => c.json(listPayslips(db).map(({ sha256: _, ...p }) => p)));

  /** One or more payslips (.htm or .pdf); the constants follow. */
  app.post("/payslips", async (c) => {
    const body = await c.req.parseBody({ all: true });
    const files = [body.files, body.file].flat().filter((f): f is File => f instanceof File);
    if (files.length === 0) return c.json({ error: "Inga filer skickades." }, 400);
    if (files.some((f) => f.size > MAX_BYTES)) return c.json({ error: "En fil är för stor." }, 413);
    const results = [];
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
      results.push(pdf ? await importPayslipPdf(db, f.name, bytes) : importPayslip(db, f.name, new TextDecoder().decode(bytes)));
    }
    const changed = deriveConstants(db);
    // New values from a payslip: a to-do on the overview until looked at.
    notePendingChanges(db, changed);
    return c.json({ results, changed });
  });

  app.put("/settings", async (c) => guard(async () => setSalarySettings(db, (await c.req.json().catch(() => ({}))) as Record<string, unknown>)));
  app.put("/constants/:id", async (c) => guard(async () => setConstant(db, Number(c.req.param("id")), (await c.req.json().catch(() => ({}))) as Record<string, unknown>)));

  /** Fetches Skatteverket's table for a year (the settings' table number). */
  app.post("/tax-table", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { year?: number };
      const year = b.year ?? Number(todayLocal().slice(0, 4));
      const s = getSalarySettings(db);
      return { year, tableNo: s.taxTable, rows: await fetchTaxTable(db, year, s.taxTable) };
    }),
  );

  /** The model for one month's hours, without saving them. */
  app.post("/model", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { month?: string } & MonthInput;
      if (!b.month || !/^\d{4}-\d{2}$/.test(b.month)) throw new Error("Månaden ska vara ÅÅÅÅ-MM.");
      const m = modelMonth(db, b.month, b);
      if (!m) throw new Error("Inga lönekonstanter än: importera en lönespec.");
      return m;
    }),
  );

  /** The months entered, each with its forecast. */
  /** The months entered, each with its forecast and, once paid, what came in. */
  /** Schemadeadlines from–to (dates), e.g. a calendar month's. */
  app.get("/schedule", (c) => {
    const { from, to } = c.req.query();
    if (!from || !to || !isIsoDate(from) || !isIsoDate(to) || from > to) return c.json({ error: "Ange from och to som ÅÅÅÅ-MM-DD." }, 400);
    return c.json(scheduleDeadlines(db, from, to));
  });
  /** 'Mottaget': a month's schedule ticked off, or undone ({received}). */
  app.put("/schedule/:month", async (c) =>
    guard(async () => {
      const b = (await c.req.json().catch(() => ({}))) as { received?: unknown };
      if (typeof b.received !== "boolean") throw new Error("received ska vara sant/falskt.");
      return { month: c.req.param("month"), received: b.received, months: setScheduleReceived(db, c.req.param("month"), b.received) };
    }),
  );

  app.get("/months", (c) => {
    const actual = salaryActuals(db);
    return c.json(
      listMonths(db).map((m) => {
        const forecast = modelMonth(db, m.month, { ...m, hours: m.effectiveHours, overtimePassHours: m.effectiveOvertimePassHours });
        const got = forecast ? (actual.get(forecast.payDate.slice(0, 7)) ?? null) : null;
        return { ...m, forecast, actual: got, diff: got && forecast ? got.amount - forecast.net : null };
      }),
    );
  });

  /** 'Visa' on the to-do: the new values have been seen. */
  app.post("/changes/ack", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { month?: string };
    clearPendingChanges(db, b.month);
    return c.json({ ok: true });
  });
  app.put("/months/:month", async (c) => guard(async () => setMonth(db, c.req.param("month"), (await c.req.json().catch(() => ({}))) as Record<string, unknown>)));
  app.delete("/months/:month", (c) => {
    removeMonth(db, c.req.param("month"));
    return c.json({ ok: true });
  });

  return app;
}
