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

vi.mock("@hugeicons/core-free-icons", () => ({
  Calendar03Icon: "calendar",
  ComputerTerminal01Icon: "terminal",
  Settings01Icon: "settings",
  Shield01Icon: "shield",
  UserGroupIcon: "user-group",
}));

const setOpen = vi.fn();
vi.mock("@/lib/hooks/use-command-palette", () => ({
  useCommandPalette: () => ({ setOpen, open: false }),
}));

let __pathname = "/";

// ── Import after mocks ─────────────────────────────────────────────────────

const { MobileBottomNav } = await import("../MobileBottomNav");

afterEach(() => {
  cleanup();
  setOpen.mockReset();
  navigate.mockReset();
  __pathname = "/";
});

describe("MobileBottomNav", () => {
  it("renders Home / Jams / Collab / Command / Settings", () => {
    render(<MobileBottomNav />);
    expect(screen.getByLabelText("Home")).toBeTruthy();
    expect(screen.getByLabelText("Jams")).toBeTruthy();
    expect(screen.getByLabelText("Collab")).toBeTruthy();
    expect(screen.getByLabelText("Command")).toBeTruthy();
    expect(screen.getByLabelText("Settings")).toBeTruthy();
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

  it("clicking Settings opens the command palette", () => {
    render(<MobileBottomNav />);
    fireEvent.click(screen.getByLabelText("Settings"));
    expect(setOpen).toHaveBeenCalledWith(true);
    expect(navigate).not.toHaveBeenCalled();
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
});
