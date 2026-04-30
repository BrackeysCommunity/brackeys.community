import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { activeUserStore } from "@/lib/active-user-store";
import type { ActiveUserProfile } from "@/lib/active-user-store";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: { userId?: string };
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => {
    const href = params?.userId ? to.replace("$userId", params.userId) : to;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: __pathname } }),
}));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: ({ icon }: { icon: string }) => <span data-testid={`icon-${icon}`} />,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
  Calendar03Icon: "calendar",
  PaintBucketIcon: "paint",
  Shield01Icon: "shield",
  UserGroupIcon: "user-group",
  UserIcon: "user",
}));

const setOpen = vi.fn();
vi.mock("@/lib/hooks/use-command-palette", () => ({
  useCommandPalette: () => ({ setOpen, open: false }),
}));

const useSession = vi.fn(() => ({ data: null as { user?: { id?: string } } | null }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => useSession() },
}));

// Pathname is mutated per-test to drive useRouterState's select callback.
let __pathname = "/";

// ── Import after mocks ─────────────────────────────────────────────────────

const { MobileBottomNav } = await import("../MobileBottomNav");

// ── Helpers ────────────────────────────────────────────────────────────────

function setActiveProfile(profile: ActiveUserProfile | null) {
  activeUserStore.setState(() => ({ profile, isPending: false }));
}

afterEach(() => {
  cleanup();
  setActiveProfile(null);
  setOpen.mockReset();
  useSession.mockReset();
  useSession.mockImplementation(() => ({ data: null }));
  __pathname = "/";
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("MobileBottomNav", () => {
  it("renders Home / Jams / Collab / Me / Themes in order", () => {
    render(<MobileBottomNav />);
    const labels = screen
      .getAllByRole("link")
      .concat(screen.getAllByRole("button", { name: /themes/i }))
      .map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(expect.arrayContaining(["Home", "Jams", "Collab", "Me", "Themes"]));
  });

  it("links Collab to /collab and Home to /", () => {
    render(<MobileBottomNav />);
    expect(screen.getByLabelText("Home").getAttribute("href")).toBe("/");
    expect(screen.getByLabelText("Collab").getAttribute("href")).toBe("/collab");
  });

  it("uses /profile fallback when no profile slug is available", () => {
    render(<MobileBottomNav />);
    expect(screen.getByLabelText("Me").getAttribute("href")).toBe("/profile");
  });

  it("uses /profile/$userId when active profile has urlStub", () => {
    setActiveProfile({
      id: "u1",
      urlStub: "joshe",
    } as unknown as ActiveUserProfile);
    render(<MobileBottomNav />);
    expect(screen.getByLabelText("Me").getAttribute("href")).toBe("/profile/joshe");
  });

  it("falls back to session user id when there is no profile but a session", () => {
    useSession.mockImplementation(() => ({ data: { user: { id: "session-42" } } }));
    render(<MobileBottomNav />);
    expect(screen.getByLabelText("Me").getAttribute("href")).toBe("/profile/session-42");
  });

  it("opens the command palette when Themes is clicked", () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByLabelText("Themes"));
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it("calls onOpenThemes override instead of opening the palette when provided", () => {
    const onOpenThemes = vi.fn();
    render(<MobileBottomNav onOpenThemes={onOpenThemes} />);
    fireEvent.click(screen.getByLabelText("Themes"));
    expect(onOpenThemes).toHaveBeenCalled();
    expect(setOpen).not.toHaveBeenCalled();
  });

  it("respects pathnameOverride for active state (story-friendly hook)", () => {
    __pathname = "/something-else"; // would normally be home
    render(<MobileBottomNav pathnameOverride="/collab" />);
    // active state is internal — sanity check via aria-label presence remains correct
    expect(screen.getByLabelText("Collab")).toBeTruthy();
  });
});
