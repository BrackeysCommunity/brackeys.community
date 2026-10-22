// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AdminReportQueue } from "../AdminReportQueue";

const calls = vi.hoisted(() => ({
  listCanvasReports: vi.fn(),
  resolveCanvasReport: vi.fn(),
}));

vi.mock("@/orpc/client", () => {
  const procedure = (name: string) => ({
    key: () => [name],
    queryOptions: ({ input }: { input: unknown }) => ({
      queryKey: [name, input],
      queryFn: () => (calls as Record<string, (i: unknown) => unknown>)[name]?.(input) ?? [],
    }),
  });
  const client = new Proxy(
    {},
    {
      get: (_t, name: string) => (input: unknown) =>
        (calls as Record<string, (i: unknown) => unknown>)[name]?.(input),
    },
  );
  return { client, orpc: new Proxy({}, { get: (_t, name: string) => procedure(name) }) };
});
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children?: React.ReactNode; params?: { canvasId?: string } }) => (
    <a href={`/canvases/${params?.canvasId ?? ""}`}>{children}</a>
  ),
}));
vi.mock("@/lib/hooks/use-flag", () => ({ useFlag: () => false }));
vi.mock("@/components/canvas/CanvasThumbnail", () => ({
  CanvasThumbnail: ({ thumbnail }: { thumbnail: unknown }) => (
    <div data-testid="thumbnail" data-has={thumbnail ? "yes" : "no"} />
  ),
}));

const now = new Date("2026-10-20T12:00:00Z");

function report(patch: Record<string, unknown> = {}) {
  return {
    id: 1,
    canvasId: "c1",
    canvasTitle: "Plan",
    reporterId: "stranger",
    reason: "spam",
    createdAt: now,
    resolvedAt: null,
    resolvedById: null,
    liveVisibility: "public",
    liveHiddenAt: null,
    liveDeletedAt: null,
    liveTeamId: null,
    liveOwnerId: "alice",
    liveTitle: "Plan",
    thumbnail: { box: { x: 0, y: 0, w: 10, h: 10 }, rects: [[0, 0, 10, 10, null, false]] },
    excerpt: "Level ideas · Boss fight",
    reporter: { id: "stranger", displayName: "Stranger", avatarUrl: null },
    ...patch,
  };
}

beforeEach(() => {
  calls.resolveCanvasReport.mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  for (const fn of Object.values(calls)) fn.mockReset();
});

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminReportQueue isAdmin />
    </QueryClientProvider>,
  );
}

describe("AdminReportQueue canvas rows", { timeout: 20_000 }, () => {
  it("shows a canvas report with its thumbnail, live state, excerpt and link, grouped per canvas", async () => {
    calls.listCanvasReports.mockResolvedValue([
      report(),
      report({
        id: 2,
        reporterId: "carol",
        reason: "rude",
        reporter: { id: "carol", displayName: "Carol", avatarUrl: null },
      }),
    ]);
    mount();
    const link = await screen.findByRole("link", { name: "Plan" });
    expect(link.getAttribute("href")).toBe("/canvases/c1");
    expect(screen.getAllByTestId("thumbnail")).toHaveLength(1);
    expect(screen.getByTestId("thumbnail").dataset.has).toBe("yes");
    expect(screen.getByText("PUBLIC")).toBeTruthy();
    expect(screen.getByText("Level ideas · Boss fight")).toBeTruthy();
    expect(screen.getByText(/spam/)).toBeTruthy();
    expect(screen.getByText(/rude/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Hide canvas" })).toHaveLength(1);
  });

  it("hides through a Confirm with the typed reason", async () => {
    calls.listCanvasReports.mockResolvedValue([report()]);
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Hide canvas" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox"), "abuse");
    await user.click(within(dialog).getByRole("button", { name: /Hide canvas/i }));
    await waitFor(() =>
      expect(calls.resolveCanvasReport).toHaveBeenCalledWith({
        reportId: 1,
        action: "hide_canvas",
        reason: "abuse",
      }),
    );
    expect(confirm).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("won't hide until a reason is typed", async () => {
    calls.listCanvasReports.mockResolvedValue([report()]);
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Hide canvas" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("REASON (REQUIRED)")).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: /Hide canvas/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(dialog).getByRole("textbox"), "   ");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.click(confirm);
    expect(calls.resolveCanvasReport).not.toHaveBeenCalled();
  });

  it("dismisses through a Confirm", async () => {
    calls.listCanvasReports.mockResolvedValue([report()]);
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /Dismiss report/i }));
    await waitFor(() =>
      expect(calls.resolveCanvasReport).toHaveBeenCalledWith({ reportId: 1, action: "dismiss" }),
    );
  });

  it("an already-hidden canvas offers dismiss only; a deleted one shows the snapshot title", async () => {
    calls.listCanvasReports.mockResolvedValue([
      report({ liveHiddenAt: now }),
      report({
        id: 9,
        canvasId: null,
        liveTitle: null,
        canvasTitle: "Gone",
        thumbnail: null,
        excerpt: null,
        liveVisibility: null,
      }),
    ]);
    mount();
    expect(await screen.findByText("HIDDEN")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Already hidden/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide canvas" })).toBeNull();
    expect(screen.getByText("Gone")).toBeTruthy();
    expect(screen.getByText(/canvas deleted/)).toBeTruthy();
  });
});
