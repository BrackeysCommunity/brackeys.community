import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  NotificationItem,
  NotificationRowProps,
} from "@/components/notifications/notification-row";

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

const { NotificationRow } = await import("@/components/notifications/notification-row");

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
    actorName: "nova",
    actorAvatarUrl: null,
    ...overrides,
  };
}

function renderRow(item: NotificationItem, selection?: NotificationRowProps["selection"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationRow notification={item} selection={selection} />
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

  // The checkbox sits beside the link, not inside it, so checking a row
  // never opens it or marks it read.
  it("checks a selectable row without opening it", () => {
    const onSelectedChange = vi.fn();
    renderRow(makeItem(), { selected: false, onSelectedChange });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select notification" }));
    expect(onSelectedChange).toHaveBeenCalledWith(true);
    expect(markRead).not.toHaveBeenCalled();
  });

  it("renders no checkbox outside a selectable table", () => {
    renderRow(makeItem());
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
