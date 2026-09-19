// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const captureError = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/product-insights", () => ({ captureError }));

const { AppHeaderFallback, MobileShellFallback, ShellBoundary } = await import("../ShellBoundary");

function Exploding(): React.ReactNode {
  throw new Error("Cannot read properties of undefined (reading 'component')");
}

afterEach(() => {
  captureError.mockReset();
  cleanup();
});

/**
 * BC-209 — a member watched the header vanish and stay vanished. The
 * chunk's import rejected, the `lazy()` threw, and with nothing above it
 * to catch that the failure left no header and said nothing.
 */
describe("ShellBoundary", () => {
  it("renders the fallback instead of taking the shell down", () => {
    // React logs the caught error itself; the assertions are what matter.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ShellBoundary scope="app_header" fallback={<AppHeaderFallback />}>
        <Exploding />
      </ShellBoundary>,
    );
    quiet.mockRestore();

    // Still navigable: a failed chunk costs the session controls, not the site.
    expect(screen.getByRole("link", { name: "JAMS" }).getAttribute("href")).toBe("/jams");
    expect(screen.getByRole("link", { name: "MEMBERS" }).getAttribute("href")).toBe("/members");
  });

  it("reports the failure under a scope naming the surface", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ShellBoundary scope="app_header" fallback={<AppHeaderFallback />}>
        <Exploding />
      </ShellBoundary>,
    );
    quiet.mockRestore();

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][1]).toEqual({ scope: "shell.app_header" });
  });

  it("keeps the page readable when the mobile shell is the thing that failed", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ShellBoundary
        scope="mobile_shell"
        fallback={<MobileShellFallback>page content</MobileShellFallback>}
      >
        <Exploding />
      </ShellBoundary>,
    );
    quiet.mockRestore();

    expect(screen.getByText("page content")).toBeTruthy();
  });

  it("stays out of the way when nothing throws", () => {
    render(
      <ShellBoundary scope="app_header" fallback={<AppHeaderFallback />}>
        <span>the real header</span>
      </ShellBoundary>,
    );

    expect(screen.getByText("the real header")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "JAMS" })).toBeNull();
    expect(captureError).not.toHaveBeenCalled();
  });
});
