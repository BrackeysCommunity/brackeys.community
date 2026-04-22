import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { activeUserStore } from "@/lib/active-user-store";
import type { ActiveUserProfile } from "@/lib/active-user-store";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSession = { user: { id: "user-abc", name: "Joshe", image: null } };
let sessionData: typeof mockSession | null = null;

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
  useRouterState: () => "/",
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    header: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <header {...rest}>{children}</header>
    ),
    nav: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <nav {...rest}>{children}</nav>
    ),
  },
}));

vi.mock("ahooks", () => ({
  useInterval: vi.fn(),
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  Cancel01Icon: "cancel-icon",
  Clock01Icon: "clock-icon",
  ComputerTerminal01Icon: "terminal-icon",
  Menu01Icon: "menu-icon",
}));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => <span data-testid="icon" />,
}));

vi.mock("@/components/layout/UserMenu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <button type="button" {...rest}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/hotkey", () => ({
  Hotkey: ({ value }: { value: string | string[] }) => (
    <kbd>{Array.isArray(value) ? value[0] : value}</kbd>
  ),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: sessionData }),
    signIn: { social: vi.fn() },
  },
}));

vi.mock("@/lib/auth-store", () => ({
  setAuthSession: vi.fn(),
}));

vi.mock("@/lib/active-user-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/active-user-store")>();
  return {
    ...actual,
    fetchActiveUserProfile: vi.fn(),
    clearActiveUserProfile: vi.fn(),
  };
});

vi.mock("@/lib/hooks/use-command-palette", () => ({
  useCommandPalette: () => ({ setOpen: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-cursor", () => ({
  useMagnetic: () => ({
    ref: { current: null },
    position: { x: 0, y: 0 },
  }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────

const { AppHeader } = await import("../AppHeader");

// ── Helpers ─────────────────────────────────────────────────────────────────

function setActiveProfile(profile: ActiveUserProfile | null) {
  activeUserStore.setState(() => ({ profile, isPending: false }));
}

function resetStore() {
  activeUserStore.setState(() => ({ profile: null, isPending: false }));
}

afterEach(() => {
  sessionData = null;
  resetStore();
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("AppHeader profile links", () => {
  it("desktop profile link uses custom url stub when set", () => {
    sessionData = mockSession;
    setActiveProfile({
      discordUsername: "joshe",
      discordId: "123",
      avatarUrl: null,
      guildNickname: null,
      urlStub: "joshe",
    });

    render(<AppHeader />);

    const link = screen.getByTestId("desktop-profile-link");
    expect(link.getAttribute("href")).toBe("/profile/joshe");
  });

  it("desktop profile link falls back to user id when no stub", () => {
    sessionData = mockSession;
    setActiveProfile({
      discordUsername: "joshe",
      discordId: "123",
      avatarUrl: null,
      guildNickname: null,
      urlStub: null,
    });

    render(<AppHeader />);

    const link = screen.getByTestId("desktop-profile-link");
    expect(link.getAttribute("href")).toBe("/profile/user-abc");
  });

  it("desktop profile link goes to /profile when not logged in", () => {
    sessionData = null;

    render(<AppHeader />);

    const link = screen.getByTestId("desktop-profile-link");
    expect(link.getAttribute("href")).toBe("/profile");
  });

  it("mobile profile link uses custom url stub when set", () => {
    sessionData = mockSession;
    setActiveProfile({
      discordUsername: "joshe",
      discordId: "123",
      avatarUrl: null,
      guildNickname: null,
      urlStub: "joshe",
    });

    render(<AppHeader />);
    fireEvent.click(screen.getByTestId("mobile-menu-toggle"));

    const link = screen.getByTestId("mobile-profile-link");
    expect(link.getAttribute("href")).toBe("/profile/joshe");
  });

  it("mobile profile link falls back to user id when no stub", () => {
    sessionData = mockSession;
    setActiveProfile({
      discordUsername: "joshe",
      discordId: "123",
      avatarUrl: null,
      guildNickname: null,
      urlStub: null,
    });

    render(<AppHeader />);
    fireEvent.click(screen.getByTestId("mobile-menu-toggle"));

    const link = screen.getByTestId("mobile-profile-link");
    expect(link.getAttribute("href")).toBe("/profile/user-abc");
  });

  it("mobile profile link goes to /profile when not logged in", () => {
    sessionData = null;

    render(<AppHeader />);
    fireEvent.click(screen.getByTestId("mobile-menu-toggle"));

    const link = screen.getByTestId("mobile-profile-link");
    expect(link.getAttribute("href")).toBe("/profile");
  });
});
