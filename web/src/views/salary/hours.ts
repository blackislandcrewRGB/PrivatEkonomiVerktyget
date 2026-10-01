/**
 * The hours bar: the month's hours against full time (the whole bar), with a
 * marker at the working time ('mått', 140). Under it nothing is mertid;
 * between it and full time the hours are mertid; over full time the bar is
 * full and the hours over are said in words.
 */
export function hoursBar(hours: number, measure: number, full: number) {
  const state = hours <= measure ? ("under" as const) : hours <= full ? ("between" as const) : ("over" as const);
  return {
    state,
    /** Share of the bar filled, 0–1. */
    fill: full > 0 ? Math.min(1, Math.max(0, hours / full)) : 0,
    /** Where the working time's marker sits, 0–1. */
    marker: full > 0 ? Math.min(1, measure / full) : 0,
    /** Hours over full time (0 unless 'over'). */
    over: state === "over" ? Math.round((hours - full) * 100) / 100 : 0,
  };
}
