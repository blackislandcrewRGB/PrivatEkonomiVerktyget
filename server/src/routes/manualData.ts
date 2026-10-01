import { Hono } from "hono";
import type { Db } from "../db/client.js";
import { manualData } from "../manualData/manualData.js";
import { todayLocal } from "../overview/dates.js";
import { isIsoDate } from "../import/text.js";

/** Att fylla i: what is typed in by hand, and how old each figure is. */
export function manualDataRoutes(db: Db) {
  const app = new Hono();
  // ?today=YYYY-MM-DD is for testing and looking back; default is the local date.
  app.get("/", (c) => {
    const q = c.req.query("today");
    return c.json(manualData(db, q && isIsoDate(q) ? q : todayLocal()));
  });
  return app;
}
