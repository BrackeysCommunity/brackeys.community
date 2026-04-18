import { cleanup, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { activeUserStore } from "@/lib/active-user-store";
import type { ActiveUserProfile } from "@/lib/active-user-store";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  Link: (props: Record<string, unknown>) => {
    const { to, params, children, ...rest } = props as {
      to: string;
      params?: { userId?: string };
      children?: React.ReactNode;
      [key: string]: unknown;
    };
    const href = params?.userId ? to.replace("$userId", params.userId) : to;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      animate: _a,
      transition: _t,
      ...rest
    }: {
      children?: React.ReactNode;
      animate?: unknown;
      transition?: unknown;
      [key: string]: unknown;
    }) => <div {...rest}>{children}</div>,
  },
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  Logout03Icon: "logout-icon",
  Share01Icon: "share-icon",
  UserIcon: "user-icon",
}));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => <span data-testid="icon" />,
}));

vi.mock("@/components/ui/dropdown-menu", async () => {
  const { cloneElement } = await import("react");
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({
      children,
      render,
      className: _c,
    }: {
      children: React.ReactNode;
      render?: React.ReactElement;
      className?: string;
    }) => {
      if (render) {
        return cloneElement(render, {}, children);
      }
      return <div>{children}</div>;
    },
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
      <button type="button">{children}</button>
    ),
  };
});

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

vi.mock("@/lib/hooks/use-cursor", () => ({
  useMagnetic: () => ({
    ref: { current: null },
    position: { x: 0, y: 0 },
  }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────

const { UserMenu } = await import("../UserMenu");

// ── Helpers ─────────────────────────────────────────────────────────────────

const defaultUser = { id: "user-123", name: "TestUser", image: null };

function setActiveProfile(profile: ActiveUserProfile | null) {
  activeUserStore.setState(() => ({ profile, isPending: false }));
}

function resetStore() {
  activeUserStore.setState(() => ({ profile: null, isPending: false }));
}

afterEach(() => {
  resetStore();
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("UserMenu profile links", () => {
  it("uses custom url stub in VIEW PUBLIC link when set", () => {
    setActiveProfile({
      discordUsername: "testuser",
      discordId: "123",
      avatarUrl: null,
      guildNickname: null,
      urlStub: "my-custom-slug",
    });

    render(<UserMenu user={defaultUser} />);

    const link = screen.getByTestId("view-public-link");
    expect(link.getAttribute("href")).toBe("/profile/my-custom-slug");
  });

  it("falls back to user id in VIEW PUBLIC link when no url stub", () => {
    setActiveProfile({
      discordUsername: "testuser",
      discordId: "123",
      avatarUrl: null,
      guildNickname: null,
      urlStub: null,
    });

    render(<UserMenu user={defaultUser} />);

    const link = screen.getByTestId("view-public-link");
    expect(link.getAttribute("href")).toBe("/profile/user-123");
  });

  it("falls back to user id when active profile is not loaded", () => {
    render(<UserMenu user={defaultUser} />);

    const link = screen.getByTestId("view-public-link");
    expect(link.getAttribute("href")).toBe("/profile/user-123");
  });
});
