import { cleanup, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ResponsiveModal } from "@/components/ui/responsive-modal";

// ── Mocks ──────────────────────────────────────────────────────────────────

let isMobile = false;
vi.mock("@/lib/hooks/use-mobile", () => ({ useIsMobile: () => isMobile }));

// The two shapes are stubbed down to a marker each: what §3.3 is about is
// which one a surface gets at a given width, not how either one animates.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="drawer">{children}</div> : null,
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

afterEach(() => {
  isMobile = false;
  cleanup();
});

function renderModal(props?: { className?: string }) {
  return render(
    <ResponsiveModal
      open
      onClose={() => {}}
      title="Start a team"
      description="Name your team."
      footer={<div data-testid="footer">actions</div>}
      {...props}
    >
      <div data-testid="body">fields</div>
    </ResponsiveModal>,
  );
}

describe("ResponsiveModal", () => {
  it("is a dialog on desktop", () => {
    renderModal();

    expect(screen.getByTestId("dialog")).toBeDefined();
    expect(screen.queryByTestId("drawer")).toBeNull();
  });

  // Yasahiro's report: START A TEAM was a bottom-pinned drawer at 1920px
  // while the collab wizard beside it was a modal.
  it("is a drawer on a phone", () => {
    isMobile = true;

    renderModal();

    expect(screen.getByTestId("drawer")).toBeDefined();
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("renders the same title, body and footer either way", () => {
    for (const mobile of [false, true]) {
      isMobile = mobile;
      renderModal();

      expect(screen.getByRole("heading", { name: "Start a team" })).toBeDefined();
      expect(screen.getByTestId("body")).toBeDefined();
      expect(screen.getByTestId("footer")).toBeDefined();
      cleanup();
    }
  });

  it("lets a caller widen the desktop panel without touching the drawer", () => {
    renderModal({ className: "sm:max-w-3xl" });

    expect(screen.getByTestId("dialog-content").className).toContain("sm:max-w-3xl");
  });
});
