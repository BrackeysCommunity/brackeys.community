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
  const teamName = (input.data.teamName as string | undefined) ?? "a team";
  const teamSlug = input.data.teamSlug as string | undefined;
  const teamHref = teamSlug ? `/teams/${teamSlug}` : null;
  // Comment notifications are self-contained: the subject snapshot is
  // stored on the row at write time so no social-table joins happen here.
  const subjectTitle = (input.data.subjectTitle as string | undefined) ?? "a thread";
  const subjectHref = (input.data.subjectUrl as string | undefined) ?? null;
  // Moderation outcomes: the reason is optional — staff write one when the
  // removal isn't self-evident, and the copy reads without it either way.
  const moderationReason = input.data.reason as string | undefined;
  // A report outcome names the thing reported and nothing about the other
  // account — what staff did to them is not the reporter's business.
  const reportSubject = (input.data.subjectTitle as string | undefined) ?? "something you flagged";
  const reportActioned = input.data.outcome === "actioned";
  const skillName = input.data.skillName as string | undefined;
  const requestedName = input.data.requestedName as string | undefined;
  // Jam notifications carry their own snapshot for the same reason comment
  // ones do: the copy must render without joining back to `itch.jams`, which
  // the scraper may have tombstoned since.
  const jamTitle = (input.data.jamTitle as string | undefined) ?? "a jam";
  const jamHref = (input.data.jamUrl as string | undefined) ?? null;

  switch (input.type) {
    case "collab_response_received":
      return { headline: `${actor} responded to "${postTitle}"`, href };
    case "collab_response_accepted":
      return { headline: `${actor} accepted your response on "${postTitle}"`, href };
    case "collab_response_declined":
      return { headline: `${actor} declined your response on "${postTitle}"`, href };
    case "collab_response_withdrawn":
      return { headline: `${actor} withdrew their response to "${postTitle}"`, href };
    case "collab_post_featured":
      return { headline: `Your post "${postTitle}" was featured`, href };
    case "collab_post_closed_by_staff":
      return { headline: `Staff closed your post "${postTitle}"`, href };
    case "collab_post_expiring":
      return { headline: `"${postTitle}" closes soon — still looking?`, href };
    case "collab_post_expired":
      return { headline: `"${postTitle}" expired — reopen it if you're still looking`, href };
    case "team_invite_received":
      return { headline: `${actor} invited you to join ${teamName}`, href: teamHref };
    case "team_invite_accepted":
      return { headline: `${actor} joined ${teamName}`, href: teamHref };
    case "team_invite_declined":
      return { headline: `${actor} declined your invite to ${teamName}`, href: teamHref };
    case "team_member_removed":
      return { headline: `You were removed from ${teamName}`, href: teamHref };
    case "team_archive_warning":
      return {
        headline: `${teamName} has been quiet — it archives in a week without activity`,
        href: teamHref,
      };
    case "team_auto_archived":
      return { headline: `${teamName} was archived after a quiet spell`, href: teamHref };
    case "comment_received":
      return { headline: `${actor} commented on "${subjectTitle}"`, href: subjectHref };
    case "comment_reply":
      return {
        headline: `${actor} replied to your comment on "${subjectTitle}"`,
        href: subjectHref,
      };
    case "comment_removed_by_staff":
      return {
        headline: moderationReason
          ? `A moderator removed your comment on "${subjectTitle}" — ${moderationReason}`
          : `A moderator removed your comment on "${subjectTitle}"`,
        href: subjectHref,
      };
    case "report_resolved":
      return {
        headline: reportActioned
          ? `Thanks — we reviewed your report on "${reportSubject}" and took action`
          : `Thanks — we reviewed your report on "${reportSubject}" and left it up`,
        href: (input.data.subjectUrl as string | undefined) ?? null,
      };
    case "skill_request_approved":
      return {
        headline:
          skillName && requestedName && skillName !== requestedName
            ? `Your "${requestedName}" skill request was approved as "${skillName}"`
            : `Your "${skillName ?? requestedName ?? "skill"}" request was approved`,
        href: "/profile",
      };
    case "skill_request_rejected":
      return {
        headline: moderationReason
          ? `Your "${requestedName ?? "skill"}" request wasn't approved — ${moderationReason}`
          : `Your "${requestedName ?? "skill"}" request wasn't approved`,
        href: "/profile",
      };
    case "jam_starting":
      return { headline: `${jamTitle} starts soon`, href: jamHref };
    case "jam_voting_open":
      return { headline: `Voting is open for ${jamTitle}`, href: jamHref };
    case "jam_results_posted":
      return { headline: `Results are up for ${jamTitle}`, href: jamHref };
    case "jam_team_post_created":
      return { headline: `${actor} is crewing up for ${jamTitle}`, href };
    default:
      return { headline: "You have a new notification", href };
  }
}

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  collab_response_received: "Collab — someone responded to your post",
  collab_response_accepted: "Collab — your response was accepted",
  collab_response_declined: "Collab — your response was declined",
  collab_response_withdrawn: "Collab — an applicant withdrew",
  collab_post_featured: "Collab — your post was featured",
  collab_post_closed_by_staff: "Collab — staff closed your post",
  collab_post_expiring: "Collab — your post closes soon",
  collab_post_expired: "Collab — your post expired",
  team_invite_received: "Teams — you were invited to a team",
  team_invite_accepted: "Teams — someone accepted your invite",
  team_invite_declined: "Teams — someone declined your invite",
  team_member_removed: "Teams — you were removed from a team",
  team_archive_warning: "Teams — your team is about to be archived",
  team_auto_archived: "Teams — your team was archived",
  comment_received: "Comments — new comment in a thread you follow",
  comment_reply: "Comments — someone replied to your comment",
  comment_removed_by_staff: "Moderation — your comment was removed",
  report_resolved: "Moderation — a report you filed was reviewed",
  skill_request_approved: "Moderation — your skill request was approved",
  skill_request_rejected: "Moderation — your skill request wasn't approved",
  jam_starting: "Jams — a jam you're watching starts soon",
  jam_voting_open: "Jams — voting opened on a jam you're watching",
  jam_results_posted: "Jams — results are up for a jam you're watching",
  jam_team_post_created: "Jams — someone is crewing up for a jam you're watching",
};

