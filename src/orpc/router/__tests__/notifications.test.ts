import { describe, expect, it } from "vite-plus/test";

import router from "@/orpc/router";

describe("notifications router", () => {
  it("registers the notification procedures on the router", () => {
    expect(router.listNotifications).toBeDefined();
    expect(router.countNotifications).toBeDefined();
    expect(router.unreadCount).toBeDefined();
    expect(router.markRead).toBeDefined();
    expect(router.markAllRead).toBeDefined();
  });
});
