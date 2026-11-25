import assert from "node:assert/strict";
import test from "node:test";
import { validDutyHours } from "../src/lib/dutyHoursValidation.ts";

test("same-day duty ends after start, including noon conversion", () => {
  assert.equal(validDutyHours("10:00 AM – 8:00 AM"), false);
  assert.equal(validDutyHours("10:00 AM – 8:00 PM"), true);
  assert.equal(validDutyHours("12:00 PM – 1:00 PM"), true);
  assert.equal(validDutyHours("1:00 AM – 1:00 AM"), false);
  assert.equal(validDutyHours(""), true);
  assert.equal(validDutyHours("nonsense"), false);
});
