import assert from "node:assert/strict";
import test from "node:test";
import { extractStaffIdSuggestions } from "../src/lib/staffIdExtract.ts";

test("OCR suggestions use labelled fields and leave unknown details empty", () => {
  assert.deepEqual(extractStaffIdSuggestions("FULL NAME: Juan Dela Cruz\nID NUMBER: 1234\nDATE OF BIRTH: 12/17/2003"), { name: "Juan Dela Cruz", number: "1234", birth_date: "2003-12-17", expiration_date: "" });
  assert.deepEqual(extractStaffIdSuggestions("PhilSys random text"), { name: "", number: "", birth_date: "", expiration_date: "" });
});

test("extracts common PhilSys labels and a printed number", () => {
  assert.deepEqual(extractStaffIdSuggestions("1234-5678-9012-3456\nAPELYIDO / LAST NAME\nDELA CRUZ\nMGA PANGALAN / GIVEN NAMES\nJUAN\nGITNANG APELYIDO / MIDDLE NAME\nSANTOS\nPETSA NG KAPANGANAKAN / DATE OF BIRTH\nDecember 17, 2003"), { name: "JUAN SANTOS DELA CRUZ", number: "1234-5678-9012-3456", birth_date: "2003-12-17", expiration_date: "" });
});

test("extracts a labelled expiration date conservatively", () => {
  assert.deepEqual(
    extractStaffIdSuggestions("FULL NAME: Juan Dela Cruz\nEXPIRY DATE: 12/17/2030"),
    { name: "Juan Dela Cruz", number: "", birth_date: "", expiration_date: "2030-12-17" }
  );
  assert.equal(extractStaffIdSuggestions("VALID UNTIL\nDecember 17, 2030").expiration_date, "2030-12-17");
});
