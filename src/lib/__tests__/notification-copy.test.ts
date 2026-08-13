import { describe, expect, it } from "vite-plus/test";

import {
  EMAIL_IMMEDIATE,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_TYPES,
  renderNotificationText,
} from "@/lib/notification-copy";

describe("moderation notification copy", () => {
  it("names both sides when staff renamed the skill", () => {
    const { headline } = renderNotificationText({
      type: "skill_request_approved",
      actorUsername: null,
      data: { requestedName: "c#", skillName: "C#" },
    });
    // The whole point: otherwise the profile silently carries a name the
    // requester never typed.
    expect(headline).toContain("c#");
    expect(headline).toContain("C#");
    expect(headline).toContain("approved as");
  });

  it("stays single-clause when the name came through unchanged", () => {
    const { headline } = renderNotificationText({
      type: "skill_request_approved",
      actorUsername: null,
      data: { requestedName: "Godot", skillName: "Godot" },
    });
    expect(headline).toBe('Your "Godot" request was approved');
  });

  it("reads with or without a moderator reason", () => {
    const withReason = renderNotificationText({
      type: "comment_removed_by_staff",
      actorUsername: null,
      data: { subjectTitle: "Pixel artist wanted", reason: "Off-topic self-promotion" },
    });
    expect(withReason.headline).toContain("Off-topic self-promotion");

    const without = renderNotificationText({
      type: "comment_removed_by_staff",
      actorUsername: null,
      data: { subjectTitle: "Pixel artist wanted" },
    });
    expect(without.headline).toBe('A moderator removed your comment on "Pixel artist wanted"');
    expect(without.headline).not.toContain("—");
  });
});

describe("notification type tables", () => {
  it("covers every type in every table", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_DEFAULTS[type], `defaults missing ${type}`).toBeDefined();
      expect(NOTIFICATION_CATEGORY[type], `category missing ${type}`).toBeDefined();
    }
  });

  it("only sends transactional email for types whose email default is on", () => {
    for (const type of EMAIL_IMMEDIATE) {
      expect(NOTIFICATION_DEFAULTS[type].email, `${type} emails immediately but defaults off`).toBe(
        true,
      );
    }
  });
});
