import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';

export interface Mailer {
  sendLoginCode(email: string, code: string): Promise<void>;
}

/** Sends through Resend's HTTP API. https://resend.com/docs/api-reference/emails/send-email */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendLoginCode(email: string, code: string): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [email],
        subject: `${code} is your Haunts code`,
        text: `Your Haunts sign-in code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email.`,
        html: `<p>Your Haunts sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you did not ask for it, ignore this email.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

/** Development fallback: writes the code to the server log. */
export class LogMailer implements Mailer {
  constructor(private readonly log: FastifyBaseLogger) {}
  async sendLoginCode(email: string, code: string): Promise<void> {
    this.log.warn({ email, code }, 'LogMailer: sign-in code (configure RESEND_API_KEY to send real email)');
  }
}

export function createMailer(config: Config, log: FastifyBaseLogger): Mailer {
  return config.resendApiKey ? new ResendMailer(config.resendApiKey, config.emailFrom) : new LogMailer(log);
}
