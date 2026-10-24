import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SalaryModel, SalaryMonth, SalaryOverview } from "../../api";
import { Toaster } from "../../components/Toast";
import { callsTo, mockApi } from "../../../test/api";
import { SalarySection } from "../settings/sections/Salary";
import { BadgeContext } from "../settings/badges";
import { SalaryView } from "./SalaryView";

const CONST = {
  id: 1,
  validFrom: "2026-06",
  monthlySalary: 2650000,
  industrySupplement: 22000,
  salarySupplement: 30000,
  hoursPerMonth: 140,
  fullTimeHours: 165.6,
  mertidRate: 20000,
  vacationHourlyRate: 26050,
  sources: { monthlySalary: "från julispec 2026", fullTimeHours: "inställningen Heltid (står inte på specen)" },
  baseHourlyRate: 18800,
  employmentRate: 0.8454,
};
const OVERVIEW: SalaryOverview = {
  today: "2026-09-19",
  settings: { lagMonths: 1, lagSource: "8 av 8 specar: raderna gäller månaden före utbetalningen", payDay: 25, fullTimeHours: 165.6, taxTable: 32, taxColumn: 1, taxYear: null, shiftHours: 10.5,
    obLevels: { "150": { name: "Kväll/natt 18–06", rates: [{ from: "2026-06", rate: 2662 }] } },
    shiftLimit: 13,
    weekLimit: 52,
    quarterOvertime: true,
    scheduleNoticeDays: 6,
    vacationSave: {},
  },
  constants: [CONST],
  obRates: {},
  payslips: [],
  taxYears: [2026],
  curve: { points: [{ payDate: "2026-07-24", gross: 3000000, tax: 580000, rate: 0.1933 }], min: 0.1933, max: 0.1933 },
  shifts: { "2026-09": 14, "2026-07": 15 },
  sickDays: [],
  sickPeriods: [],
  sickShiftExtra: {},
  vacationPayout: null,
  average: null,
  pendingChanges: [],
  overtimeFromDays: {
    "2026-07": {
      hours: 1,
      weeks: [
        { from: "2026-07-06", to: "2026-07-12", shifts: 5, hours: 52.5, over: 0.5 },
        { from: "2026-07-20", to: "2026-07-26", shifts: 5, hours: 52.5, over: 0.5 },
      ],
    },
  },
  backtest: [
    {
      payDate: "2026-05-25",
      name: "majspec 2026",
      workMonth: "2026-04",
      hours: 157.5,
      actual: { gross: 2900000, tax: 560000, net: 2340000 },
      model: { gross: 2900000, tax: 560000, net: 2240000 },
      diff: -100000,
      grossDiff: 0,
      taxCheck: { tax: 560000, diff: 0, source: "tabell 32 kolumn 1, 2026" },
      explained: [{ what: "friskvårdsutlägg", amount: 100000 }],
      note: "Förklarat: friskvårdsutlägg 1000 kr ligger utanför modellen.",
    },
  ],
};
const MODEL: SalaryModel = {
  workMonth: "2026-09",
  payDate: "2026-10-23",
  lines: [
    { code: "011", name: "Månadslön", quantity: null, unitPrice: null, amount: 2650000 },
    { code: "160", name: "Mertid", quantity: 17.5, unitPrice: 20000, amount: 350000 },
  ],
  gross: 3000000,
  tax: 580000,
  taxSource: "tabell 32 kolumn 1, 2026",
  net: 2420000,
  thresholds: {
    hoursPerMonth: 140,
    fullTimeHours: 165.6,
    mertidRate: 20000,
    overtimeRate: 30000,
    passes: false,
    quarter: {
      months: [
        { month: "2026-07", hours: 157.5, passHours: 1, entered: true },
        { month: "2026-08", hours: 140, passHours: 0, entered: true },
        { month: "2026-09", hours: 157.5, passHours: 0, entered: true },
      ],
      hours: 455,
      limit: 496.8,
      over: 0,
      settle: 0,
      settlesIn: "2026-09",
    },
    next: { at: 199.3, before: 20000, after: 30000 },
  },
  constantsFrom: "2026-06",
};

