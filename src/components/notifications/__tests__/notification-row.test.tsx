import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { NotificationItem } from "@/components/notifications/notification-utils";

const markRead = vi.fn((_vars: { ids: number[] }) => Promise.resolve({ ok: true }));

vi.mock("@tanstack/react-router", () => ({
  // jsdom can't navigate, so the stub swallows the default action and
  // leaves only the handler under test.
  Link: ({
    to,
    children,
    onClick,
    ...rest
  }: {
    to: string;
    children?: React.ReactNode;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock("@/orpc/client", () => ({
  client: { markRead: (vars: { ids: number[] }) => markRead(vars) },
  orpc: {
    unreadCount: { key: () => ["unreadCount"] },
    countNotifications: { key: () => ["countNotifications"] },
    listNotifications: { key: () => ["listNotifications"] },
  },
}));

const { NotificationRow } = await import("@/components/notifications/notification-utils");

afterEach(() => {
  cleanup();
  markRead.mockClear();
});

function makeItem(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 7,
    type: "collab_response_received",
    actorId: "actor-1",
    entityType: null,
    entityId: null,
    data: { postId: 42, postTitle: "Need a composer" },
    readAt: null,
    createdAt: new Date(),
    actorUsername: "nova",
    actorAvatarUrl: null,
    ...overrides,
  };
}

function renderRow(item: NotificationItem) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationRow notification={item} />
    </QueryClientProvider>,
  );
}

describe("NotificationRow", () => {
  it("marks an unread notification read when it is opened", async () => {
    renderRow(makeItem());
    fireEvent.click(screen.getByRole("link"));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith({ ids: [7] }));
  });

  it("does not re-mark a notification that is already read", () => {
    renderRow(makeItem({ readAt: new Date() }));
    fireEvent.click(screen.getByRole("link"));
    expect(markRead).not.toHaveBeenCalled();
  });
});
