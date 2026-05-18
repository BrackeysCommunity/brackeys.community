import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { Resend } from "resend";

const DEFAULT_FROM = "Brackeys <noreply@brackeys.community>";

let client: Resend | null = null;

function getResend(): Resend {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  client = new Resend(key);
  return client;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  react: ReactElement;
  tags?: { name: string; value: string }[];
  /** RFC 5322 headers — used for List-Unsubscribe / One-Click. */
  headers?: Record<string, string>;
}): Promise<{ id: string } | null> {
  if (process.env.DISABLE_EMAIL === "1") {
    console.log("[email] suppressed by DISABLE_EMAIL", { to: args.to, subject: args.subject });
    return null;
  }

  const html = await render(args.react);
  const text = await render(args.react, { plainText: true });

  const { data, error } = await getResend().emails.send({
    from: process.env.EMAIL_FROM ?? DEFAULT_FROM,
    to: args.to,
    subject: args.subject,
    html,
    text,
    tags: args.tags,
    headers: args.headers,
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.name} — ${error.message}`);
  }
  return data ? { id: data.id } : null;
}

export const APP_URL = process.env.APP_URL ?? "https://brackeys.community";
