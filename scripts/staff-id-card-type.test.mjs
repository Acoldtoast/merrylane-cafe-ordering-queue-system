import assert from "node:assert/strict";
import test from "node:test";
import { detectCardType } from "../src/lib/staffIdCardType.ts";

test("CafeTrack card-type markers distinguish supported ID text", () => {
  assert.equal(detectCardType("PHILSYS PAMBANSANG PAGKAKAKILANLAN").type, "philsys");
  assert.equal(detectCardType("LAND TRANSPORTATION OFFICE DRIVER'S LICENSE").type, "lto_license");
  assert.equal(detectCardType("PASSPORT DEPARTMENT OF FOREIGN AFFAIRS").type, "passport");
  assert.equal(detectCardType("PHILIPPINE POSTAL CORPORATION POSTAL ID").type, "postal");
  assert.equal(detectCardType("unreadable").type, null);
});