export const NOTIFICATION_TYPES: NotificationType[] = [
  "collab_response_received",
  "collab_response_accepted",
  "collab_response_declined",
  "collab_response_withdrawn",
  "collab_post_featured",
  "collab_post_closed_by_staff",
  "collab_post_expiring",
  "collab_post_expired",
  "team_invite_received",
  "team_invite_accepted",
  "team_invite_declined",
  "team_member_removed",
  "team_archive_warning",
  "team_auto_archived",
  "comment_received",
  "comment_reply",
  "comment_removed_by_staff",
  "report_resolved",
  "skill_request_approved",
  "skill_request_rejected",
  "jam_starting",
  "jam_voting_open",
  "jam_results_posted",
  "jam_team_post_created",
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
  // The owner's applicant list just changed under them; in-app is enough,
  // and emailing "someone stopped wanting to work with you" is not a nudge
  // worth landing in an inbox.
  collab_response_withdrawn: { inApp: true, email: false, digest: false },
  collab_post_featured: { inApp: true, email: true, digest: false },
  collab_post_closed_by_staff: { inApp: true, email: true, digest: false },
  // Actionable deadlines: the email is the whole point — a user who
  // hasn't opened the app in six weeks is exactly who the nudge is for.
  collab_post_expiring: { inApp: true, email: true, digest: false },
  collab_post_expired: { inApp: true, email: false, digest: false },
  team_invite_received: { inApp: true, email: true, digest: false },
  team_invite_accepted: { inApp: true, email: true, digest: false },
  // Low-signal outcomes: in-app only, same reasoning as declined responses.
  team_invite_declined: { inApp: true, email: false, digest: false },
  team_member_removed: { inApp: true, email: false, digest: false },
  team_archive_warning: { inApp: true, email: true, digest: false },
  // The archive already happened and is reversible in-app; no email.
  team_auto_archived: { inApp: true, email: false, digest: false },
  // Conversational volume: in-app + weekly digest, never transactional
  // email by default — users opt email up, not down.
  comment_received: { inApp: true, email: false, digest: true },
  comment_reply: { inApp: true, email: false, digest: true },
  // Something was taken down without the author present. In-app alone can
  // sit unread for weeks, and "my comment vanished" is exactly the silence
  // that reads as the site being broken — or as staff being arbitrary.
  comment_removed_by_staff: { inApp: true, email: true, digest: false },
  // Closing the loop on someone else's behaviour, not the reporter's own
  // account — worth a bell, never an inbox.
  report_resolved: { inApp: true, email: false, digest: false },
  // Outcomes the user gets on their next visit anyway; in-app is enough.
  skill_request_approved: { inApp: true, email: false, digest: false },
  skill_request_rejected: { inApp: true, email: false, digest: false },
  // The deadline you asked to be reminded about — email is why people watch
  // a jam rather than bookmarking it.
  jam_starting: { inApp: true, email: true, digest: false },
  // Phase changes matter to entrants, but they are not deadlines you can
  // miss the way a start is; in-app is the right volume.
  jam_voting_open: { inApp: true, email: false, digest: false },
  jam_results_posted: { inApp: true, email: false, digest: false },
  // Fan-out scales with watchers × posts, so this one stays in-app only —
  // it is the funnel-closer, not an announcement worth an inbox.
  jam_team_post_created: { inApp: true, email: false, digest: false },
};

