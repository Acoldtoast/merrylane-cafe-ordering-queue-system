import assert from "node:assert/strict";
import test from "node:test";
import { staffFaceCheckRequired } from "../src/lib/staffFaceDuty.ts";

test("face check uses a nine-hour window and supports temporary overrides", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const base = { enrolled: true, verifiedAt: null, overrideUntil: null, now };
  assert.equal(staffFaceCheckRequired({ ...base, enrolled: false }), true);
  assert.equal(staffFaceCheckRequired(base), true);
  assert.equal(staffFaceCheckRequired({ ...base, verifiedAt: "2026-11-17T03:00:01Z" }), false);
  assert.equal(staffFaceCheckRequired({ ...base, verifiedAt: "2026-11-17T03:00:00Z" }), true);
  assert.equal(staffFaceCheckRequired({ ...base, verifiedAt: "2026-11-18T00:00:00Z" }), true);
  assert.equal(staffFaceCheckRequired({ ...base, overrideUntil: "2026-11-17T12:00:01Z" }), false);
  assert.equal(staffFaceCheckRequired({ ...base, overrideUntil: "2026-11-17T12:00:00Z" }), true);
  assert.equal(staffFaceCheckRequired({ ...base, verifiedAt: "2026-11-17T11:00:00Z", dutyHours: 0 }), true);
  assert.equal(staffFaceCheckRequired({ ...base, verifiedAt: "2026-11-17T10:00:01Z", dutyHours: 2 }), false);
  assert.equal(staffFaceCheckRequired({ ...base, verifiedAt: "2026-11-17T10:00:00Z", dutyHours: 2 }), true);
  assert.equal(staffFaceCheckRequired({ ...base, enrolled: false, overrideUntil: "2026-11-17T13:00:00Z" }), true);
});
