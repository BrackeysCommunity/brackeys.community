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

import type { NotificationType } from "../db/schema";
import { renderNotificationText } from "../lib/notification-copy";

export interface NotificationEmailProps {
  appUrl: string;
  recipientName: string | null;
  notification: {
    type: NotificationType;
    actorUsername: string | null;
    data: Record<string, unknown>;
    createdAt: string;
  };
  /** Full unsub URL for THIS notification type. Required — the wrapper
   * sets `List-Unsubscribe` to the same URL so the in-body link and
   * the inbox affordance always agree. */
  unsubscribeUrl: string;
  /** Optional "all email" unsub fallback rendered next to the per-type
   * link. Lets recipients turn off everything in one tap when they've
   * already stopped reading. */
  unsubscribeAllUrl?: string;
}

export function NotificationEmail({
  appUrl,
  recipientName,
  notification,
  unsubscribeUrl,
  unsubscribeAllUrl,
}: NotificationEmailProps) {
  const { headline, href } = renderNotificationText(notification);
  const ctaUrl = href ? `${appUrl}${href}` : `${appUrl}/notifications`;
  const greeting = recipientName ? `Hey ${recipientName},` : "Hey,";

  return (
    <Html>
      <Head />
      <Preview>{headline}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={brandStyle}>Brackeys Community</Heading>
          <Text style={textStyle}>{greeting}</Text>
          <Text style={headlineStyle}>{headline}</Text>
          <Section style={{ textAlign: "center", margin: "24px 0" }}>
            <Button href={ctaUrl} style={buttonStyle}>
              View on Brackeys
            </Button>
          </Section>
          <Hr style={hrStyle} />
          <Text style={footerStyle}>
            You're getting this because your notification preferences include email for this event.{" "}
            <a href={`${appUrl}/notifications?view=preferences`} style={linkStyle}>
              Manage preferences
            </a>{" "}
            ·{" "}
            <a href={unsubscribeUrl} style={linkStyle}>
              Unsubscribe from this type
            </a>
            {unsubscribeAllUrl ? (
              <>
                {" "}
                ·{" "}
                <a href={unsubscribeAllUrl} style={linkStyle}>
                  Unsubscribe from all
                </a>
              </>
            ) : null}
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

NotificationEmail.PreviewProps = {
  appUrl: "https://brackeys.community",
  recipientName: "Joshe",
  notification: {
    type: "collab_response_received" as const,
    actorUsername: "alex",
    data: { postId: 42, postTitle: "Looking for a pixel artist" },
    createdAt: new Date().toISOString(),
  },
  unsubscribeUrl:
    "https://brackeys.community/api/notifications/unsub?token=preview&type=collab_response_received",
  unsubscribeAllUrl: "https://brackeys.community/api/notifications/unsub?token=preview",
} satisfies NotificationEmailProps;

const bodyStyle = { backgroundColor: "#0a0a0a", color: "#f5f5f5", fontFamily: "monospace" };
const containerStyle = {
  margin: "0 auto",
  padding: "32px 24px",
  maxWidth: "560px",
};
const brandStyle = {
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "0.2em",
  textTransform: "uppercase" as const,
  color: "#f5f5f5",
  marginBottom: "16px",
};
const textStyle = { fontSize: "14px", color: "#d0d0d0", margin: "8px 0" };
const headlineStyle = { fontSize: "16px", color: "#f5f5f5", margin: "12px 0", lineHeight: 1.5 };
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
const linkStyle = { color: "#ff007f", textDecoration: "underline" };

export default NotificationEmail;
