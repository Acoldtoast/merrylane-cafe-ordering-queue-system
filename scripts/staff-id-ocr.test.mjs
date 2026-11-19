import assert from "node:assert/strict";
import test from "node:test";
import { scanStaffId } from "../src/lib/staffIdOcr.ts";

test("OCR ID detection reports matches, mismatches and uncertain readings", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OCR_SPACE_API_KEY;
  try {
    process.env.OCR_SPACE_API_KEY = "dummy-test-key";
    const texts = ["PHILSYS PAMBANSANG PAGKAKAKILANLAN", "PASSPORT", "unreadable"];
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.ocr.space/parse/image");
      assert.equal(init.headers.apikey, "dummy-test-key");
      return Response.json({ ParsedResults: [{ ParsedText: texts.shift() }] });
    };
    const image = new Blob(["dummy"], { type: "image/jpeg" });
    assert.equal((await scanStaffId(image, "philsys")).outcome, "match");
    assert.equal((await scanStaffId(image, "philsys")).outcome, "mismatch");
    assert.equal((await scanStaffId(image, "philsys")).outcome, "uncertain");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OCR_SPACE_API_KEY;
    else process.env.OCR_SPACE_API_KEY = previousKey;
  }
});
