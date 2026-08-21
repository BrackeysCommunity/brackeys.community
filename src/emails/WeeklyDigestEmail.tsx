import { Button, Column, Hr, Link, Row, Section, Text } from "@react-email/components";

import type { NotificationType } from "../db/schema";
import { timeAgo } from "../lib/format-time";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_LABEL,
  renderNotificationText,
} from "../lib/notification-copy";
import { censorText } from "../lib/profanity";
import { EmailLayout } from "./EmailLayout";
import {
  buttonStyle,
  CATEGORY_ACCENT_TEXT,
  DIM,
  FG,
  FONT_SANS,
  footerStyle,
  HAIRLINE,
  linkStyle,
  microLabelStyle,
  textStyle,
} from "./theme";

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
    timeZone: "UTC",
  });

  const previewText = `${items.length} new ${items.length === 1 ? "notification" : "notifications"} since ${sinceStr}`;

  const groups = NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    items: items.filter((item) => NOTIFICATION_CATEGORY[item.type] === category),
  })).filter((group) => group.items.length > 0);

  return (
    <EmailLayout
      preview={previewText}
      appUrl={appUrl}
      footer={
        <Text style={footerStyle}>
          You opted in to weekly digests.{" "}
          <Link href={`${appUrl}/settings?tab=notifications`} style={linkStyle}>
            Manage preferences
          </Link>{" "}
          ·{" "}
          <Link href={unsubscribeUrl} style={linkStyle}>
            Unsubscribe from all email
          </Link>
          .
        </Text>
      }
    >
      <Text style={{ ...textStyle, marginTop: 0 }}>{greeting}</Text>
      <Text style={textStyle}>
        Here's what you missed since {sinceStr}. ({items.length}{" "}
        {items.length === 1 ? "item" : "items"})
      </Text>
      {groups.map((group) => (
        <Section key={group.category} style={groupStyle}>
          <Text
            style={{
              ...microLabelStyle,
              color: CATEGORY_ACCENT_TEXT[group.category],
              margin: "0 0 4px",
            }}
          >
            {NOTIFICATION_CATEGORY_LABEL[group.category]}
            {group.items.length > 1 ? ` · ${group.items.length}` : ""}
          </Text>
          {group.items.map((item, idx) => {
            const { headline, href } = renderNotificationText(item);
            const safeHeadline = censorText(headline);
            return (
              <div key={idx}>
                {idx > 0 ? <Hr style={itemRuleStyle} /> : null}
                <Row>
                  <Column>
                    {href ? (
                      <Link href={`${appUrl}${href}`} style={itemLinkStyle}>
                        {safeHeadline}
                      </Link>
                    ) : (
                      <Text style={{ ...itemLinkStyle, margin: 0 }}>{safeHeadline}</Text>
                    )}
                  </Column>
                  <Column align="right" style={{ width: "72px", verticalAlign: "top" }}>
                    <Text style={itemTimeStyle}>{timeAgo(item.createdAt)}</Text>
                  </Column>
                </Row>
              </div>
            );
          })}
        </Section>
      ))}
      <Section style={{ textAlign: "center" as const, margin: "28px 0 8px" }}>
        <Button href={`${appUrl}/notifications`} style={buttonStyle}>
          Open inbox
        </Button>
      </Section>
    </EmailLayout>
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
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      type: "collab_post_featured" as const,
      actorUsername: null,
      data: { postId: 42, postTitle: "Looking for a pixel artist" },
      createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      type: "comment_reply" as const,
      actorUsername: "sam",
      data: { subjectTitle: "Devlog #3", subjectUrl: "/collab/42" },
      createdAt: new Date().toISOString(),
    },
  ],
} satisfies WeeklyDigestEmailProps;

const groupStyle = { margin: "20px 0 0" };
const itemRuleStyle = { borderColor: HAIRLINE, margin: "10px 0" };
const itemLinkStyle = {
  fontFamily: FONT_SANS,
  fontSize: "14px",
  color: FG,
  lineHeight: 1.5,
  textDecoration: "underline",
};
const itemTimeStyle = {
  fontFamily: FONT_SANS,
  fontSize: "12px",
  color: DIM,
  margin: 0,
  whiteSpace: "nowrap" as const,
};

export default WeeklyDigestEmail;
