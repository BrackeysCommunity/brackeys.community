import { Button, Heading, Section, Text } from "@react-email/components";

import { withUtm } from "../lib/email-utm";
import { OG_ACCENTS } from "../lib/og/palette";
import { EmailLayout } from "./EmailLayout";
import { ACCENT, buttonStyle, headingStyle, footerStyle, MUTED, textStyle } from "./theme";

/** The short rule under the title, like the OG cards. Delete gets the warm
 * pink — the closest the palette has to "danger" — the other two stay on
 * the primary. */
const RULE_ACCENT: Record<AuthEmailVariant, string> = {
  verify: ACCENT,
  reset: ACCENT,
  delete: OG_ACCENTS.collab,
};

const ruleStyle = {
  height: "3px",
  width: "36px",
  borderRadius: "2px",
  margin: "0 0 16px",
};

export type AuthEmailVariant = "verify" | "reset" | "delete";

export interface AuthEmailProps {
  variant: AuthEmailVariant;
  recipientName: string | null;
  url: string;
  /** Origin serving the masthead mark; falls back to production. */
  appUrl?: string;
}

const COPY: Record<
  AuthEmailVariant,
  { preview: string; heading: string; body: string; cta: string }
> = {
  verify: {
    preview: "Verify your Brackeys email address",
    heading: "Verify your email",
    body: "Confirm this email so you can sign in. The link expires shortly.",
    cta: "Verify email",
  },
  reset: {
    preview: "Reset your Brackeys password",
    heading: "Reset your password",
    body: "Click below to set a new password. If you didn't request this, ignore this email.",
    cta: "Reset password",
  },
  delete: {
    preview: "Confirm deleting your Brackeys account",
    heading: "Delete your account",
    body: "Click below to permanently delete your account, profile, and projects. This cannot be undone. If you didn't request this, ignore this email and your account will stay untouched.",
    cta: "Delete my account",
  },
};

export function AuthEmail({ variant, recipientName, url, appUrl }: AuthEmailProps) {
  const copy = COPY[variant];
  const greeting = recipientName ? `Hey ${recipientName},` : "Hey,";

  return (
    <EmailLayout
      preview={copy.preview}
      appUrl={appUrl}
      footer={
        <Text style={footerStyle}>
          If the button doesn't work, copy this link into your browser:
          <br />
          <span style={{ color: MUTED, wordBreak: "break-all" as const }}>{url}</span>
        </Text>
      }
    >
      <Heading as="h2" style={{ ...headingStyle, margin: "0 0 10px" }}>
        {copy.heading}
      </Heading>
      <div style={{ ...ruleStyle, backgroundColor: RULE_ACCENT[variant] }} />
      <Text style={textStyle}>{greeting}</Text>
      <Text style={textStyle}>{copy.body}</Text>
      <Section style={{ textAlign: "center" as const, margin: "24px 0 0" }}>
        <Button href={withUtm(url, "auth", variant)} style={buttonStyle}>
          {copy.cta}
        </Button>
      </Section>
    </EmailLayout>
  );
}

AuthEmail.PreviewProps = {
  variant: "verify" as const,
  recipientName: "Joshe",
  url: "https://brackeys.community/auth/verify?token=abc",
} satisfies AuthEmailProps;

export default AuthEmail;
