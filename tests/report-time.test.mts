import test from "node:test";
import assert from "node:assert/strict";
import { cooReportKey, dailyReportKey, startOfTehranDay, tehranDateKey } from "../src/lib/report-time.ts";

test("tehranDateKey uses Asia/Tehran, not UTC", () => {
  assert.equal(tehranDateKey(new Date("2026-11-07T20:29:59Z")), "2026-11-07");
  assert.equal(tehranDateKey(new Date("2026-11-07T20:30:00Z")), "2026-11-08");
});

test("daily keys are stable per agent/chat/day and differ across days", () => {
  const a = dailyReportKey(7, "123", new Date("2026-11-07T10:00:00Z"));
  const b = dailyReportKey(7, "123", new Date("2026-11-07T18:00:00Z"));
  const c = dailyReportKey(7, "123", new Date("2026-11-08T10:00:00Z"));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, dailyReportKey(8, "123", new Date("2026-11-07T10:00:00Z")));
  assert.notEqual(a, dailyReportKey(7, "456", new Date("2026-11-07T10:00:00Z")));
});

test("coo key is separate from agent keys", () => {
  const now = new Date("2026-11-07T10:00:00Z");
  assert.notEqual(cooReportKey("123", now), dailyReportKey(1, "123", now));
});

test("startOfTehranDay is 00:00 +03:30", () => {
  assert.equal(startOfTehranDay(new Date("2026-11-07T21:00:00Z")).toISOString(), "2026-11-07T20:30:00.000Z");
});
