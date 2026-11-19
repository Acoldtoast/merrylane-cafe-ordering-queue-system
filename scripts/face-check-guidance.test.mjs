import test from "node:test";
import assert from "node:assert/strict";
import { blinkHoldComplete, eyeStates, faceMoved } from "../src/lib/faceCheckGuidance.ts";

test("blink requires both eyes closed and then both open", () => {
  assert.deepEqual(eyeStates(0.3, 0.3), { open: true, closed: false });
  assert.deepEqual(eyeStates(0.1, 0.1), { open: false, closed: true });
  assert.deepEqual(eyeStates(0.1, 0.3), { open: false, closed: false });
  assert.deepEqual(eyeStates(NaN, 0.1), { open: false, closed: false });
});

test("pose capture resets when the face moves", () => {
  assert.equal(faceMoved({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }), false);
  assert.equal(faceMoved({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 }), true);
});

test("each eye state must be held before it is captured", () => {
  assert.equal(blinkHoldComplete(1000, 1399), false);
  assert.equal(blinkHoldComplete(1000, 1400), true);
});
