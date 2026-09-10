import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { activeUserStore } from "@/lib/active-user-store";
import type { ActiveUserProfile } from "@/lib/active-user-store";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSession = { user: { id: "user-abc", name: "Joshe", image: null } };
let sessionData: typeof mockSession | null = null;
let currentPath = "/";

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
  useRouterState: () => currentPath,
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

vi.mock("@/components/layout/SettingsMenu", () => ({
  SettingsMenu: () => <div data-testid="settings-menu" />,
}));

vi.mock("@/components/notifications/NotificationBell", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

vi.mock("@/components/attention/AttentionMenu", () => ({
  AttentionMenu: () => <div data-testid="attention-menu" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...rest }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <button type="button" {...rest}>
      {children}
    </button>
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

vi.mock("@/lib/hooks/use-cursor", () => ({
  HEADER_MAGNET_STRENGTH: 0.05,
  useMagnetic: () => ({
    ref: { current: null },
    position: { x: 0, y: 0 },
  }),
}));

// ── Import after mocks ─────────────────────────────────────────────────────

const { AppHeader } = await import("../AppHeader");
const { AppSettingsProvider } = await import("@/lib/hooks/use-app-settings");

// ── Helpers ─────────────────────────────────────────────────────────────────

// The header's auto-hide reads the effective motion pref, so it needs the
// same provider the root document mounts around the whole shell.
function renderHeader() {
  return render(
    <AppSettingsProvider>
      <AppHeader />
    </AppSettingsProvider>,
  );
}

function setActiveProfile(profile: ActiveUserProfile | null) {
  activeUserStore.setState(() => ({ profile, isPending: false }));
}

/**
 * Click a nav link and report whether its handler suppressed the navigation.
 * The document-level listener reads `defaultPrevented` after React's own
 * handler has run, then stops jsdom trying to follow the href — which it
 * cannot do, and complains about loudly.
 */
function clickSuppressesNavigation(element: Element) {
  let prevented = false;
  const spy = (event: Event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", spy);
  fireEvent.click(element);
  document.removeEventListener("click", spy);
  return prevented;
}

function resetStore() {
  activeUserStore.setState(() => ({ profile: null, isPending: false }));
}

afterEach(() => {
  sessionData = null;
  currentPath = "/";
  resetStore();
  cleanup();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("AppHeader navigation", () => {
  it("desktop nav links to the member directory", () => {
    sessionData = mockSession;
    setActiveProfile({
      discordUsername: "joshe",
      discordId: "123",
      avatarUrl: null,
      guildNickname: null,
      urlStub: "joshe",
      isStaff: false,
      isAdmin: false,
    });

    renderHeader();

    expect(screen.getByTestId("desktop-members-link").getAttribute("href")).toBe("/members");
  });

  it("mobile menu links to the member directory", () => {
    sessionData = mockSession;

    renderHeader();
    fireEvent.click(screen.getByTestId("mobile-menu-toggle"));

    expect(screen.getByTestId("mobile-members-link").getAttribute("href")).toBe("/members");
  });

  it("members link is public — it renders signed out too", () => {
    sessionData = null;

    renderHeader();

    expect(screen.getByTestId("desktop-members-link").getAttribute("href")).toBe("/members");
  });

  // The own-profile entry moved to the user menu, which owns the stub
  // resolution now (see UserMenu.test.tsx) — the bar must not grow a
  // second one.
  it("does not carry its own profile link", () => {
    sessionData = mockSession;

    renderHeader();
    fireEvent.click(screen.getByTestId("mobile-menu-toggle"));

    expect(screen.queryByTestId("desktop-profile-link")).toBeNull();
    expect(screen.queryByTestId("mobile-profile-link")).toBeNull();
  });
});

// "This section is lit" and "you are already here" used to share one
// boolean, so a lit tab on a detail page called preventDefault and the only
// way back to the list was the browser's back button.
describe("AppHeader section links from detail pages", () => {
  const SECTIONS = [
    { slug: "teams", detail: "/teams/comfy", root: "/teams" },
    { slug: "jams", detail: "/jams/412", root: "/jams" },
    { slug: "members", detail: "/members/someone", root: "/members" },
    { slug: "collab", detail: "/collab/412", root: "/collab" },
  ];

  it.each(SECTIONS)("$slug still navigates from $detail", ({ slug, detail, root }) => {
    currentPath = detail;
    renderHeader();

    const link = screen.getByTestId(`desktop-${slug}-link`);
    expect(link.getAttribute("href")).toBe(root);
    // Lit, but not the page itself.
    expect(link.getAttribute("aria-current")).toBe("true");
    expect(clickSuppressesNavigation(link)).toBe(false);
  });

  it.each(SECTIONS)("$slug does not re-navigate from $root", ({ slug, root }) => {
    currentPath = root;
    renderHeader();

    const link = screen.getByTestId(`desktop-${slug}-link`);
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(clickSuppressesNavigation(link)).toBe(true);
  });

  it.each(SECTIONS)("$slug in the mobile menu navigates from $detail", ({ slug, detail }) => {
    currentPath = detail;
    renderHeader();
    fireEvent.click(screen.getByTestId("mobile-menu-toggle"));

    expect(clickSuppressesNavigation(screen.getByTestId(`mobile-${slug}-link`))).toBe(false);
  });
});
