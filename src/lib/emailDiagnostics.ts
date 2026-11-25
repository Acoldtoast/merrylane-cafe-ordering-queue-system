export interface EmailDeliveryDiagnosis {
  title: string;
  fix: string;
  transient: boolean;
  server?: string;
}

const UNKNOWN: Omit<EmailDeliveryDiagnosis, "server"> = {
  title: "The SMTP connection could not be verified.",
  fix: "Check the SMTP host, port, account, password, sender address, and encryption mode.",
  transient: false,
};

function errorText(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return String(error ?? "");
}

function cleanServerMessage(error: unknown, secrets: string[]) {
  let message = errorText(error).trim();
  message = message.replace(
    /^(Message failed|Connection timeout|Greeting never received|Invalid login|Sending failed|Login denied)\s*:?\s*/i,
    ""
  );
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message.slice(0, 300);
}

const RECIPIENT_REJECTION_CODES = new Set([550, 551, 553, 554]);
const RECIPIENT_REJECTION_TEXT =
  /(recipient|mailbox|user unknown|unknown user|no such user|does not exist|not a local user)/i;
const SENDER_REJECTION_TEXT = /(sender|return.?path|from address)/i;

function smtpErrorEntries(error: unknown): Record<string, unknown>[] {
  if (typeof error !== "object" || error === null) return [];
  const details = error as Record<string, unknown>;
  const entries = [details];
  if (Array.isArray(details.rejectedErrors)) {
    for (const rejected of details.rejectedErrors) {
      if (
        typeof rejected === "object" &&
        rejected !== null &&
        !Array.isArray(rejected)
      ) {
        entries.push(rejected as Record<string, unknown>);
      }
    }
  }
  return entries;
}

function serverResponses(error: unknown): string[] {
  return smtpErrorEntries(error)
    .map((entry) =>
      typeof entry.response === "string" ? entry.response.trim() : ""
    )
    .filter(Boolean);
}

function serverDetail(
  error: unknown,
  secrets: string[]
): string | undefined {
  const message = errorText(error);
  const responses = serverResponses(error).filter(
    (response) => !message.includes(response)
  );
  return (
    cleanServerMessage([message, ...responses].join(" "), secrets) || undefined
  );
}

function recipientAddressWasRejected(
  error: unknown,
  responseCode: number,
  message: string
): boolean {
  const entries = smtpErrorEntries(error);
  const commands = entries.map((entry) =>
    typeof entry.command === "string" ? entry.command.toUpperCase() : ""
  );
  if (commands.some((command) => command.includes("RCPT"))) return true;
  // A refusal on MAIL FROM is about the sender, never the recipient.
  if (commands.some((command) => command.includes("MAIL"))) return false;
  if (!RECIPIENT_REJECTION_CODES.has(responseCode)) return false;

  const detail = `${message} ${serverResponses(error).join(" ")}`;
  if (SENDER_REJECTION_TEXT.test(detail)) return false;
  return RECIPIENT_REJECTION_TEXT.test(detail);
}

export function diagnoseEmailDeliveryFailure(
  error: unknown,
  secrets: string[] = []
): EmailDeliveryDiagnosis {
  const details =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const code = typeof details.code === "string" ? details.code.toUpperCase() : "";
  const responseCode =
    typeof details.responseCode === "number" ? details.responseCode : 0;
  const message = errorText(error);
  const combined = `${code} ${message}`.toUpperCase();
  let diagnosis: Omit<EmailDeliveryDiagnosis, "server"> = UNKNOWN;

  if (responseCode === 535 || code === "EAUTH") {
    diagnosis = {
      title: "The mail server rejected the account password.",
      fix: "Check the account email and use the provider's app password if required. Gmail, for example, needs 2-Step Verification enabled before you can create an app password.",
      transient: false,
    };
  } else if (recipientAddressWasRejected(error, responseCode, message)) {
    diagnosis = {
      title: "The mail server rejected the recipient address.",
      fix: "That address cannot receive mail, usually because it does not exist. Check it for a typo and correct or remove it from the email recipients; retrying will not succeed until the address changes.",
      transient: false,
    };
  } else if ([550, 553, 554].includes(responseCode) || code === "EENVELOPE") {
    diagnosis = {
      title: "The SMTP server rejected the connection or account.",
      fix: "Check the SMTP account, host, port, and encryption settings.",
      transient: false,
    };
  } else if ([421, 450, 452].includes(responseCode)) {
    diagnosis = {
      title: "The mail server is temporarily limiting email delivery.",
      fix: "Wait a few minutes and try again. The provider may be rate-limiting messages; changing the password is unlikely to help.",
      transient: true,
    };
  } else if (/SMTP_PASSWORD_ENCRYPTION_KEY/i.test(combined)) {
    diagnosis = {
      title: "The saved SMTP password cannot be read.",
      fix: "Restore the same SMTP_PASSWORD_ENCRYPTION_KEY from this installation's .env.local, or enter the Google app password again and save the settings.",
      transient: false,
    };
  } else if (/JWT_SECRET|DECRYPT.*PASSWORD/i.test(combined)) {
    diagnosis = {
      title: "The saved SMTP password cannot be read.",
      fix: "Restore the same JWT_SECRET used when the password was saved, or enter the SMTP app password again and save the settings.",
      transient: false,
    };
  } else if (/COMPLETE THE SMTP/i.test(combined)) {
    diagnosis = {
      title: "The email setup is incomplete.",
      fix: "Save a valid SMTP host, sender address, and account credentials if required.",
      transient: false,
    };
  } else if (/ETLS|STARTTLS|ALL CONNECTIONS MUST USE SSL/i.test(combined)) {
    diagnosis = {
      title: "The server did not accept the selected encryption mode.",
      fix: "Use port 587 with SSL/TLS off for STARTTLS, or port 465 with SSL/TLS on for an implicit TLS connection.",
      transient: false,
    };
  } else if (/ENOTFOUND|GETADDRINFO/i.test(combined)) {
    diagnosis = {
      title: "The SMTP host could not be found.",
      fix: "Check the spelling and enter only the server name, such as smtp.gmail.com, without https:// or a path.",
      transient: false,
    };
  } else if (/ECONNREFUSED/i.test(combined)) {
    diagnosis = {
      title: "The network refused the SMTP connection.",
      fix: "Confirm the host and port, then check whether this computer, router, or network blocks outbound SMTP.",
      transient: false,
    };
  } else if (/ETIMEDOUT|TIMEOUT/i.test(combined)) {
    diagnosis = {
      title: "The SMTP server did not respond in time.",
      fix: "Try again shortly. If it keeps happening, verify the host and port and check the network connection.",
      transient: true,
    };
  } else if (/ECONNECTION|ESOCKET/i.test(combined)) {
    diagnosis = {
      title: "The connection to the SMTP server failed.",
      fix: "Confirm the SMTP host and port, then check the machine's network and firewall settings.",
      transient: true,
    };
  }

  const server = serverDetail(error, secrets);
  return server ? { ...diagnosis, server } : diagnosis;
}