/**
 * Inbox category per type — the single source for the inbox tabs and any
 * future per-category preference grouping. Adding a type without a row
 * here is a compile error, which is the point.
 */
export type NotificationCategory = "collab" | "teams" | "comments" | "moderation" | "jams";

export const NOTIFICATION_CATEGORY: Record<NotificationType, NotificationCategory> = {
  collab_response_received: "collab",
  collab_response_accepted: "collab",
  collab_response_declined: "collab",
  collab_response_withdrawn: "collab",
  collab_post_featured: "collab",
  collab_post_closed_by_staff: "collab",
  collab_post_expiring: "collab",
  collab_post_expired: "collab",
  team_invite_received: "teams",
  team_invite_accepted: "teams",
  team_invite_declined: "teams",
  team_member_removed: "teams",
  team_archive_warning: "teams",
  team_auto_archived: "teams",
  comment_received: "comments",
  comment_reply: "comments",
  comment_removed_by_staff: "moderation",
  report_resolved: "moderation",
  skill_request_approved: "moderation",
  skill_request_rejected: "moderation",
  jam_starting: "jams",
  jam_voting_open: "jams",
  jam_results_posted: "jams",
  jam_team_post_created: "jams",
};

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "collab",
  "teams",
  "jams",
  "comments",
  "moderation",
];

/** The inverse of `NOTIFICATION_CATEGORY` — what the inbox's category filter
 *  narrows to in SQL. Derived so the two can never disagree. */
export const TYPES_BY_CATEGORY: Record<NotificationCategory, NotificationType[]> =
  NOTIFICATION_TYPES.reduce(
    (acc, type) => {
      acc[NOTIFICATION_CATEGORY[type]].push(type);
      return acc;
    },
    {
      collab: [],
      teams: [],
      jams: [],
      comments: [],
      moderation: [],
    } as Record<NotificationCategory, NotificationType[]>,
  );

/**
 * Types whose digest flag defaults on. Read paths that resolve a missing
 * `notification_preferences` row in SQL use this list; it must stay derived
 * from NOTIFICATION_DEFAULTS so the two can never disagree.
 */
export const DIGEST_DEFAULT_ON: readonly NotificationType[] = NOTIFICATION_TYPES.filter(
  (type) => NOTIFICATION_DEFAULTS[type].digest,
);

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
  "collab_post_expiring",
  "team_invite_received",
  "team_invite_accepted",
  "team_archive_warning",
  "comment_removed_by_staff",
  "jam_starting",
]);
