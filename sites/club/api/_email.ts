/**
 * Mail from the Computer Club (verification links, password resets), sent
 * through Resend from `mail.mockintosh.com`. `RESEND_API_KEY` is a
 * sending-only key limited to that domain. Without one, off Vercel, the
 * message is printed instead, so local sign-ups can follow their links.
 */

export interface Email {
  to: string;
  subject: string;
  /** Plain text; the only body we send. */
  text: string;
}

export type SendEmail = (email: Email) => Promise<void>;

const FROM = "Mockintosh Computer Club <club@mail.mockintosh.com>";
const RESEND_URL = "https://api.resend.com/emails";

export function emailSender(env: { apiKey?: string; hosted: boolean } = {
  apiKey: process.env.RESEND_API_KEY?.trim() || undefined,
  hosted: !!process.env.VERCEL,
}): SendEmail {
  const { apiKey } = env;
  if (!apiKey) {
    return async (email) => {
      if (env.hosted) throw new Error("Email is not set up: RESEND_API_KEY is missing");
      console.log(`\n[email to ${email.to}] ${email.subject}\n${email.text}\n`);
    };
  }
  return async (email) => {
    const resp = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [email.to], subject: email.subject, text: email.text }),
    });
    if (!resp.ok) {
      // Resend's body can describe our account; keep it in the logs.
      console.error("Resend error:", resp.status, await resp.text());
      throw new Error(`Couldn't send email (${resp.status})`);
    }
  };
}
