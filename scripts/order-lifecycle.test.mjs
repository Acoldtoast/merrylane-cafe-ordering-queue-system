import assert from "node:assert/strict";
import test from "node:test";
import {
  preparationEtaHasPassed,
  preparationMinutesElapsed,
  preparationReminderLevel,
  readyMinutesElapsed,
  readyReminderLevel,
} from "../src/lib/orderLifecycle.ts";

test("preparation duration stays anchored to the preparing timestamp", () => {
  const order = {
    status: "preparing",
    created_at: "2026-11-12T10:00:00.000Z",
    updated_at: "2026-11-14T23:59:00.000Z",
    preparing_at: "2026-11-12T10:30:00.000Z",
  };

  assert.equal(
    preparationMinutesElapsed(order, Date.parse("2026-11-15T00:00:00.000Z")),
    3690
  );
});

test("preparation duration falls back for older orders without preparing_at", () => {
  const order = {
    status: "preparing",
    created_at: "2026-11-12T10:00:00.000Z",
    updated_at: "2026-11-12T10:30:00.000Z",
  };

  assert.equal(
    preparationMinutesElapsed(order, Date.parse("2026-11-12T11:00:00.000Z")),
    30
  );
});

test("expired ETA reminders apply only to orders still preparing", () => {
  const now = Date.parse("2026-11-15T00:00:00.000Z");
  assert.equal(
    preparationEtaHasPassed(
      { status: "preparing", estimated_ready_at: "2026-11-12T11:00:00.000Z" },
      now
    ),
    true
  );
  assert.equal(
    preparationEtaHasPassed(
      { status: "ready", estimated_ready_at: "2026-11-12T11:00:00.000Z" },
      now
    ),
    false
  );
});

test("preparation reminders escalate as the order and ETA become more overdue", () => {
  const start = Date.parse("2026-11-15T00:00:00.000Z");
  const order = {
    status: "preparing",
    created_at: "2026-11-14T22:30:00.000Z",
    updated_at: "2026-11-14T22:30:00.000Z",
    preparing_at: "2026-11-14T22:30:00.000Z",
    estimated_ready_at: "2026-11-14T23:45:00.000Z",
  };

  assert.equal(preparationReminderLevel(order, start), 1);
  assert.equal(
    preparationReminderLevel(order, Date.parse("2026-11-15T01:00:00.000Z")),
    2
  );
  assert.equal(
    preparationReminderLevel(order, Date.parse("2026-11-15T03:00:00.000Z")),
    3
  );
});

test("serving orders stop accruing preparation time and reminders", () => {
  const now = Date.parse("2026-11-15T00:00:00.000Z");
  const order = {
    status: "ready",
    created_at: "2026-11-12T10:00:00.000Z",
    updated_at: "2026-11-12T10:30:00.000Z",
    preparing_at: "2026-11-12T10:30:00.000Z",
    estimated_ready_at: "2026-11-12T10:45:00.000Z",
  };

  assert.equal(preparationMinutesElapsed(order, now), null);
  assert.equal(preparationReminderLevel(order, now), 0);
});

test("served orders escalate follow-up reminders but stay uncompleted", () => {
  const now = Date.parse("2026-11-15T00:00:00.000Z");
  const order = {
    created_at: "2026-11-14T20:00:00.000Z",
    updated_at: "2026-11-14T23:00:00.000Z",
    ready_at: "2026-11-14T23:00:00.000Z",
  };

  assert.equal(readyMinutesElapsed(order, now), 60);
  assert.equal(readyReminderLevel(order, now), 2);
  assert.notEqual(order.status, "completed");
});
