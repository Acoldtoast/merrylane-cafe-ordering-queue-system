import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseEmailDeliveryFailure } from "../src/lib/emailDiagnostics.ts";

test("explains rejected credentials without exposing the password", () => {
  const result = diagnoseEmailDeliveryFailure(
    {
      code: "EAUTH",
      message: "Invalid login: password-is-private",
    },
    ["password-is-private"]
  );

  assert.match(result.title, /rejected the account password/i);
  assert.match(result.fix, /app password/i);
  assert.match(result.server ?? "", /\[redacted\]/);
  assert.doesNotMatch(result.server ?? "", /password-is-private/);
});

test("explains SMTP server refusals and transient provider limits", () => {
  const senderRefusal = diagnoseEmailDeliveryFailure({
    responseCode: 553,
    message: "Message failed: sender refused",
  });
  const rateLimit = diagnoseEmailDeliveryFailure({
    responseCode: 421,
    message: "Try again later",
  });

  assert.match(senderRefusal.title, /SMTP server rejected/i);
  assert.equal(rateLimit.transient, true);
  assert.match(rateLimit.title, /temporarily/i);
});

test("recognizes host and TLS configuration errors", () => {
  const missingHost = diagnoseEmailDeliveryFailure({
    code: "ESOCKET",
    message: "getaddrinfo ENOTFOUND smtp.invalid",
  });
  const tls = diagnoseEmailDeliveryFailure({
    code: "ETLS",
    message: "Must use STARTTLS",
  });

  assert.match(missingHost.title, /host could not be found/i);
  assert.match(tls.fix, /587/);
  assert.match(tls.fix, /465/);
});

test("reports connection-check failures without implying a test email was sent", () => {
  const result = diagnoseEmailDeliveryFailure(new Error("Unrecognized SMTP failure"));

  assert.match(result.title, /SMTP connection could not be verified/i);
  assert.doesNotMatch(result.fix, /recipient|message/i);
});

test("explains SMTP key recovery without asking for the JWT secret", () => {
  const result = diagnoseEmailDeliveryFailure(
    new Error(
      "Could not decrypt the saved SMTP password. Check that SMTP_PASSWORD_ENCRYPTION_KEY has not changed."
    )
  );

  assert.match(result.fix, /SMTP_PASSWORD_ENCRYPTION_KEY/);
  assert.doesNotMatch(result.fix, /JWT_SECRET/);
});
