import type { NotificationType } from "../db/schema";

/**
 * Plain-text rendering of a notification — server-safe (no JSX, no router
 * imports). Used by email templates and as a fallback when rendering rows
 * outside of a router context. The UI bell uses its own JSX variant in
 * `components/notifications/notification-utils.tsx`.
 */
export function renderNotificationText(input: {
  type: NotificationType;
  actorUsername: string | null;
  data: Record<string, unknown>;
}): { headline: string; href: string | null } {
  const actor = input.actorUsername ? `@${input.actorUsername}` : "Someone";
  const postTitle = (input.data.postTitle as string | undefined) ?? "your post";
  const postId = input.data.postId as number | undefined;
  const href = postId ? `/collab/${postId}` : null;

  switch (input.type) {
    case "collab_response_received":
      return { headline: `${actor} responded to "${postTitle}"`, href };
    case "collab_response_accepted":
      return { headline: `${actor} accepted your response on "${postTitle}"`, href };
    case "collab_response_declined":
      return { headline: `${actor} declined your response on "${postTitle}"`, href };
    case "collab_post_featured":
      return { headline: `Your post "${postTitle}" was featured`, href };
    case "collab_post_closed_by_staff":
      return { headline: `Staff closed your post "${postTitle}"`, href };
    default:
      return { headline: "You have a new notification", href };
  }
}

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  collab_response_received: "Collab — someone responded to your post",
  collab_response_accepted: "Collab — your response was accepted",
  collab_response_declined: "Collab — your response was declined",
  collab_post_featured: "Collab — your post was featured",
  collab_post_closed_by_staff: "Collab — staff closed your post",
};

export const NOTIFICATION_TYPES: NotificationType[] = [
  "collab_response_received",
  "collab_response_accepted",
  "collab_response_declined",
  "collab_post_featured",
  "collab_post_closed_by_staff",
];

/**
 * Default delivery preference per notification type for users who have no
 * row in `user.notification_preferences`. In-app is always on; email
 * defaults on only for high-signal events (someone took action *on* your
 * stuff). Digest defaults off so we never email a user who didn't opt in.
 */
export const NOTIFICATION_DEFAULTS: Record<
  NotificationType,
  { inApp: boolean; email: boolean; digest: boolean }
> = {
  collab_response_received: { inApp: true, email: true, digest: false },
  collab_response_accepted: { inApp: true, email: true, digest: false },
  collab_response_declined: { inApp: true, email: false, digest: false },
  collab_post_featured: { inApp: true, email: true, digest: false },
  collab_post_closed_by_staff: { inApp: true, email: true, digest: false },
};

/**
 * Types whose email fires immediately (transactional) — the user took
 * an action on the recipient's stuff and a real-time email is justified.
 * Lower-signal events (e.g. someone declining your response) are
 * excluded; they still show in-app and roll up into the weekly digest
 * for users who opted in, but never trigger a transactional send.
 */
export const EMAIL_IMMEDIATE: ReadonlySet<NotificationType> = new Set([
  "collab_response_received",
  "collab_response_accepted",
  "collab_post_featured",
  "collab_post_closed_by_staff",
]);
