import assert from "node:assert/strict";
import test from "node:test";
import { staffRegistrationDetailsReady } from "../src/lib/staffRegistrationDetails.ts";

test("identity registration requires contact details and valid duty hours", () => {
  const valid = ["Staff Name", "staff@example.com", "09123456789", "10:00", "18:00"];
  assert.equal(staffRegistrationDetailsReady("", ...valid.slice(1)), false);
  assert.equal(staffRegistrationDetailsReady(valid[0], "invalid", ...valid.slice(2)), false);
  assert.equal(staffRegistrationDetailsReady(valid[0], valid[1], " ", valid[3], valid[4]), false);
  assert.equal(staffRegistrationDetailsReady(valid[0], valid[1], valid[2], "", valid[4]), false);
  assert.equal(staffRegistrationDetailsReady(valid[0], valid[1], valid[2], valid[3], ""), false);
  assert.equal(staffRegistrationDetailsReady(valid[0], valid[1], valid[2], "18:00", "10:00"), false);
  assert.equal(staffRegistrationDetailsReady(...valid), true);
});
