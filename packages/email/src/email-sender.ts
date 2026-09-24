import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { z } from 'zod';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** 寄出一封已經渲染好的信。production 用 Resend，本機與 CI 用 SMTP 寄到 Mailpit，測試用 RecordingEmailSender。 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

const common = { EMAIL_FROM: z.string().min(1) };

export const emailEnvSchema = z.discriminatedUnion('EMAIL_TRANSPORT', [
  z.object({
    ...common,
    EMAIL_TRANSPORT: z.literal('smtp'),
    SMTP_URL: z.string().default('smtp://localhost:1025'),
  }),
  z.object({
    ...common,
    EMAIL_TRANSPORT: z.literal('resend'),
    RESEND_API_KEY: z.string().min(1),
    /** 只給測試指向 stub server；正式環境不設定。 */
    RESEND_BASE_URL: z.url().optional(),
  }),
]);

export type EmailEnv = z.infer<typeof emailEnvSchema>;

export function createEmailSender(env: EmailEnv): EmailSender {
  if (env.EMAIL_TRANSPORT === 'smtp') {
    const transport = nodemailer.createTransport(env.SMTP_URL);
    return {
      async send(message) {
        await transport.sendMail({ from: env.EMAIL_FROM, ...message });
      },
    };
  }
  const resend = new Resend(env.RESEND_API_KEY, { baseUrl: env.RESEND_BASE_URL });
  return {
    async send(message) {
      const { error } = await resend.emails.send({
        from: env.EMAIL_FROM,
        ...message,
        to: [message.to],
      });
      if (error) throw new Error(`Resend 寄信失敗：${error.message}`);
    },
  };
}

/** 測試用：不寄出，只記錄寄過的信。 */
export class RecordingEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  /** 最後一封寄給這個地址的信。 */
  lastTo(to: string): EmailMessage | undefined {
    return this.sent.findLast((m) => m.to === to);
  }
}
