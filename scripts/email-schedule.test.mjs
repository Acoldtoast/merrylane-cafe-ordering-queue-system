import assert from "node:assert/strict";
import test from "node:test";
import { reportWindow } from "../src/lib/emailSchedule.ts";

test("daily reports cover the previous Manila calendar day after send time", () => {
  assert.equal(
    reportWindow("daily", new Date("2026-11-11T23:59:00Z"), "08:00", "sales"),
    null
  );
  assert.deepEqual(
    reportWindow("daily", new Date("2026-11-12T00:00:00Z"), "08:00", "sales"),
    {
      key: "sales:daily:2026-11-11",
      start: "2026-11-11",
      end: "2026-11-11",
    }
  );
});

test("weekly reports cover the previous Monday-to-Sunday period", () => {
  assert.deepEqual(
    reportWindow("weekly", new Date("2026-11-12T02:00:00Z"), "08:00", "analytics"),
    {
      key: "analytics:weekly:2026-11-02:2026-11-08",
      start: "2026-11-02",
      end: "2026-11-08",
    }
  );
});

test("monthly reports cover the previous full calendar month", () => {
  assert.deepEqual(
    reportWindow("monthly", new Date("2026-11-01T01:00:00Z"), "08:00", "analytics"),
    {
      key: "analytics:monthly:2026-10-01:2026-10-31",
      start: "2026-10-01",
      end: "2026-10-31",
    }
  );
});

test("disabled schedules do not create report windows", () => {
  assert.equal(
    reportWindow("off", new Date("2026-11-12T04:00:00Z"), "08:00", "sales"),
    null
  );
});
