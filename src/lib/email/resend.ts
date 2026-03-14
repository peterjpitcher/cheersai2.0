import { Resend } from "resend";

import { env } from "@/env";

/**
 * Send a transactional email via Resend.
 *
 * Silently skips (with a console warning) if RESEND_API_KEY or RESEND_FROM are
 * not configured — this prevents cron jobs from hard-failing in environments
 * where email is not set up (e.g. local dev without secrets).
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = env.server.RESEND_API_KEY;
  const from = env.server.RESEND_FROM;

  if (!apiKey || !from) {
    console.warn(
      "[sendEmail] Skipping — RESEND_API_KEY or RESEND_FROM is not configured.",
    );
    return;
  }

  const resend = new Resend(apiKey);

  const { error } = await resend.emails.send({
    from,
    to: options.to,
    subject: options.subject,
    html: options.html,
  });

  if (error) {
    throw new Error(`Resend API error: ${error.message}`);
  }
}