let fetchMock: ReturnType<typeof mockApi>;
beforeEach(() => {
  fetchMock = mockApi({
    "GET /salary/months": [],
    "GET /salary": OVERVIEW,
    "POST /salary/model": MODEL,
    "PUT /salary/months": {},
    "PUT /salary/settings": {},
  });
});

describe("Lön", () => {
  it("hours in, what lands and when out; saved per work month", async () => {
    render(
      <>
        <SalaryView />
        <Toaster />
      </>,
    );
    await userEvent.selectOptions(await screen.findByLabelText("Arbetsmånad"), "2026-09");
    await userEvent.type(screen.getByLabelText("Timmar totalt"), "157,5");
    // The forecast being typed is in the hero.
    const forecast = await screen.findByTestId("salary-forecast");
    expect(forecast).toHaveTextContent(/Förhandsvisning · 23\/10 · prognos för september/);
    expect(forecast.querySelector("[data-figure=net]")).toHaveTextContent(/24\s200 kr/);
    expect(forecast).toHaveTextContent(/en timme till är värd 200 kr brutto; från 199,3 tim 300 kr/);
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/salary/model").at(-1)?.[1]).toMatchObject({ month: "2026-09", hours: 157.5 }));
    await userEvent.click(screen.getByRole("button", { name: /Spara september 2026/ }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/salary/months/2026-09")).toEqual([["/api/salary/months/2026-09", { hoursMode: "manual", hours: 157.5, vacationHours: 0, atfHours: 0, overtimePassHours: 0, obHours: {} }]]));
  });

  it("a quarter over full time on average: the overtime, and the month it is settled with", async () => {
    const quarter = {
      months: [
        { month: "2026-07", hours: 180, passHours: 2, entered: true },
        { month: "2026-08", hours: 140, passHours: 0, entered: false },
        { month: "2026-09", hours: 200, passHours: 0, entered: true },
      ],
      hours: 520,
      limit: 496.8,
      over: 23.2,
      settle: 21.2,
      settlesIn: "2026-09",
    };
    fetchMock = mockApi({ "GET /salary/months": [], "GET /salary": OVERVIEW, "POST /salary/model": { ...MODEL, thresholds: { ...MODEL.thresholds, passes: true, quarter, next: null } } });
    render(<SalaryView />);
    await userEvent.type(await screen.findByLabelText("Timmar totalt"), "200");
    expect(await screen.findByTestId("quarter-overtime")).toHaveTextContent(
      /Kvartalet passerar heltid i snitt: 520 tim mot 496,8 \(165,6 × 3, juli 180, aug 140 antaget, sep 200\)\. 23,2 tim är övertid: mertid plus 50 %, 300 kr\/tim i stället för 200 kr\/tim \(brutto\), varav 2 redan som övertid per pass\/vecka\. Antaget att det regleras med lönen för september 2026\./,
    );
  });

  it("the hours can come from Pendling's shifts (per month)", async () => {
    render(<SalaryView />);
    await userEvent.selectOptions(await screen.findByLabelText("Arbetsmånad"), "2026-09");
    await userEvent.click(screen.getByRole("switch", { name: /timmar från passen i Pendling \(14 st\)/ }));
    expect(screen.getByTestId("hours-from-shifts")).toHaveTextContent("Timmar: 14 pass × 10,5 = 147 tim");
    expect(screen.getByLabelText("Timmar totalt")).toHaveValue("147");
    expect(screen.getByLabelText("Timmar totalt")).toBeDisabled();
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/salary/model").at(-1)?.[1]).toMatchObject({ month: "2026-09", hours: 147 }));
    await userEvent.click(await screen.findByRole("button", { name: /Spara september 2026/ }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/salary/months/2026-09")[0][1]).toMatchObject({ hoursMode: "shifts", hours: 147 }));
  });

  it("with the days marked in Pendling, the overtime per week comes from them", async () => {
    render(<SalaryView />);
    await userEvent.selectOptions(await screen.findByLabelText("Arbetsmånad"), "2026-07");
    await userEvent.click(screen.getByRole("switch", { name: /timmar från passen i Pendling \(15 st, dagarna markerade\)/ }));
    expect(screen.getByLabelText("Övertid pass/vecka")).toHaveValue("1");
    expect(screen.getByTestId("overtime-from-days")).toHaveTextContent("Övertid från kalendern: 1 tim – v. 6/7–12/7 5 pass, 52,5 tim; v. 20/7–26/7 5 pass, 52,5 tim");
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/salary/model").at(-1)?.[1]).toMatchObject({ month: "2026-07", hours: 157.5, overtimePassHours: 1 }));
  });

  it("the vacation left at 31 March: what is paid out, and hours to save", async () => {
    fetchMock = mockApi({
      "GET /salary/months": [],
      "GET /salary": {
        ...OVERVIEW,
        settings: { ...OVERVIEW.settings, vacationSave: { "2028-03": 5 } },
        vacationPayout: { workMonth: "2027-03", payDate: "2027-04-23", source: "septemberspec 2026", sourceMonth: "2026-08", remaining: 81.7, planned: 40, save: 0, hours: 41.7, rate: 26050, amount: 1086285, savedEarlier: null },
      },
      "PUT /salary/settings": {},
    });
    render(<SalaryView />);
    const box = await screen.findByTestId("vacation-left");
    expect(box).toHaveTextContent("Semester kvar till 31 mars 2027");
    expect(box.querySelector("[data-figure=vacation]")).toHaveTextContent("81,7timmar · enligt septemberspec 2026");
    expect(box).toHaveTextContent("40 tim inlagda som semester fram till mars");
    expect(box).toHaveTextContent("antagen regel");
    expect(box.querySelector("[data-payout]")).toHaveTextContent(/Det som blir kvar: betalas ut med lönen 23\/4\s*10\s863 kr\s*brutto · 41,7 × 260,50/);
    expect(box).toHaveTextContent("meddela senast 1 april 2027");
    await userEvent.type(within(box).getByLabelText("Timmar att spara"), "10");
    await userEvent.click(within(box).getByRole("button", { name: "Spara" }));
    // The other years' hours are kept.
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/salary/settings")).toEqual([["/api/salary/settings", { vacationSave: { "2028-03": 5, "2027-03": 10 } }]]));
  });

  it("Inställningar › Lön: new values from a payslip not looked at badge the row and the nav", async () => {
    fetchMock = mockApi({
      "GET /salary": { ...OVERVIEW, pendingChanges: [{ month: "2026-06", changes: [{ field: "monthlySalary", from: 2580000, to: 2650000 }] }] },
    });
    const report = vi.fn();
    render(
      <BadgeContext.Provider value={report}>
        <ul>
          <SalarySection open={false} onToggle={() => {}} match={() => true} />
        </ul>
      </BadgeContext.Provider>,
    );
    await waitFor(() => expect(report).toHaveBeenLastCalledWith("lon", 1));
    expect(screen.getByRole("button", { name: /^Lön/ })).toHaveTextContent(/^Lön1/);
  });

  it("Inställningar › Lön: the constants with their source, the lag and the backtest", async () => {
    render(
      <ul>
        <SalarySection open onToggle={() => {}} match={() => true} />
      </ul>,
    );
    const table = await screen.findByRole("table", { name: "Lönekonstanter" });
    expect(table).toHaveTextContent(/26\s500 kr\s*från julispec 2026/);
    expect(table).toHaveTextContent("84,54 %");
    expect(screen.getByText("8 av 8 specar: raderna gäller månaden före utbetalningen")).toBeInTheDocument();
    const row = document.querySelector('[data-payslip="2026-05-25"]') as HTMLElement;
    expect(within(row).getByText(/friskvårdsutlägg 1000 kr/)).toBeInTheDocument();
    expect(within(row).getByText("stämmer")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Eftersläpning"), "0");
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/salary/settings")).toEqual([["/api/salary/settings", { lagMonths: 0 }]]));
  });

  it("Inställningar › Lön › Avtalet: shows the saved values and saves the changes (kronor to öre, empty = no rule)", async () => {
    render(
      <ul>
        <SalarySection open onToggle={() => {}} match={() => true} />
      </ul>,
    );
    const box = await screen.findByTestId("agreement");
    expect(within(box).getByLabelText("Löneart, nivå 1")).toHaveValue("150");
    expect(within(box).getByLabelText("Sats, nivå 1 sats 1")).toHaveValue("26,62");
    expect(within(box).getByLabelText("Övertid per pass")).toHaveValue("13");
    // A new rate from a month, the week limit cleared, the schedule notice entered.
    await userEvent.click(within(box).getByRole("button", { name: /Ny sats från en månad/ }));
    await userEvent.type(within(box).getByLabelText("Från månad, nivå 1 sats 2"), "2027-06");
    await userEvent.type(within(box).getByLabelText("Sats, nivå 1 sats 2"), "27,40");
    await userEvent.clear(within(box).getByLabelText("Övertid per vecka"));
    await userEvent.clear(within(box).getByLabelText("Schemat klart dagar före"));
    await userEvent.type(within(box).getByLabelText("Schemat klart dagar före"), "7");
    await userEvent.click(within(box).getByRole("button", { name: "Spara avtalet" }));
    await waitFor(() =>
      expect(callsTo(fetchMock, "PUT", "/salary/settings")).toEqual([
        [
          "/api/salary/settings",
          {
            obLevels: { "150": { name: "Kväll/natt 18–06", rates: [{ from: "2026-06", rate: 2662 }, { from: "2027-06", rate: 2740 }] } },
            shiftLimit: 13,
            weekLimit: null,
            quarterOvertime: true,
            scheduleNoticeDays: 7,
          },
        ],
      ]),
    );
  });

  it("Inställningar › Lön › Avtalet: a rate that is not an amount stops the save", async () => {
    render(
      <ul>
        <SalarySection open onToggle={() => {}} match={() => true} />
      </ul>,
    );
    const box = await screen.findByTestId("agreement");
    await userEvent.clear(within(box).getByLabelText("Sats, nivå 1 sats 1"));
    await userEvent.type(within(box).getByLabelText("Sats, nivå 1 sats 1"), "abc");
    await userEvent.click(within(box).getByRole("button", { name: "Spara avtalet" }));
    expect(await within(box).findByText(/skriv satserna i kronor per timme/)).toBeInTheDocument();
    expect(callsTo(fetchMock, "PUT", "/salary/settings")).toEqual([]);
  });
});

/** An entered month with its forecast (MODEL's lines) paid on `payDate`; `diff` once paid. */
const entered = (month: string, payDate: string, opts: { hours?: number; diff?: number | null } = {}): SalaryMonth => {
  const hours = opts.hours ?? 157.5;
  const forecast = { ...MODEL, workMonth: month, payDate };
  const diff = opts.diff ?? null;
  return {
    month,
    hours,
    vacationHours: 0,
    atfHours: 0,
    overtimePassHours: 0,
    obHours: {},
    hoursMode: "manual",
    shifts: null,
    hoursFromShifts: null,
    sick: { hours: 0, karens: 0, days: [] },
    effectiveHours: hours,
    overtimeFromDays: null,
    effectiveOvertimePassHours: 0,
    forecast,
    actual: diff === null ? null : { bookingDate: `${payDate.slice(0, 8)}${Number(payDate.slice(8)) - 1}`, amount: forecast.net + diff },
    diff,
  };
};
const AVERAGE = { average: 2380000, gross: 2950000, count: 12, from: "2025-10", to: "2026-09" };

function renderWith(months: SalaryMonth[], today = "2026-09-26", payslips: SalaryOverview["payslips"] = []) {
  fetchMock = mockApi({
    "GET /salary/months": months,
    "GET /salary": { ...OVERVIEW, today, average: AVERAGE, payslips },
    "POST /salary/model": MODEL,
    "PUT /salary/months": {},
    "DELETE /salary/months": { ok: true },
  });
  return render(<SalaryView />);
}
const hero = () => screen.getByRole("region", { name: /Nästa lön|Förhandsvisning/ });

describe("Lön, Design v2", () => {
  it("the hero: the next salary's forecast, the latest in (grey when off) and the average of twelve", async () => {
    // July in to the krona, August 120 kr short, September the next.
    renderWith([entered("2026-07", "2026-08-25", { diff: 0 }), entered("2026-08", "2026-09-25", { diff: -12000 }), entered("2026-09", "2026-10-23")]);
    const h = await screen.findByRole("region", { name: /Nästa lön · 23\/10 · prognos för september/ });
    expect(h.querySelector("[data-figure=net]")).toHaveTextContent(/24\s200 kr/);
    expect(h).toHaveTextContent(/brutto 30\s000 kr · skatt tabell 32/);
    expect(h).toHaveTextContent(/Timmar i september 157,5 · 14 pass/);
    const last = h.querySelector("[data-box=last-paid]") as HTMLElement;
    expect(last).toHaveTextContent(/Senast utbetalt · 25\/9\s*24\s080 kr\s*augusti, 157,5 tim · avvek −120\skr/);
    expect(last).toHaveClass("bg-card-inset");
    expect(h.querySelector("[data-box=average]")).toHaveTextContent(/Snitt 12 mån\s*23\s800 kr\s*netto · 29\s500 brutto/);
  });

  const SPEC: SalaryOverview["payslips"][number] = { id: 9, payDate: "2026-10-23", name: "oktoberspec 2026", workMonth: "2026-09", gross: 2940728, tax: 560500, net: 2380228, hoursWorked: 147, salaryGroup: "b", codes: ["011"] };

  it("a payslip read in for the month: its net and gross are the next salary, with the forecast from the hours beside it", async () => {
    renderWith([entered("2026-08", "2026-09-25", { diff: 0 }), entered("2026-09", "2026-10-23")], "2026-09-26", [SPEC]);
    const h = await screen.findByRole("region", { name: /Nästa lön · 23\/10 · enligt lönespecen för september/ });
    expect(h.querySelector("[data-figure=net]")).toHaveTextContent(/23\s802 kr/);
    expect(h).toHaveTextContent(/brutto 29\s407 kr · skatt 5\s605 kr/);
    expect(h.querySelector("[data-spec-forecast]")).toHaveTextContent(/prognosen ur dina timmar: 24\s200 kr \(157,5 tim\)/);
    // The payslip's hours, not the entered ones.
    expect(h).toHaveTextContent(/Timmar i september 147/);
  });

  it("a payslip read in before the hours are entered: its figures, and a way to enter the month", async () => {
    renderWith([entered("2026-08", "2026-09-25", { diff: 0 })], "2026-09-26", [SPEC]);
    const h = await screen.findByRole("region", { name: /Nästa lön · 23\/10 · enligt lönespecen för september/ });
    expect(h.querySelector("[data-figure=net]")).toHaveTextContent(/23\s802 kr/);
    expect(screen.queryByTestId("no-forecast")).toBeNull();
    await userEvent.click(within(h).getByRole("button", { name: /Lägg in september för en prognos ur timmarna/ }));
    expect(screen.getByLabelText("Arbetsmånad")).toHaveValue("2026-09");
  });

  it("a payslip already paid is not the next salary", async () => {
    renderWith([entered("2026-08", "2026-09-25", { diff: 0 }), entered("2026-09", "2026-10-23")], "2026-10-24", [SPEC]);
    await screen.findByRole("region", { name: /Nästa lön/ });
    expect(screen.queryByText(/enligt lönespecen/)).toBeNull();
  });

  it("Sjuk: the month's days with their hours, a period with its karensavdrag, a day added or taken away at once", async () => {
    const sickDays = [
      { date: "2026-09-16", hours: 10.5 },
      { date: "2026-09-17", hours: 10.5 },
      { date: "2026-09-21", hours: 2 },
      { date: "2026-10-01", hours: 10.5 },
    ];
    fetchMock = mockApi({
      "GET /salary/months": [entered("2026-08", "2026-09-25", { diff: 0 })],
      "GET /salary": { ...OVERVIEW, today: "2026-09-26", average: AVERAGE, sickDays, sickPeriods: [{ from: "2026-09-16", to: "2026-09-21", days: sickDays.slice(0, 3), hours: 23 }] },
      "POST /salary/model": MODEL,
      "PUT /salary/sick": { sickDays },
      "DELETE /salary/sick": { sickDays },
    });
    render(<SalaryView />);
    await userEvent.selectOptions(await screen.findByLabelText("Arbetsmånad"), "2026-09");
    const toggle = screen.getByRole("button", { name: /Sjuk · 23 tim/ });
    await userEvent.click(toggle);
    const sick = screen.getByTestId("sick-fields");
    // This month's days only, with the hours; the period and where its karensavdrag is.
    expect(within(sick).getByLabelText("Sjuktimmar 2026-09-16")).toHaveValue("10,5");
    expect(within(sick).getByLabelText("Sjuktimmar 2026-09-21")).toHaveValue("2");
    expect(within(sick).queryByLabelText("Sjuktimmar 2026-10-01")).toBeNull();
    expect(sick.querySelector("[data-sick-period]")).toHaveTextContent("Sjukperiod 16/9–21/9 · 23 tim · karensavdrag i september");
    // Changing the hours saves that day.
    const two = within(sick).getByLabelText("Sjuktimmar 2026-09-21");
    await userEvent.clear(two);
    await userEvent.type(two, "4");
    await userEvent.tab();
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/salary/sick/2026-09-21").at(-1)?.[1]).toEqual({ hours: 4 }));
    // A day added: the date and, left empty, the hours of a shift.
    const form = within(sick).getByRole("form", { name: "Lägg till sjukdag" });
    await userEvent.type(within(form).getByLabelText("Sjukdag"), "2026-09-22");
    await userEvent.click(within(form).getByRole("button", { name: "Lägg till" }));
    await waitFor(() => expect(callsTo(fetchMock, "PUT", "/salary/sick/2026-09-22").at(-1)?.[1]).toEqual({ hours: 10.5 }));
    // Taken away.
    await userEvent.click(within(sick).getByRole("button", { name: "Ta bort 2026-09-17" }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/salary/sick/2026-09-17")).toHaveLength(1));
  });

  it("the latest salary in to the krona is green", async () => {
    renderWith([entered("2026-08", "2026-09-25", { diff: 0 }), entered("2026-09", "2026-10-23")]);
    const last = (await screen.findByRole("region", { name: /Nästa lön/ })).querySelector("[data-box=last-paid]") as HTMLElement;
    expect(last).toHaveTextContent("kom in exakt");
    expect(last).toHaveClass("bg-positive-soft");
  });

  it.each([
    [130, "under", null],
    [157.5, "between", null],
    [170, "over", "+4,4 tim över heltid"],
  ] as const)("the hours bar at %s hours: %s", async (hours, state, words) => {
    renderWith([entered("2026-09", "2026-10-23", { hours })]);
    await screen.findByRole("region", { name: /Nästa lön/ });
    const bar = hero().querySelector("[data-hours-bar]") as HTMLElement;
    expect(bar.dataset.hoursBar).toBe(state);
    if (state === "over") expect(bar.dataset.fill).toBe("1");
    if (words) expect(hero()).toHaveTextContent(words);
    else expect(hero().querySelector("[data-over]")).toBeNull();
  });

  it("a status pill per month: in exact, off by kronor, a forecast; the bar blue once paid, light blue before", async () => {
    renderWith([entered("2026-07", "2026-08-25", { diff: 0 }), entered("2026-08", "2026-09-25", { diff: 12000 }), entered("2026-09", "2026-10-23")]);
    await screen.findByRole("list", { name: "Inlagda månader" });
    const row = (m: string) => document.querySelector(`[data-month="${m}"]`) as HTMLElement;
    expect(row("2026-07").querySelector("[data-status]")).toHaveTextContent("kom in exakt");
    expect(row("2026-07").querySelector("[data-status=exact]")).toHaveClass("bg-positive-soft");
    expect(row("2026-08").querySelector("[data-status=off]")).toHaveTextContent(/avvek \+120\skr/);
    expect(row("2026-08").querySelector("[data-status=off]")).toHaveClass("bg-caution-soft");
    expect(row("2026-09").querySelector("[data-status=forecast]")).toHaveTextContent("prognos");
    expect(row("2026-09")).toHaveTextContent(/23\/10/);
    expect(row("2026-07").querySelector("[data-hours-bar] > span")).toHaveClass("bg-accent");
    expect(row("2026-09").querySelector("[data-hours-bar] > span")).toHaveClass("bg-accent-bar");
  });

  it("a month folds out to the net, how the gross is made up and the payslip; Ändra puts it in the form; the bin removes it", async () => {
    renderWith([entered("2026-07", "2026-08-25", { diff: 0 }), entered("2026-09", "2026-10-23")]);
    await userEvent.click(await screen.findByRole("button", { name: /juli 2026/, expanded: false }));
    const detail = screen.getByTestId("salary-detail");
    expect(detail).toHaveTextContent(/24\s200 kr\s*landar 25\/8/);
    expect(detail).toHaveTextContent(/kom in 24\s200 kr · exakt/);
    expect(detail).toHaveTextContent(/grundlön 26\s500 · tillägg 3\s500 → brutto 30\s000 · skatt −5\s800/);
    const slip = within(detail).getByRole("table", { name: "Lönerader" });
    expect(slip).toHaveTextContent(/011\s*Månadslön\s*26\s500 kr/);
    expect(slip).toHaveTextContent(/160\s*Mertid\s*17,5 × 200,00\s*3\s500 kr/);
    expect(slip.querySelector("[data-sum=gross]")).toHaveTextContent(/Bruttolön\s*30\s000 kr/);
    expect(slip.querySelector("[data-sum=net]")).toHaveTextContent(/Nettolön\s*24\s200 kr/);

    await userEvent.click(within(document.querySelector('[data-month="2026-07"]') as HTMLElement).getAllByRole("button", { name: "Ändra" })[0]);
    expect(screen.getByLabelText("Arbetsmånad")).toHaveValue("2026-07");
    expect(screen.getByLabelText("Timmar totalt")).toHaveValue("157,5");

    await userEvent.click(screen.getByRole("button", { name: "Ta bort september 2026" }));
    await waitFor(() => expect(callsTo(fetchMock, "DELETE", "/salary/months/2026-09")).toHaveLength(1));
  });

  it("the form starts on the first month missing", async () => {
    renderWith([entered("2026-07", "2026-08-25", { diff: 0 }), entered("2026-08", "2026-09-25", { diff: 0 }), entered("2026-09", "2026-10-23")]);
    expect(await screen.findByLabelText("Arbetsmånad")).toHaveValue("2026-10");
    expect(screen.getByRole("button", { name: "Spara oktober 2026" })).toBeDisabled();
    // A gap comes first.
    cleanup();
    renderWith([entered("2026-07", "2026-08-25", { diff: 0 }), entered("2026-09", "2026-10-23")]);
    expect(await screen.findByLabelText("Arbetsmånad")).toHaveValue("2026-08");
    expect(within(screen.getByLabelText("Arbetsmånad")).getByRole("option", { name: "juli 2026 · inlagd" })).toBeInTheDocument();
  });

  it("without the next month entered: a way to the form, on that month", async () => {
    renderWith([entered("2026-09", "2026-10-23")], "2026-09-19");
    expect(await screen.findByTestId("no-forecast")).toHaveTextContent("Lägg in augusti för att få en prognos");
    expect(screen.getByLabelText("Arbetsmånad")).toHaveValue("2026-10");
    await userEvent.click(screen.getByRole("button", { name: "Till formuläret ›" }));
    expect(screen.getByLabelText("Arbetsmånad")).toHaveValue("2026-08");
  });

  it("the forecast shows live in the hero while typing, and goes back to the next salary on Rensa", async () => {
    renderWith([entered("2026-08", "2026-09-25", { diff: 0 }), entered("2026-09", "2026-10-23")]);
    await screen.findByRole("region", { name: /Nästa lön · 23\/10/ });
    await userEvent.type(screen.getByLabelText("Timmar totalt"), "170");
    await waitFor(() => expect(callsTo(fetchMock, "POST", "/salary/model").at(-1)?.[1]).toMatchObject({ month: "2026-10", hours: 170 }));
    const h = await screen.findByRole("region", { name: /Förhandsvisning · 23\/10 · prognos för september/ });
    // The typed hours, over full time.
    expect(h).toHaveTextContent("+4,4 tim över heltid");
    await userEvent.click(screen.getByRole("button", { name: "Rensa" }));
    expect(await screen.findByRole("region", { name: /Nästa lön · 23\/10/ })).toBeInTheDocument();
  });
});
