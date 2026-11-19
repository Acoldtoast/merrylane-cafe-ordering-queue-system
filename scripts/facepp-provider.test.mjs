import assert from "node:assert/strict";
import test from "node:test";
import { compareFacePlusPlus, facePlusPlusMode, verifyFacePlusPlusLogin } from "../src/lib/facepp.ts";

test("double-blink verification rejects a missing second blink", async () => {
  const image = "data:image/jpeg;base64,ZmFrZQ==";
  const result = await verifyFacePlusPlusLogin({
    referenceImage: image, frontImage: image, leftImage: image, rightImage: image,
    blinkEvidence: { before: image, closed: image, after: image },
    requireDoubleBlink: true,
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "blink_not_verified");
});

test("Face++ comparison rejects low confidence and accepts an established match", async (t) => {
  const saved = globalThis.fetch;
  const names = ["FACEPP_API_KEY", "FACEPP_API_SECRET", "FACEPP_API_REGION", "CAFETRACK_FACEPP_MIN_GAP_MS", "CAFETRACK_TEST_FACE_LIVENESS"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    globalThis.fetch = saved;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  process.env.FACEPP_API_KEY = "dummy-key";
  process.env.FACEPP_API_SECRET = "dummy-secret";
  process.env.FACEPP_API_REGION = "US";
  process.env.CAFETRACK_FACEPP_MIN_GAP_MS = "0";
  delete process.env.CAFETRACK_TEST_FACE_LIVENESS;
  assert.equal(facePlusPlusMode(), "enabled");
  const results = [74, 75];
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://api-us.faceplusplus.com/facepp/v3/compare");
    return Response.json({ confidence: results.shift() });
  };
  const image = "data:image/jpeg;base64,ZmFrZQ==";
  assert.equal((await compareFacePlusPlus(image, image)).status, "rejected");
  assert.equal((await compareFacePlusPlus(image, image)).status, "matched");
});
