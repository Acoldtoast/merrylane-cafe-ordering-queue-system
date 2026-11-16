import assert from "node:assert/strict";
import test from "node:test";
import { settingsAuditChanges } from "../src/lib/settingsAudit.ts";

test("unchanged settings snapshots produce no audit details", () => {
  const schedule = [
    {
      day: "Monday",
      open: true,
      start: "09:00",
      end: "22:00",
      last_order: "21:00",
    },
  ];

  assert.deepEqual(
    settingsAuditChanges({
      previousValues: {
        cafe_name: "Merrylane Cafe",
        last_order_time: "21:00",
      },
      nextValues: {
        cafe_name: "Merrylane Cafe",
        last_order_time: "21:00",
      },
      previousSchedule: schedule,
      nextSchedule: schedule,
    }),
    []
  );
});

test("a schedule edit reports only the changed day and value", () => {
  const previousSchedule = [
    {
      day: "Monday",
      open: true,
      start: "09:00",
      end: "22:00",
      last_order: "20:30",
    },
    {
      day: "Tuesday",
      open: true,
      start: "09:00",
      end: "22:00",
      last_order: "21:00",
    },
  ];
  const nextSchedule = [
    { ...previousSchedule[0], last_order: "21:00" },
    { ...previousSchedule[1] },
  ];

  assert.deepEqual(
    settingsAuditChanges({
      previousValues: { last_order_time: "20:30" },
      nextValues: { last_order_time: "21:00" },
      previousSchedule,
      nextSchedule,
    }),
    ["Monday: last-order cutoff changed from 8:30 PM to 9:00 PM."]
  );
});

test("a scalar settings edit includes only its before and after values", () => {
  assert.deepEqual(
    settingsAuditChanges({
      previousValues: {
        service_charge_pct: "0",
        cafe_name: "Merrylane Cafe",
      },
      nextValues: {
        service_charge_pct: "5",
        cafe_name: "Merrylane Cafe",
      },
      previousSchedule: [],
    }),
    ["Service charge changed from 0% to 5%."]
  );
});

test("GCash QR audit details never include the image data", () => {
  const oldQr = "data:image/png;base64,private-old-image";
  const newQr = "data:image/png;base64,private-new-image";

  assert.deepEqual(
    settingsAuditChanges({
      previousValues: { gcash_qr_data_url: oldQr },
      nextValues: { gcash_qr_data_url: newQr },
      previousSchedule: [],
    }),
    ["GCash QR image replaced."]
  );
});
