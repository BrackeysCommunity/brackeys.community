import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type AuthEmailVariant = "verify" | "reset";

export interface AuthEmailProps {
  variant: AuthEmailVariant;
  recipientName: string | null;
  url: string;
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
};

export function AuthEmail({ variant, recipientName, url }: AuthEmailProps) {
  const copy = COPY[variant];
  const greeting = recipientName ? `Hey ${recipientName},` : "Hey,";

  return (
    <Html>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={brandStyle}>Brackeys Community</Heading>
          <Heading as="h2" style={headingStyle}>
            {copy.heading}
          </Heading>
          <Text style={textStyle}>{greeting}</Text>
          <Text style={textStyle}>{copy.body}</Text>
          <Section style={{ textAlign: "center", margin: "24px 0" }}>
            <Button href={url} style={buttonStyle}>
              {copy.cta}
            </Button>
          </Section>
          <Hr style={hrStyle} />
          <Text style={footerStyle}>
            If the button doesn't work, copy this link into your browser:
            <br />
            <span style={{ color: "#aaa", wordBreak: "break-all" }}>{url}</span>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

AuthEmail.PreviewProps = {
  variant: "verify" as const,
  recipientName: "Joshe",
  url: "https://brackeys.community/auth/verify?token=abc",
} satisfies AuthEmailProps;

const bodyStyle = { backgroundColor: "#0a0a0a", color: "#f5f5f5", fontFamily: "monospace" };
const containerStyle = { margin: "0 auto", padding: "32px 24px", maxWidth: "560px" };
const brandStyle = {
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "0.2em",
  textTransform: "uppercase" as const,
  color: "#f5f5f5",
  marginBottom: "16px",
};
const headingStyle = { fontSize: "20px", color: "#f5f5f5", margin: "8px 0 16px" };
const textStyle = { fontSize: "14px", color: "#d0d0d0", margin: "8px 0", lineHeight: 1.5 };
const buttonStyle = {
  backgroundColor: "#ff007f",
  color: "#ffffff",
  padding: "12px 20px",
  textDecoration: "none",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.2em",
  textTransform: "uppercase" as const,
};
const hrStyle = { borderColor: "#222", margin: "24px 0" };
const footerStyle = { fontSize: "11px", color: "#888", lineHeight: 1.5 };

export default AuthEmail;
