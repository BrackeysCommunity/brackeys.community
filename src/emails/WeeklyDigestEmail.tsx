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

export interface DigestItem {
  type: NotificationType;
  actorUsername: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface WeeklyDigestEmailProps {
  appUrl: string;
  recipientName: string | null;
  items: DigestItem[];
  /** ISO date — the window's lower bound, for the "since" line. */
  since: string;
  /** Full unsub URL. The digest is a single product, so we send one
   * "stop all email" link rather than per-type variants. */
  unsubscribeUrl: string;
}

export function WeeklyDigestEmail({
  appUrl,
  recipientName,
  items,
  since,
  unsubscribeUrl,
}: WeeklyDigestEmailProps) {
  const greeting = recipientName ? `Hey ${recipientName},` : "Hey,";
  const sinceStr = new Date(since).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const previewText = `${items.length} new ${items.length === 1 ? "notification" : "notifications"} since ${sinceStr}`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Heading style={brandStyle}>Brackeys Community — Weekly digest</Heading>
          <Text style={textStyle}>{greeting}</Text>
          <Text style={textStyle}>
            Here's what you missed since {sinceStr}. ({items.length}{" "}
            {items.length === 1 ? "item" : "items"})
          </Text>
          <Section style={{ margin: "16px 0" }}>
            {items.map((item, idx) => {
              const { headline } = renderNotificationText(item);
              return (
                <Text key={idx} style={itemStyle}>
                  • {headline}
                </Text>
              );
            })}
          </Section>
          <Section style={{ textAlign: "center", margin: "24px 0" }}>
            <Button href={`${appUrl}/notifications`} style={buttonStyle}>
              Open inbox
            </Button>
          </Section>
          <Hr style={hrStyle} />
          <Text style={footerStyle}>
            You opted in to weekly digests.{" "}
            <a href={`${appUrl}/notifications?view=preferences`} style={linkStyle}>
              Manage preferences
            </a>{" "}
            ·{" "}
            <a href={unsubscribeUrl} style={linkStyle}>
              Unsubscribe from all email
            </a>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

WeeklyDigestEmail.PreviewProps = {
  appUrl: "https://brackeys.community",
  recipientName: "Joshe",
  since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  unsubscribeUrl: "https://brackeys.community/api/notifications/unsub?token=preview",
  items: [
    {
      type: "collab_response_received" as const,
      actorUsername: "alex",
      data: { postId: 42, postTitle: "Looking for a pixel artist" },
      createdAt: new Date().toISOString(),
    },
    {
      type: "collab_post_featured" as const,
      actorUsername: null,
      data: { postId: 42, postTitle: "Looking for a pixel artist" },
      createdAt: new Date().toISOString(),
    },
  ],
} satisfies WeeklyDigestEmailProps;

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
const textStyle = { fontSize: "14px", color: "#d0d0d0", margin: "8px 0", lineHeight: 1.5 };
const itemStyle = { fontSize: "13px", color: "#f5f5f5", margin: "6px 0", lineHeight: 1.5 };
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

export default WeeklyDigestEmail;
