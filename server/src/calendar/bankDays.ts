/**
 * Swedish bank days: every day except Saturdays, Sundays and the public
 * holidays that fall on a weekday. Dates are 'YYYY-MM-DD'; all arithmetic is UTC.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d));
const addDaysIso = (date: string, n: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));

/** Easter Sunday (Gregorian), Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(utc(year, month, day));
}

/**
 * The days banks are closed besides weekends: nyårsdagen, trettondedag jul,
 * långfredagen, annandag påsk, första maj, Kristi himmelsfärdsdag,
 * nationaldagen, midsommarafton, julafton, juldagen, annandag jul and
 * nyårsafton. (Påskdagen, pingstdagen, midsommardagen and alla helgons dag
 * are always weekend days.) Name by date.
 */
export function swedishBankHolidays(year: number): Map<string, string> {
  const easter = easterSunday(year);
  // Midsommarafton: the Friday between 19 and 25 June.
  const june19 = utc(year, 6, 19);
  const midsummerEve = iso(new Date(june19.getTime() + ((5 - june19.getUTCDay() + 7) % 7) * 86_400_000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const fixed = (m: number, d: number) => `${year}-${pad(m)}-${pad(d)}`;
  return new Map([
    [fixed(1, 1), "Nyårsdagen"],
    [fixed(1, 6), "Trettondedag jul"],
    [addDaysIso(easter, -2), "Långfredagen"],
    [addDaysIso(easter, 1), "Annandag påsk"],
    [fixed(5, 1), "Första maj"],
    [addDaysIso(easter, 39), "Kristi himmelsfärdsdag"],
    [fixed(6, 6), "Sveriges nationaldag"],
    [midsummerEve, "Midsommarafton"],
    [fixed(12, 24), "Julafton"],
    [fixed(12, 25), "Juldagen"],
    [fixed(12, 26), "Annandag jul"],
    [fixed(12, 31), "Nyårsafton"],
  ]);
}

const holidayCache = new Map<number, Map<string, string>>();
function holidays(year: number) {
  let h = holidayCache.get(year);
  if (!h) holidayCache.set(year, (h = swedishBankHolidays(year)));
  return h;
}

export function isBankDay(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidays(Number(date.slice(0, 4))).has(date);
}

/** The date itself if it is a bank day, else the next one. */
export function nextBankDay(date: string): string {
  let d = date;
  while (!isBankDay(d)) d = addDaysIso(d, 1);
  return d;
}

/** The date itself if it is a bank day, else the one before. */
export function previousBankDay(date: string): string {
  let d = date;
  while (!isBankDay(d)) d = addDaysIso(d, -1);
  return d;
}

/** The last bank day of a month ('YYYY-MM'). */
export function lastBankDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return previousBankDay(iso(utc(y, m + 1, 0)));
}
