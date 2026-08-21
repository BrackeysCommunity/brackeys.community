import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vite-plus/test";

import { NOTIFICATION_TYPES } from "../../lib/notification-copy";
import { AuthEmail, type AuthEmailVariant } from "../AuthEmail";
import { NotificationEmail } from "../NotificationEmail";
import { WeeklyDigestEmail } from "../WeeklyDigestEmail";

/**
 * Renders every template to HTML *and* plaintext — the cheap net under the
 * theme work. A template that stops compiling, a `renderNotificationText`
 * change that throws on a missing `data` key, or a dropped text part all
 * fail here instead of in a worker at 2am.
 */

const APP_URL = "https://brackeys.community";
const UNSUB_TOKEN = "unsub-token-fixture";
const UNSUB_URL = `${APP_URL}/api/notifications/unsub?token=${UNSUB_TOKEN}`;

/** One superset payload — every key any type's copy might interpolate. */
const FIXTURE_DATA = {
  postId: 42,
  postTitle: "Looking for a pixel artist",
  teamName: "Night Shift",
  teamSlug: "night-shift",
  subjectTitle: "Devlog #3",
  subjectUrl: "/collab/42",
  reason: "off-topic",
  outcome: "actioned",
  skillName: "Pixel Art",
  requestedName: "Pixel Art",
  jamTitle: "Brackeys Jam 2026.2",
  jamUrl: "/jams/brackeys-jam-2026-2",
};

async function both(element: React.ReactElement) {
  const html = await render(element);
  const text = await render(element, { plainText: true });
  return { html, text };
}

describe("AuthEmail", () => {
  it.each(["verify", "reset", "delete"] as AuthEmailVariant[])(
    "renders the %s variant with the action URL in both parts",
    async (variant) => {
      const url = `${APP_URL}/auth/${variant}?token=abc123`;
      const { html, text } = await both(
        createElement(AuthEmail, { variant, recipientName: "Joshe", url }),
      );
      expect(html.length).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);
      expect(html).toContain(url);
      expect(text).toContain(url);
    },
  );
});

describe("NotificationEmail", () => {
  it.each(NOTIFICATION_TYPES)(
    "renders %s with the unsubscribe token in both parts",
    async (type) => {
      const { html, text } = await both(
        createElement(NotificationEmail, {
          appUrl: APP_URL,
          recipientName: "Joshe",
          notification: {
            type,
            actorUsername: "alex",
            data: FIXTURE_DATA,
            createdAt: new Date().toISOString(),
          },
          unsubscribeUrl: `${UNSUB_URL}&type=${type}`,
          unsubscribeAllUrl: UNSUB_URL,
        }),
      );
      expect(html.length).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);
      expect(html).toContain(UNSUB_TOKEN);
      expect(text).toContain(UNSUB_TOKEN);
    },
  );

  it("survives a notification with an empty data payload", async () => {
    const { html, text } = await both(
      createElement(NotificationEmail, {
        appUrl: APP_URL,
        recipientName: null,
        notification: {
          type: "collab_response_received",
          actorUsername: null,
          data: {},
          createdAt: new Date().toISOString(),
        },
        unsubscribeUrl: UNSUB_URL,
      }),
    );
    expect(html).toContain(UNSUB_TOKEN);
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("WeeklyDigestEmail", () => {
  it("links every item with an href and carries the unsubscribe token in both parts", async () => {
    const items = [
      {
        type: "collab_response_received" as const,
        actorUsername: "alex",
        data: FIXTURE_DATA,
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
      {
        type: "comment_reply" as const,
        actorUsername: "sam",
        data: FIXTURE_DATA,
        createdAt: new Date().toISOString(),
      },
    ];
    const { html, text } = await both(
      createElement(WeeklyDigestEmail, {
        appUrl: APP_URL,
        recipientName: "Joshe",
        items,
        since: new Date(Date.now() - 7 * 86_400_000).toISOString(),
        unsubscribeUrl: UNSUB_URL,
      }),
    );
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
    expect(html).toContain(UNSUB_TOKEN);
    expect(text).toContain(UNSUB_TOKEN);
    // §3.19 — digest rows are links now, not dead strings.
    expect(html).toContain(`${APP_URL}/collab/42`);
    // Grouped under category headings.
    expect(html).toContain("Collab");
    expect(html).toContain("Comments");
  });
});
