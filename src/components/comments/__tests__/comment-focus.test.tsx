import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * The `#comment-<id>` half of a wall notification. The router scrolls to a
 * hash exactly once, when the route settles — comments arrive after that,
 * and the row can be pages deep or folded behind the preview cap. These
 * assertions cover the three ways the thread has to go and find it.
 */

let hash = "";
const scrollIntoView = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  useLocation: <T,>(opts?: { select?: (l: { hash: string }) => T }) =>
    opts?.select ? opts.select({ hash }) : ({ hash } as unknown as T),
}));

type Comment = {
  id: number;
  parentId: number | null;
  rootId: number | null;
  depth: number;
  content: string;
  hasMoreReplies?: boolean;
};

const listComments = vi.fn();
const getCommentLocation = vi.fn();
const listReplies = vi.fn();

vi.mock("@/orpc/client", () => ({
  client: {
    listComments: (v: unknown) => listComments(v),
    getCommentLocation: (v: unknown) => getCommentLocation(v),
    listReplies: (v: unknown) => listReplies(v),
  },
}));

vi.mock("@/lib/product-insights", () => ({
  captureEvent: vi.fn(),
  reportMutationError: vi.fn(),
  // The rank badge beside each author reads a feature flag, which reaches
  // the PostHog client through this module's store. No client ever loads
  // under test, so the flag serves its default.
  getPostHogClientSnapshot: () => null,
  subscribePostHogClient: () => () => {},
}));

const { CommentThread } = await import("@/components/comments/CommentThread");

function comment(id: number, over: Partial<Comment> = {}): Comment {
  return {
    id,
    parentId: null,
    rootId: null,
    depth: 0,
    content: `c${id}`,
    ...over,
  };
}

function page(comments: Comment[], nextCursor: number | null = null) {
  return {
    thread: { id: 1, lockedAt: null, subscribed: false, muted: false },
    commentCount: comments.length,
    commentingEnabled: true,
    viewerIsStaff: false,
    comments: comments.map((c) => ({
      ...c,
      tombstone: null,
      hidden: false,
      createdAt: new Date(),
      editedAt: null,
      replyCount: 0,
      hasMoreReplies: c.hasMoreReplies ?? false,
      author: {
        id: "a",
        name: "nova",
        avatarUrl: null,
        guildAvatarUrl: null,
        guildRoles: null,
        urlStub: null,
      },
      viewer: { isMine: false, canEdit: false, canDelete: false },
    })),
    nextCursor,
  };
}

function renderThread() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CommentThread subject={{ type: "profile", id: "u-nova" }} maxLength={500} />
    </QueryClientProvider>,
  );
}

/** The focused row carries the ring the reader is meant to land on. */
function focusedRow(id: number) {
  const el = document.getElementById(`comment-${id}`);
  return el?.className.includes("ring-primary/40") ? el : null;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
  hash = "";
  scrollIntoView.mockClear();
  listComments.mockReset();
  getCommentLocation.mockReset();
  listReplies.mockReset();
});

describe("comment deep links", () => {
  it("scrolls to and marks the comment named by the hash", async () => {
    hash = "comment-3";
    listComments.mockResolvedValue(page([comment(5), comment(3)]));
    getCommentLocation.mockResolvedValue({ rootId: 3 });

    renderThread();
    await waitFor(() => expect(focusedRow(3)).not.toBeNull());
    expect(scrollIntoView).toHaveBeenCalled();
    // The row that wasn't asked for stays plain.
    expect(focusedRow(5)).toBeNull();
  });

  it("pages older roots until the chain holding the comment arrives", async () => {
    hash = "comment-2";
    listComments
      .mockResolvedValueOnce(page([comment(9), comment(8)], 8))
      .mockResolvedValueOnce(page([comment(2)]));
    getCommentLocation.mockResolvedValue({ rootId: 2 });

    renderThread();
    await waitFor(() => expect(focusedRow(2)).not.toBeNull());
    expect(listComments).toHaveBeenCalledTimes(2);
  });

  it("opens a chain past its preview cap to reach a folded reply", async () => {
    hash = "comment-16";
    // Four replies under one root: the cap shows three, so 16 is folded.
    const replies = [12, 13, 14, 16].map((id) =>
      comment(id, { parentId: 10, rootId: 10, depth: 1 }),
    );
    listComments.mockResolvedValue(page([comment(10), ...replies]));
    getCommentLocation.mockResolvedValue({ rootId: 10 });

    renderThread();
    await waitFor(() => expect(focusedRow(16)).not.toBeNull());
  });

  it("leaves the thread alone when the hash belongs somewhere else", async () => {
    hash = "comment-999";
    listComments.mockResolvedValue(page([comment(9), comment(8)], 8));
    getCommentLocation.mockResolvedValue({ rootId: null });

    renderThread();
    await waitFor(() => expect(document.getElementById("comment-9")).not.toBeNull());
    // No root to aim at, so no paging and nothing scrolled.
    expect(listComments).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
