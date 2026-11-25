import assert from "node:assert/strict";
import test from "node:test";
import { defaultLastOrder, validLastOrder, weeklyScheduleError, WEEK_DAYS } from "../src/lib/orderingHours.ts";

test("last order defaults to 30 minutes before close and cannot reach or exceed it", () => {
  assert.equal(defaultLastOrder("09:00", "22:00"), "21:30");
  assert.equal(defaultLastOrder("09:00", "13:00"), "12:30");
  assert.equal(defaultLastOrder("09:00", "09:15"), "09:00");
  assert.equal(validLastOrder("12:59", "09:00", "13:00"), true);
  assert.equal(validLastOrder("13:00", "09:00", "13:00"), false);
  assert.equal(validLastOrder("13:01", "09:00", "13:00"), false);
});

test("midnight and overnight closes are checked in operating-day order", () => {
  assert.equal(defaultLastOrder("09:00", "00:00"), "23:30");
  assert.equal(defaultLastOrder("17:00", "00:10"), "23:40");
  assert.equal(defaultLastOrder("17:00", "01:00"), "00:30");
  assert.equal(validLastOrder("00:59", "17:00", "01:00"), true);
  assert.equal(validLastOrder("01:00", "17:00", "01:00"), false);
  assert.equal(validLastOrder("02:00", "17:00", "01:00"), false);
  assert.equal(validLastOrder("00:00", "09:00", "00:00"), false);
});

test("weekly schedule rejects a manual cutoff after close", () => {
  const schedule = WEEK_DAYS.map((day) => ({
    day, open: true, start: "09:00", end: "13:00", last_order: "12:30",
  }));
  assert.equal(weeklyScheduleError(schedule), null);
  schedule[1].last_order = "14:00";
  assert.match(weeklyScheduleError(schedule), /^Monday: Last order/);
});
