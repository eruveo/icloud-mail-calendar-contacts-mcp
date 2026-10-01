import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { assertAllowed, type IcloudConfig } from "./config.js";
import { formatImapError } from "./redact.js";

export interface SendEmailInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyToMessageId?: string;
  references?: string;
  attachmentPaths?: string[];
}

export interface MailSender {
  send(mail: nodemailer.SendMailOptions): Promise<{ messageId: string }>;
}

export function createSmtpSender(config: IcloudConfig): MailSender {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    requireTLS: config.smtp.port !== 465,
    auth: {
      user: config.email,
      pass: config.appPassword,
    },
    tls: { minVersion: "TLSv1.2" },
  } satisfies SMTPTransport.Options);
  return {
    async send(mail) {
      const result = await transport.sendMail(mail);
      return { messageId: result.messageId };
    },
  };
}

async function resolveAttachment(
  filePath: string,
  attachmentRoot: string | null,
): Promise<{ filename: string; path: string }> {
  const absolute = path.resolve(filePath);
  const real = await realpath(absolute);
  if (attachmentRoot) {
    const root = await realpath(path.resolve(attachmentRoot));
    if (real !== root && !real.startsWith(root + path.sep)) {
      throw new Error(
        `Attachment path is outside ICLOUD_ATTACHMENT_ROOT (${attachmentRoot}).`,
      );
    }
  }
  const info = await stat(real);
  if (!info.isFile()) {
    throw new Error(`Attachment is not a file: ${filePath}`);
  }
  return { filename: path.basename(real), path: real };
}

export async function composeRfc822(
  from: string,
  input: SendEmailInput,
  attachmentRoot: string | null,
): Promise<Buffer> {
  const attachments = await Promise.all(
    (input.attachmentPaths ?? []).map(async (filePath) => {
      const resolved = await resolveAttachment(filePath, attachmentRoot);
      return {
        filename: resolved.filename,
        content: createReadStream(resolved.path),
      };
    }),
  );
  const composer = new MailComposer({
    from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    html: input.html,
    inReplyTo: input.replyToMessageId,
    references: input.references,
    attachments,
  });
  return composer.compile().build();
}

export class SmtpMailer {
  constructor(
    private readonly config: IcloudConfig,
    private readonly sender: MailSender = createSmtpSender(config),
  ) {}

  async send(input: SendEmailInput): Promise<{ messageId: string }> {
    assertAllowed(this.config.permissions, "allowSend", "send email");
    if (!input.subject.trim()) {
      throw new Error("subject is required.");
    }
    const to = Array.isArray(input.to) ? input.to : [input.to];
    if (to.length === 0 || to.every((entry) => !entry.trim())) {
      throw new Error("At least one To recipient is required.");
    }
    try {
      const attachments = await Promise.all(
        (input.attachmentPaths ?? []).map((filePath) =>
          resolveAttachment(filePath, this.config.attachmentRoot),
        ),
      );
      return await this.sender.send({
        from: this.config.email,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: input.text,
        html: input.html,
        inReplyTo: input.replyToMessageId,
        references: input.references,
        attachments: attachments.map((file) => ({
          filename: file.filename,
          path: file.path,
        })),
      });
    } catch (error) {
      throw formatImapError(error, [this.config.appPassword]);
    }
  }

  async composeDraft(input: SendEmailInput): Promise<Buffer> {
    return composeRfc822(this.config.email, input, this.config.attachmentRoot);
  }
}
