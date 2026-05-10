import { describe, expect, it } from "vite-plus/test";

import router from "@/orpc/router";

describe("notifications router", () => {
  it("registers the four notification procedures on the router", () => {
    expect(router.listNotifications).toBeDefined();
    expect(router.unreadCount).toBeDefined();
    expect(router.markRead).toBeDefined();
    expect(router.markAllRead).toBeDefined();
  });
});
