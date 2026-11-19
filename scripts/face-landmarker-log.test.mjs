import assert from "node:assert/strict";
import test from "node:test";
import { initializeWithoutTfliteInfo, runWithoutTfliteInfo } from "../src/lib/faceLandmarkerLog.ts";

test("filters only the known TFLite information message and restores logging", () => {
  const previous = console.error;
  const messages = [];
  try {
    console.error = (...args) => messages.push(args);
    const logger = console.error;
    assert.equal(runWithoutTfliteInfo(() => {
      console.error("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.");
      console.error("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.\n", "additional context");
      console.error("\u001b[0mINFO: Created TensorFlow Lite XNNPACK delegate for CPU.\u001b[0m");
      console.error("A real error");
      return 7;
    }), 7);
    assert.equal(console.error, logger);
    assert.deepEqual(messages, [["A real error"]]);
    assert.throws(() => runWithoutTfliteInfo(() => { throw new Error("failure"); }));
    assert.equal(console.error, logger);
  } finally { console.error = previous; }
});

test("a WASM logger bound during initialization still filters later messages", async () => {
  const previous = console.error;
  const messages = [];
  try {
    console.error = (...args) => messages.push(args);
    const logger = console.error;
    const bound = await initializeWithoutTfliteInfo(async () => console.error.bind(console));
    assert.equal(console.error, logger);
    bound("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.");
    bound("A genuine error");
    assert.deepEqual(messages, [["A genuine error"]]);
  } finally { console.error = previous; }
});
