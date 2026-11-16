import nodemailer from "nodemailer";
import {
  getSmtpConfiguration,
  smtpConnectionIsReady,
  smtpIsReady,
  type SmtpConfiguration,
} from "./emailSettings";

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

export function createSmtpTransport(config: SmtpConfiguration) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    ...(config.smtpUser
      ? { auth: { user: config.smtpUser, pass: config.smtpPassword } }
      : {}),
  });
}

async function deliverEmail(
  config: SmtpConfiguration,
  message: EmailMessage,
  recipients: string[]
): Promise<void> {
  const transport = createSmtpTransport(config);
  try {
    await transport.sendMail({
      from: { name: config.fromName, address: config.fromEmail },
      to: recipients,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } finally {
    transport.close();
  }
}

export async function sendConfiguredEmail(
  message: EmailMessage,
  recipients?: string[]
): Promise<void> {
  const config = await getSmtpConfiguration();
  if (!smtpIsReady(config)) {
    throw new Error(
      "Complete the SMTP server, sender, recipient, and authentication settings first."
    );
  }
  const to =
    recipients ?? config.subscriptions.map((subscription) => subscription.email);
  if (to.length === 0) {
    throw new Error("Add at least one email recipient before sending.");
  }

  await deliverEmail(config, message, to);
}

export async function sendTransactionalEmail(
  message: EmailMessage,
  recipients: string[],
  configuredSmtp?: SmtpConfiguration
): Promise<void> {
  const config = configuredSmtp ?? (await getSmtpConfiguration());
  if (!smtpConnectionIsReady(config)) {
    throw new Error(
      "Complete the SMTP server, sender, and authentication settings first."
    );
  }
  const to = [...new Set(recipients.map((recipient) => recipient.trim()).filter(Boolean))];
  if (to.length === 0) {
    throw new Error("At least one email recipient is required.");
  }
  await deliverEmail(config, message, to);
}

export async function verifySmtpConnection(
  config: SmtpConfiguration
): Promise<void> {
  if (!smtpConnectionIsReady(config)) {
    throw new Error(
      "Complete the SMTP server, sender, and authentication settings first."
    );
  }

  const transport = createSmtpTransport(config);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
