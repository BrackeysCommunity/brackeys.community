import type { ReactElement } from "react";
import type { Resend as ResendClient } from "resend";

type SendEmailArgs = {
  to: string | string[];
  subject: string;
  react: ReactElement;
  /** Override the default From address — rarely needed. */
  from?: string;
  /** Tags for Resend analytics. */
  tags?: { name: string; value: string }[];
  /**
   * Extra RFC 5322 headers — primarily for `List-Unsubscribe` and
   * `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058)
   * which Gmail/Yahoo require for bulk-sender deliverability.
   */
  headers?: Record<string, string>;
};

type SendEmailResult = { id: string } | null;

const DEFAULT_FROM = "Brackeys <noreply@brackeys.community>";

let resendClient: ResendClient | null = null;

async function getResend(): Promise<ResendClient> {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  const { Resend } = await import("resend");
  resendClient = new Resend(apiKey);
  return resendClient;
}

/**
 * Renders a react-email template and dispatches it via Resend. Returns the
 * Resend message id on success, or `null` when sending is disabled
 * (`DISABLE_EMAIL=1`) so callers can short-circuit without branching on
 * thrown errors. Real send failures still throw.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  if (process.env.DISABLE_EMAIL === "1") {
    console.log("[email] suppressed by DISABLE_EMAIL", { to: args.to, subject: args.subject });
    return null;
  }

  // react-email's render is a peer dependency; import lazily so dev /
  // client bundles never pay the cost.
  const { render } = await import("@react-email/render");
  const html = await render(args.react);
  const text = await render(args.react, { plainText: true });

  const resend = await getResend();
  const { data, error } = await resend.emails.send({
    from: args.from ?? process.env.EMAIL_FROM ?? DEFAULT_FROM,
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
