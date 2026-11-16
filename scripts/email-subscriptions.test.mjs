import assert from "node:assert/strict";
import test from "node:test";
import {
  addEmailSubscriptionRecipients,
  normalizeEmailSubscriptions,
  redirectEmailSubscriptionRecipients,
} from "../src/lib/emailSubscriptions.ts";

test("migrates existing shared settings to each stored recipient", () => {
  assert.deepEqual(
    normalizeEmailSubscriptions(undefined, {
      recipients: [" owner@example.com "],
      noStockAlerts: true,
      lowStockAlerts: false,
      salesCadence: "daily",
      analyticsCadence: "weekly",
      sendTime: "09:30",
    }),
    [
      {
        email: "owner@example.com",
        noStockAlerts: true,
        lowStockAlerts: false,
        salesCadence: "daily",
        analyticsCadence: "weekly",
        reportSendTime: "09:30",
      },
    ]
  );
});

test("keeps report frequencies independent and uses one recipient send time", () => {
  assert.deepEqual(
    normalizeEmailSubscriptions([
      {
        email: "owner@example.com",
        noStockAlerts: false,
        lowStockAlerts: true,
        salesCadence: "daily",
        salesSendTime: "08:15",
        analyticsCadence: "monthly",
        analyticsSendTime: "17:45",
      },
    ]),
    [
      {
        email: "owner@example.com",
        noStockAlerts: false,
        lowStockAlerts: true,
        salesCadence: "daily",
        analyticsCadence: "monthly",
        reportSendTime: "08:15",
      },
    ]
  );
});

test("migrates an analytics-only recipient's legacy report time", () => {
  assert.equal(
    normalizeEmailSubscriptions([
      {
        email: "owner@example.com",
        noStockAlerts: false,
        lowStockAlerts: false,
        salesCadence: "off",
        salesSendTime: "08:15",
        analyticsCadence: "monthly",
        analyticsSendTime: "17:45",
      },
    ])[0].reportSendTime,
    "17:45"
  );
});

test("rejects invalid recipient-specific report times", () => {
  assert.throws(
    () =>
      normalizeEmailSubscriptions([
        {
          email: "owner@example.com",
          noStockAlerts: false,
          lowStockAlerts: false,
          salesCadence: "daily",
          reportSendTime: "25:00",
          analyticsCadence: "off",
        },
      ]),
    /notification settings/
  );
});

test("normalizes subscription addresses and rejects duplicates", () => {
  assert.equal(
    normalizeEmailSubscriptions([
      {
        email: " Manager@example.com ",
        noStockAlerts: false,
        lowStockAlerts: true,
        salesCadence: "off",
        analyticsCadence: "monthly",
        reportSendTime: "08:00",
      },
    ])[0].email,
    "manager@example.com"
  );

  assert.throws(
    () =>
      normalizeEmailSubscriptions([
        {
          email: "manager@example.com",
          noStockAlerts: false,
          lowStockAlerts: false,
          salesCadence: "off",
          analyticsCadence: "off",
          reportSendTime: "08:00",
        },
        {
          email: "MANAGER@example.com",
          noStockAlerts: false,
          lowStockAlerts: false,
          salesCadence: "off",
          analyticsCadence: "off",
          reportSendTime: "08:00",
        },
      ]),
    /only be added once/
  );
});

test("redirects admin login-address notifications to the saved personal email", () => {
  assert.deepEqual(
    redirectEmailSubscriptionRecipients(
      [
        {
          email: "admin-login@example.test",
          noStockAlerts: true,
          lowStockAlerts: false,
          salesCadence: "daily",
          analyticsCadence: "off",
          reportSendTime: "08:00",
        },
      ],
      new Map([["admin-login@example.test", "owner@example.com"]])
    ),
    [
      {
        email: "owner@example.com",
        noStockAlerts: true,
        lowStockAlerts: false,
        salesCadence: "daily",
        analyticsCadence: "off",
        reportSendTime: "08:00",
      },
    ]
  );
});

test("does not deliver admin notifications to the login email without a personal address", () => {
  assert.deepEqual(
    redirectEmailSubscriptionRecipients(
      [
        {
          email: "admin-login@example.test",
          noStockAlerts: true,
          lowStockAlerts: true,
          salesCadence: "daily",
          analyticsCadence: "daily",
          reportSendTime: "08:00",
        },
        {
          email: "manager@example.com",
          noStockAlerts: false,
          lowStockAlerts: false,
          salesCadence: "weekly",
          analyticsCadence: "off",
          reportSendTime: "09:00",
        },
      ],
      new Map([["admin-login@example.test", null]])
    ),
    [
      {
        email: "manager@example.com",
        noStockAlerts: false,
        lowStockAlerts: false,
        salesCadence: "weekly",
        analyticsCadence: "off",
        reportSendTime: "09:00",
      },
    ]
  );
});

test("adds every enabled notification to the admin personal email", () => {
  assert.deepEqual(
    addEmailSubscriptionRecipients(
      [
        {
          email: "manager@example.com",
          noStockAlerts: true,
          lowStockAlerts: true,
          salesCadence: "daily",
          analyticsCadence: "weekly",
          reportSendTime: "08:00",
        },
      ],
      ["owner@example.com"]
    ),
    [
      {
        email: "manager@example.com",
        noStockAlerts: true,
        lowStockAlerts: true,
        salesCadence: "daily",
        analyticsCadence: "weekly",
        reportSendTime: "08:00",
      },
      {
        email: "owner@example.com",
        noStockAlerts: true,
        lowStockAlerts: true,
        salesCadence: "daily",
        analyticsCadence: "weekly",
        reportSendTime: "08:00",
      },
    ]
  );
});

test("merges subscriptions when the personal email is already a recipient", () => {
  const redirected = redirectEmailSubscriptionRecipients(
    [
      {
        email: "owner@example.com",
        noStockAlerts: false,
        lowStockAlerts: false,
        salesCadence: "off",
        analyticsCadence: "monthly",
        reportSendTime: "09:00",
      },
      {
        email: "admin-login@example.test",
        noStockAlerts: true,
        lowStockAlerts: true,
        salesCadence: "daily",
        analyticsCadence: "weekly",
        reportSendTime: "08:00",
      },
    ],
    new Map([["admin-login@example.test", "owner@example.com"]])
  );

  assert.equal(redirected.length, 1);
  assert.deepEqual(redirected[0], {
    email: "owner@example.com",
    noStockAlerts: true,
    lowStockAlerts: true,
    salesCadence: "daily",
    analyticsCadence: "weekly",
    reportSendTime: "09:00",
  });
});
