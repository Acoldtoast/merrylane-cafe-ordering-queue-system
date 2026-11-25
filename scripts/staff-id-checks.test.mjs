import assert from "node:assert/strict";
import test from "node:test";
import {
  areStaffIdDetailsPassing,
  checkStaffIdBirthDate,
  checkStaffIdDetails,
  checkStaffIdExpiration,
  checkStaffIdName,
  checkStaffIdNumber,
  isStaffIdentityScanVerified,
  staffIdentityReviewCheck,
  staffIdExpirationWarning,
  staffIdExpirationState,
} from "../src/lib/staffIdChecks.ts";

test("name and ID number checks report pass, mismatch and unknown", () => {
  assert.equal(checkStaffIdName("Juan Santos Dela Cruz", "Juan Cruz"), "pass");
  assert.equal(checkStaffIdName("Maria Santos", "Juan Cruz"), "mismatch");
  assert.equal(checkStaffIdName("", "Juan Cruz"), "unknown");
  assert.equal(checkStaffIdNumber("1234-5678-9012-3456", "philsys"), "pass");
  assert.equal(checkStaffIdNumber("1234", "philsys"), "mismatch");
  assert.equal(checkStaffIdNumber("1234", "postal"), "pass");
});

test("staff identity scan passes only when both the ID type and face match", () => {
  assert.equal(isStaffIdentityScanVerified("match", "matched"), true);
  assert.equal(isStaffIdentityScanVerified("uncertain", "matched"), false);
  assert.equal(isStaffIdentityScanVerified("mismatch", "matched"), false);
  assert.equal(isStaffIdentityScanVerified("match", "unavailable"), false);
  assert.equal(isStaffIdentityScanVerified("match", "rejected"), false);
});

test("saved identity checks are passed only after the scan is verified", () => {
  assert.equal(staffIdentityReviewCheck("verified"), "pass");
  assert.equal(staffIdentityReviewCheck("awaiting_review"), "unknown");
});

test("required expiration dates must be valid and current", () => {
  assert.equal(checkStaffIdExpiration("", "drivers_license", "2026-03-01"), "unknown");
  assert.equal(checkStaffIdExpiration("2026-02-28", "drivers_license", "2026-03-01"), "mismatch");
  assert.equal(checkStaffIdExpiration("2026-03-01", "passport", "2026-03-01"), "pass");
  assert.equal(checkStaffIdExpiration("2026-02-30", "passport", "2026-03-01"), "mismatch");
  assert.equal(checkStaffIdExpiration("", "philsys", "2026-03-01"), "pass");
  assert.equal(staffIdExpirationState("", "postal", "2026-03-01"), "missing");
  assert.equal(staffIdExpirationWarning("", "passport", "2026-03-01"), "missing");
  assert.equal(staffIdExpirationWarning("2026-03-31", "drivers_license", "2026-03-01"), "expires_soon");
  assert.equal(staffIdExpirationWarning("2026-05-01", "drivers_license", "2026-03-01"), null);
  assert.equal(staffIdExpirationWarning("2026-02-28", "drivers_license", "2026-03-01"), "expired");
});

test("birth dates reject impossible, future, and malformed values", () => {
  assert.equal(checkStaffIdBirthDate("2000-02-29", "2026-03-01"), "pass");
  assert.equal(checkStaffIdBirthDate("2026-03-01", "2026-03-01"), "mismatch");
  assert.equal(checkStaffIdBirthDate("2001-02-29", "2026-03-01"), "mismatch");
  assert.equal(checkStaffIdBirthDate("", "2026-03-01"), "pass");
});

test("staff identity details pass only when every required field check passes", () => {
  const details = {
    name: "Juan Dela Cruz",
    number: "ABC123456",
    birth_date: "2000-02-29",
    expiration_date: "2030-03-01",
  };
  assert.equal(areStaffIdDetailsPassing(checkStaffIdDetails(details, "Juan Dela Cruz", "drivers_license")), true);
  assert.equal(areStaffIdDetailsPassing(checkStaffIdDetails({ ...details, expiration_date: "2020-03-01" }, "Juan Dela Cruz", "drivers_license")), false);
  assert.equal(areStaffIdDetailsPassing(checkStaffIdDetails({ ...details, number: "" }, "Juan Dela Cruz", "drivers_license")), false);
});
