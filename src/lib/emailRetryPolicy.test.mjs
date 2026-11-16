import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryEmailAutomatically } from "./emailRetryPolicy.ts";

test("retries transient email failures only up to the automatic attempt limit", () => {
  assert.equal(shouldRetryEmailAutomatically(1, true), true);
  assert.equal(shouldRetryEmailAutomatically(2, true), true);
  assert.equal(shouldRetryEmailAutomatically(3, true), false);
});

test("does not automatically retry permanent email failures", () => {
  assert.equal(shouldRetryEmailAutomatically(1, false), false);
});
