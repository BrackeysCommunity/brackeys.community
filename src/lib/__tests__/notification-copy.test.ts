import { describe, expect, it } from "vite-plus/test";

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_CATEGORY_LABEL,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_TYPES,
  renderNotificationText,
  TYPES_BY_CATEGORY,
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

  it("partitions every type into exactly one category bucket", () => {
    // The inbox's category tab filters in SQL off these buckets, so a type
    // missing from them is a notification the user can only find under All.
    const bucketed = NOTIFICATION_CATEGORIES.flatMap((c) => TYPES_BY_CATEGORY[c]);
    expect(bucketed.length).toBe(NOTIFICATION_TYPES.length);
    for (const category of NOTIFICATION_CATEGORIES) {
      for (const type of TYPES_BY_CATEGORY[category]) {
        expect(NOTIFICATION_CATEGORY[type], `${type} bucketed under ${category}`).toBe(category);
      }
    }
  });

  it("labels every category", () => {
    for (const category of NOTIFICATION_CATEGORIES) {
      expect(NOTIFICATION_CATEGORY_LABEL[category], `label missing ${category}`).toBeTruthy();
    }
  });

  it("gives every type its own copy instead of the generic fallback", () => {
    // Adding a type to the tables but forgetting the `renderNotificationText`
    // switch is silent: the row still renders, just as "You have a new
    // notification". This is the assertion that makes it loud.
    for (const type of NOTIFICATION_TYPES) {
      const { headline } = renderNotificationText({ type, actorUsername: "someone", data: {} });
      expect(headline, `${type} falls through to the default headline`).not.toBe(
        "You have a new notification",
      );
    }
  });
});
