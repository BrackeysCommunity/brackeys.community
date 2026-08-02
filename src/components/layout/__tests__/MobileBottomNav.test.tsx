import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// ── Mocks ──────────────────────────────────────────────────────────────────

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => string }) =>
    select({ location: { pathname: __pathname } }),
}));

vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: ({ icon }: { icon: string }) => <span data-testid={`icon-${icon}`} />,
}));

// Mirrors the component's icon imports — a missing key throws at render
// rather than failing an assertion, so keep this in sync when icons change.
vi.mock("@hugeicons/core-free-icons", () => ({
  Calendar03Icon: "calendar",
  ComputerTerminal01Icon: "terminal",
  Home01Icon: "home",
  UserGroupIcon: "user-group",
  UserIcon: "user",
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: null }),
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey?: unknown[] }) => {
    // The nav queries `getProfile` for `/profile/<param>` routes to
    // decide whether ME should highlight — serve the stubbed
    // ownership answer for that key, nothing for the rest.
    if (Array.isArray(opts.queryKey) && opts.queryKey[0] === "getProfile") {
      return { data: __viewedProfile };
    }
    return { data: undefined };
  },
}));

vi.mock("@/orpc/client", () => ({
  orpc: {
    unreadCount: { queryOptions: () => ({ queryKey: ["unreadCount"], queryFn: vi.fn() }) },
    getProfile: {
      queryOptions: ({ input }: { input: { userId: string } }) => ({
        queryKey: ["getProfile", input],
        queryFn: vi.fn(),
      }),
    },
  },
}));

let __pathname = "/";
let __viewedProfile: { isOwner: boolean } | undefined;

// ── Import after mocks ─────────────────────────────────────────────────────

const { MobileBottomNav } = await import("../MobileBottomNav");

afterEach(() => {
  cleanup();
  navigate.mockReset();
  __pathname = "/";
  __viewedProfile = undefined;
});

describe("MobileBottomNav", () => {
  it("renders Home / Jams / Collab / Command / Profile", () => {
    render(<MobileBottomNav />);
    expect(screen.getByLabelText("Home")).toBeTruthy();
    expect(screen.getByLabelText("Jams")).toBeTruthy();
    expect(screen.getByLabelText("Collab")).toBeTruthy();
    expect(screen.getByLabelText("Command")).toBeTruthy();
    expect(screen.getByLabelText("Profile")).toBeTruthy();
  });

  it("clicking Home navigates to /", () => {
    __pathname = "/collab";
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByLabelText("Home"));
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("clicking Collab navigates to /collab", () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByLabelText("Collab"));
    expect(navigate).toHaveBeenCalledWith({ to: "/collab" });
  });

  it("clicking Command navigates to /command-center", () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByLabelText("Command"));
    expect(navigate).toHaveBeenCalledWith({ to: "/command-center" });
  });

  it("clicking Profile navigates to /profile", () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByLabelText("Profile"));
    expect(navigate).toHaveBeenCalledWith({ to: "/profile" });
  });

  it("clicking Jams navigates to /jams", () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByLabelText("Jams"));
    expect(navigate).toHaveBeenCalledWith({ to: "/jams" });
  });

  it("reflects active pathname on the segmented item (Collab)", () => {
    render(<MobileBottomNav pathnameOverride="/collab" />);
    expect(screen.getByLabelText("Collab").getAttribute("aria-pressed")).toBe("true");
  });

  it("reflects active pathname on the segmented item (Home)", () => {
    render(<MobileBottomNav pathnameOverride="/" />);
    expect(screen.getByLabelText("Home").getAttribute("aria-pressed")).toBe("true");
  });

  it("selects ME on the own-profile index route", () => {
    render(<MobileBottomNav pathnameOverride="/profile" />);
    expect(screen.getByLabelText("Profile").getAttribute("aria-pressed")).toBe("true");
  });

  it("selects ME when the viewed profile is owned by the session user", () => {
    __viewedProfile = { isOwner: true };
    render(<MobileBottomNav pathnameOverride="/profile/some-stub" />);
    expect(screen.getByLabelText("Profile").getAttribute("aria-pressed")).toBe("true");
  });

  it("does not select ME when viewing someone else's profile", () => {
    __viewedProfile = { isOwner: false };
    render(<MobileBottomNav pathnameOverride="/profile/someone-else" />);
    expect(screen.getByLabelText("Profile").getAttribute("aria-pressed")).not.toBe("true");
  });
});
