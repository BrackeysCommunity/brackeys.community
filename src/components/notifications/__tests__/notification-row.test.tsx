import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  NotificationItem,
  NotificationRowProps,
} from "@/components/notifications/notification-row";

const markRead = vi.fn((_vars: { ids: number[] }) => Promise.resolve({ ok: true }));
const captureEvent = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  // jsdom can't navigate, so the stub swallows the default action and
  // leaves only the handler under test. `to` and `hash` are recombined the
  // way the real router builds an href — the router treats `to` as a
  // pathname alone, which is the whole reason the row splits them.
  Link: ({
    to,
    hash,
    children,
    onClick,
    ...rest
  }: {
    to: string;
    hash?: string;
    children?: React.ReactNode;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  }) => (
    <a
      href={hash ? `${to}#${hash}` : to}
      // Surfaced separately so a test can see what the row handed the
      // router, not just the href the two happen to recombine into.
      data-to={to}
      data-hash={hash ?? ""}
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

vi.mock("@/lib/product-insights", () => ({
  captureEvent: (...args: unknown[]) => captureEvent(...args),
}));

const { NotificationRow } = await import("@/components/notifications/notification-row");

afterEach(() => {
  cleanup();
  markRead.mockClear();
  captureEvent.mockClear();
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

function renderRow(
  item: NotificationItem,
  selection?: NotificationRowProps["selection"],
  surface: NotificationRowProps["surface"] = "inbox",
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationRow notification={item} surface={surface} selection={selection} />
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

  // The in-app half of the notify -> return -> act loop. `was_unread` is
  // what separates a notice that worked from someone going back for one.
  it("reports a click with the notice's type and the surface it was read on", () => {
    renderRow(makeItem(), undefined, "bell");
    fireEvent.click(screen.getByRole("link"));
    expect(captureEvent).toHaveBeenCalledWith("notification_clicked", {
      type: "collab_response_received",
      category: "collab",
      surface: "bell",
      was_unread: true,
    });
  });

  it("reports a click on an already-read notice as a return, not a first read", () => {
    renderRow(makeItem({ readAt: new Date() }));
    fireEvent.click(screen.getByRole("link"));
    expect(captureEvent).toHaveBeenCalledWith(
      "notification_clicked",
      expect.objectContaining({ surface: "inbox", was_unread: false }),
    );
  });

  // A comment deep link handed over whole would land `#comment-94` inside
  // the `$userId` route param, and the profile route would 404 on it.
  it("carries a comment fragment as a hash, not as part of the path", () => {
    renderRow(
      makeItem({
        type: "comment_received",
        data: { subjectTitle: "nova's wall", subjectUrl: "/profile/u-nova#comment-94" },
      }),
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("data-to")).toBe("/profile/u-nova");
    expect(link.getAttribute("data-hash")).toBe("comment-94");
  });

  // The row builds its own hrefs rather than sharing the text renderer's,
  // so the rename-proofing has to be asserted on both.
  it("links a team by its id, not the slug the row was written under", () => {
    renderRow(
      makeItem({
        type: "team_invite_received",
        data: { teamId: "t-abc", teamSlug: "the-old-name", teamName: "Alpha" },
      }),
    );
    expect(screen.getByRole("link").getAttribute("data-to")).toBe("/teams/t-abc");
  });

  it("reports nothing when a row has nowhere to go", () => {
    // No href means no link and no click to report — the row still renders.
    renderRow(makeItem({ type: "profile_skill_rejected", data: {} }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(captureEvent).not.toHaveBeenCalled();
  });
});
