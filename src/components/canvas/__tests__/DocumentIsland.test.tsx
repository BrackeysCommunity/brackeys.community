// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { CanvasDetail } from "../canvas-queries";
import { DocumentIsland } from "../shell/DocumentIsland";

const calls = vi.hoisted(() => ({ setCanvasHidden: vi.fn(), reportCanvas: vi.fn() }));

vi.mock("@/orpc/client", () => {
  const procedure = (name: string) => ({
    key: () => [name],
    queryOptions: ({ input }: { input: unknown }) => ({
      queryKey: [name, input],
      queryFn: () => null,
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
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(async () => {}),
}));
vi.mock("../shell/SiteMenu", () => ({ SiteMenu: () => null }));

function canvas(patch: Partial<CanvasDetail> = {}): CanvasDetail {
  return {
    id: "c1",
    path: "Plan.canvas",
    title: "Plan",
    scope: { kind: "personal" },
    visibility: "public",
    hidden: false,
    deletedAt: null,
    hiddenReason: null,
    access: "read",
    canModerate: false,
    canReport: false,
    canShare: false,
    isMember: false,
    memberRole: null,
    snapshot: { nodes: [], edges: [] },
    attachments: {},
    ...patch,
  } as CanvasDetail;
}

afterEach(() => {
  cleanup();
  for (const fn of Object.values(calls)) fn.mockReset();
});

function mount(detail: CanvasDetail, editable = false, compact = false) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentIsland
        canvas={detail}
        scopeName="Personal"
        editable={editable}
        exportJson={() => detail.snapshot}
        compact={compact}
      />
    </QueryClientProvider>,
  );
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Canvas menu" }));
  await screen.findByRole("menu");
  return user;
}

describe("DocumentIsland moderation items", { timeout: 20_000 }, () => {
  it("has no menu for a reader who can neither moderate nor report", () => {
    mount(canvas());
    expect(screen.queryByRole("button", { name: "Canvas menu" })).toBeNull();
  });

  it("gives a reporter Report only, and sends the reason", async () => {
    calls.reportCanvas.mockResolvedValue({ id: 1 });
    mount(canvas({ canReport: true }));
    const user = await openMenu();
    expect(screen.queryByRole("menuitem", { name: /Hide canvas/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Rename/ })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: /Report/ }));
    const dialog = await screen.findByRole("alertdialog");
    const submit = within(dialog).getByRole("button", { name: "REPORT" });
    expect(submit.hasAttribute("disabled") || submit.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
    await user.type(within(dialog).getByLabelText("Reason"), "spam");
    await user.click(submit);
    await waitFor(() =>
      expect(calls.reportCanvas).toHaveBeenCalledWith({ canvasId: "c1", reason: "spam" }),
    );
  });

  it("gives staff Hide with a required reason, and Unhide on a hidden canvas", async () => {
    calls.setCanvasHidden.mockResolvedValue({ success: true, changed: true });
    mount(canvas({ canModerate: true }));
    let user = await openMenu();
    expect(screen.queryByRole("menuitem", { name: /Report/ })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: /Hide canvas/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByLabelText("Reason"), "abuse");
    await user.click(within(dialog).getByRole("button", { name: "HIDE" }));
    await waitFor(() =>
      expect(calls.setCanvasHidden).toHaveBeenCalledWith({
        canvasId: "c1",
        hidden: true,
        reason: "abuse",
      }),
    );

    cleanup();
    mount(canvas({ canModerate: true, hidden: true }));
    user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Unhide canvas/ }));
    await waitFor(() =>
      expect(calls.setCanvasHidden).toHaveBeenLastCalledWith({ canvasId: "c1", hidden: false }),
    );
  });

  it("keeps the editing items for an editor, with moderation after them", async () => {
    mount(canvas({ access: "owner", canModerate: true }), true);
    await openMenu();
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(items.slice(0, 1)).toEqual(["Rename"]);
    expect(items.at(-1)).toBe("Hide canvas…");
  });

  it("offers Report and Hide on a phone too, without the editing items", async () => {
    mount(canvas({ canReport: true }), false, true);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: /Report/ })).toBeTruthy();

    cleanup();
    mount(canvas({ access: "owner", canModerate: true }), true, true);
    await openMenu();
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(items).toEqual(["Hide canvas…"]);
  });
});
