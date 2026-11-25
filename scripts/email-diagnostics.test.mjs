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

test("identifies a rejected recipient address instead of blaming the SMTP host", () => {
  const result = diagnoseEmailDeliveryFailure(
    Object.assign(
      new Error(
        "Message failed: 550 5.1.1 <nobody@example.com>: Recipient address rejected: User unknown"
      ),
      { code: "EENVELOPE", responseCode: 550, command: "RCPT TO" }
    ),
    ["nobody@example.com"]
  );

  assert.match(result.title, /rejected the recipient address/i);
  assert.match(result.fix, /typo/i);
  assert.doesNotMatch(result.fix, /encryption/i);
  assert.doesNotMatch(result.title, /connection or account/i);
  assert.equal(result.transient, false);
});

test("does not report a sender-address refusal as a rejected recipient", () => {
  const result = diagnoseEmailDeliveryFailure({
    code: "EENVELOPE",
    responseCode: 550,
    command: "MAIL FROM",
    message:
      "Message failed: 550 5.1.8 <cafe@example.com>: Sender address rejected",
  });

  assert.doesNotMatch(result.title, /recipient/i);
  assert.match(result.title, /SMTP server rejected/i);

  const withoutCommand = diagnoseEmailDeliveryFailure({
    code: "EENVELOPE",
    responseCode: 550,
    message: "Message failed: 550 5.1.8 Sender address rejected",
  });
  assert.doesNotMatch(withoutCommand.title, /recipient/i);
});

test("reads recipient refusals from Nodemailer rejectedErrors", () => {
  const result = diagnoseEmailDeliveryFailure({
    code: "EENVELOPE",
    message: "Message failed",
    rejectedErrors: [
      {
        command: "RCPT TO",
        responseCode: 550,
        response: "550 5.1.1 mailbox unavailable",
      },
    ],
  });

  assert.match(result.title, /rejected the recipient address/i);
  assert.match(result.server ?? "", /mailbox unavailable/);
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
