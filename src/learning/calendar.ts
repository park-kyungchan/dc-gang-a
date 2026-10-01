import { assertDate, requireText } from "./model";

/** Calendar arithmetic only. The input already belongs to a verified local calendar. */
export function weekStartForLocalDate(localDate: string): string {
  assertDate(localDate);
  const date = new Date(`${localDate}T00:00:00Z`);
  return shiftLocalDate(localDate, -((date.getUTCDay() + 6) % 7));
}

/** A selector is the Monday date, not an ISO week number or an arbitrary lesson date. */
export function assertWeekStart(weekStart: string): void {
  assertDate(weekStart);
  if (weekStartForLocalDate(weekStart) !== weekStart) throw new Error("week start must be a Monday");
}

export function localCalendarWeek(localDate: string): Readonly<{
  weekStart: string; weekEnd: string; startsOn: "monday";
}> {
  const weekStart = weekStartForLocalDate(localDate);
  return Object.freeze({ weekStart, weekEnd: shiftLocalDate(weekStart, 6), startsOn: "monday" });
}

export function assertLearningTimeZone(timeZone: string): void {
  requireText(timeZone, "time zone");
  try { new Intl.DateTimeFormat("en", { timeZone }); }
  catch { throw new Error("invalid time zone"); }
}

function shiftLocalDate(localDate: string, days: number): string {
  // UTC is used only to do Gregorian date arithmetic without host DST effects.
  // This never converts a source timestamp or a lesson from another time zone.
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().split("T")[0]!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error("week exceeds the supported local calendar range");
  assertDate(result);
  return result;
}
