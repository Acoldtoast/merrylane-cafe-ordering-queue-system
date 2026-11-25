import test from "node:test";
import assert from "node:assert/strict";
import {
  blinkDrifted,
  blinkHoldComplete,
  blinkScores,
  eyeStates,
  faceMoved,
  facingForward,
  headYawDegrees,
  turnAccepted,
} from "../src/lib/faceCheckGuidance.ts";

function yawMatrix(degrees) {
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  // Column-major 4x4 rotation about the vertical axis.
  return { data: [cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, 0, 0, 0, 1] };
}

test("blink requires both eyes closed and then both open", () => {
  assert.deepEqual(eyeStates(0.05, 0.08), { open: true, closed: false });
  assert.deepEqual(eyeStates(0.9, 0.86), { open: false, closed: true });
  assert.deepEqual(eyeStates(0.9, 0.05), { open: false, closed: false });
  assert.deepEqual(eyeStates(NaN, 0.05), { open: false, closed: false });
  // A score inside the transition band is neither open nor closed.
  assert.deepEqual(eyeStates(0.4, 0.4), { open: false, closed: false });
});

test("reads blink coefficients by name and treats missing ones as open", () => {
  assert.deepEqual(
    blinkScores([
      { categoryName: "jawOpen", score: 0.4 },
      { categoryName: "eyeBlinkLeft", score: 0.82 },
      { categoryName: "eyeBlinkRight", score: 0.79 },
    ]),
    { left: 0.82, right: 0.79 }
  );
  assert.deepEqual(blinkScores(undefined), { left: 0, right: 0 });
});

test("reads head yaw in degrees and requires a 20 degree turn", () => {
  assert.equal(headYawDegrees(yawMatrix(0)), 0);
  assert.ok(Math.abs(Math.abs(headYawDegrees(yawMatrix(30))) - 30) < 1e-9);
  assert.equal(headYawDegrees(undefined), undefined);
  assert.equal(headYawDegrees({ data: [1, 0, 0] }), undefined);

  assert.equal(facingForward(12), true);
  assert.equal(facingForward(20), false);

  assert.equal(turnAccepted(18, 0), false);
  assert.equal(turnAccepted(22, 0), true);
  assert.equal(turnAccepted(-22, 0), true);
  // Only 14 degrees away from the captured frontal frame.
  assert.equal(turnAccepted(22, 8), false);
  assert.equal(turnAccepted(30, 8), true);
  assert.equal(turnAccepted(undefined, 0), true);
});

test("pose capture resets when the face moves", () => {
  assert.equal(faceMoved({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }), false);
  assert.equal(faceMoved({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 }), true);
});

test("tolerates small blink drift but flags a clear head movement", () => {
  const anchor = { x: 0.5, y: 0.5, turn: 0 };

  assert.equal(blinkDrifted(anchor, { x: 0.52, y: 0.51 }, 0.01), false);
  assert.equal(blinkDrifted(anchor, { x: 0.58, y: 0.5 }, 0.01), true);
  assert.equal(blinkDrifted(anchor, { x: 0.5, y: 0.5 }, 0.12), true);
});

test("each eye state must be held before it is captured", () => {
  assert.equal(blinkHoldComplete(1000, 1399), false);
  assert.equal(blinkHoldComplete(1000, 1400), true);
});
