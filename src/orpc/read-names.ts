/**
 * The client facade (src/orpc/client.ts) dispatches on procedure *names*:
 * reads follow the get/list/count/search convention, everything else is
 * treated as a write and stamps the recent-write window. The convention is
 * load-bearing in both directions — a write named `get…` would silently
 * skip the stamp, and a read outside the convention would keep the window
 * open forever. Spelled out here so the naming test
 * (router/__tests__/read-write-naming.test.ts) exercises the same
 * classifier the facade routes by.
 */
export const EXTRA_READ_NAMES = new Set(["unreadCount"]);

export const READ_NAME_PATTERN = /^(get|list|count|search)[A-Z]/;

export const isReadName = (name: string) =>
  READ_NAME_PATTERN.test(name) || EXTRA_READ_NAMES.has(name);
