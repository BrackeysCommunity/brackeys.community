import { Button, Column, Img, Link, Row, Section, Text } from "@react-email/components";

import type { NotificationType } from "../db/schema";
import { withUtm } from "../lib/email-utm";
import {
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_LABEL,
  renderNotificationText,
} from "../lib/notification-copy";
import { censorText } from "../lib/profanity";
import { EmailLayout } from "./EmailLayout";
import {
  buttonStyle,
  CATEGORY_ACCENT_TEXT,
  FG,
  FONT_SANS,
  footerStyle,
  linkStyle,
  microLabelStyle,
  textStyle,
} from "./theme";

export interface NotificationEmailProps {
  appUrl: string;
  recipientName: string | null;
  notification: {
    type: NotificationType;
    actorUsername: string | null;
    data: Record<string, unknown>;
    createdAt: string;
  };
  /** The actor's avatar, absolute URL (Discord CDN). Rendered beside the
   * headline the way the bell row does it; null falls back to text-only. */
  actorAvatarUrl?: string | null;
  /** Full unsub URL for THIS notification type — the labelled in-body link.
   * The `List-Unsubscribe` header carries the all-scope URL instead: the
   * inbox affordance reads as "stop this sender", not one of 24 types. */
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
  actorAvatarUrl,
  unsubscribeUrl,
  unsubscribeAllUrl,
}: NotificationEmailProps) {
  const { headline, href } = renderNotificationText(notification);
  // Email is the one surface with no viewer preference available, and it can
  // land in a work inbox — censor unconditionally, matching the app default.
  const safeHeadline = censorText(headline);
  const ctaUrl = withUtm(
    href ? `${appUrl}${href}` : `${appUrl}/notifications`,
    "immediate",
    notification.type,
  );
  const greeting = recipientName ? `Hey ${recipientName},` : "Hey,";
  const category = NOTIFICATION_CATEGORY[notification.type];
  // Only absolute URLs render in mail clients; anything else drops the img.
  const avatar = actorAvatarUrl?.startsWith("http") ? actorAvatarUrl : null;

  return (
    <EmailLayout
      preview={safeHeadline}
      appUrl={appUrl}
      footer={
        <Text style={footerStyle}>
          You're getting this because email is on for this kind of activity.{" "}
          <Link
            href={withUtm(`${appUrl}/settings?tab=notifications`, "immediate", "manage_prefs")}
            style={linkStyle}
          >
            Manage preferences
          </Link>{" "}
          ·{" "}
          <Link href={unsubscribeUrl} style={linkStyle}>
            Stop emails like this
          </Link>
          {unsubscribeAllUrl ? (
            <>
              {" "}
              ·{" "}
              <Link href={unsubscribeAllUrl} style={linkStyle}>
                Unsubscribe from all email
              </Link>
            </>
          ) : null}
          .
        </Text>
      }
    >
      <Text style={{ ...textStyle, marginTop: 0 }}>{greeting}</Text>
      <Section style={{ margin: "16px 0 0" }}>
        <Row>
          {avatar ? (
            <Column style={{ width: "48px", verticalAlign: "top" }}>
              <Img src={avatar} width="36" height="36" alt="" style={avatarStyle} />
            </Column>
          ) : null}
          <Column style={{ verticalAlign: "top" }}>
            {category ? (
              <Text style={categoryStyle(category)}>{NOTIFICATION_CATEGORY_LABEL[category]}</Text>
            ) : null}
            <Text style={headlineStyle}>{safeHeadline}</Text>
          </Column>
        </Row>
      </Section>
      <Section style={{ textAlign: "center" as const, margin: "24px 0 0" }}>
        <Button href={ctaUrl} style={buttonStyle}>
          View on Brackeys
        </Button>
      </Section>
    </EmailLayout>
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
  actorAvatarUrl: "https://cdn.discordapp.com/embed/avatars/3.png",
  unsubscribeUrl:
    "https://brackeys.community/api/notifications/unsub?token=preview&type=collab_response_received",
  unsubscribeAllUrl: "https://brackeys.community/api/notifications/unsub?token=preview",
} satisfies NotificationEmailProps;

function categoryStyle(category: keyof typeof CATEGORY_ACCENT_TEXT) {
  return { ...microLabelStyle, color: CATEGORY_ACCENT_TEXT[category], margin: "0 0 6px" };
}

const avatarStyle = { borderRadius: "18px" };
const headlineStyle = {
  fontFamily: FONT_SANS,
  fontSize: "17px",
  fontWeight: 700,
  color: FG,
  margin: 0,
  lineHeight: 1.5,
};

export default NotificationEmail;
