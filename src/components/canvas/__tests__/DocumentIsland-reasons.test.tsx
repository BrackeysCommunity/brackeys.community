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

describe("DocumentIsland reason dialogs", { timeout: 20_000 }, () => {
  it("caps the report reason at the server's 1000 and the hide reason at 500", async () => {
    mount(canvas({ canReport: true }));
    let user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Report/ }));
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByLabelText("Reason").getAttribute("maxlength")).toBe("1000");

    cleanup();
    mount(canvas({ canModerate: true }));
    user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Hide canvas/ }));
    dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByLabelText("Reason").getAttribute("maxlength")).toBe("500");
  });

  it("keeps the submit disabled for a blank reason and sends a trimmed one", async () => {
    calls.setCanvasHidden.mockResolvedValue({ success: true, changed: true });
    const confirm = vi.spyOn(window, "confirm");
    const prompt = vi.spyOn(window, "prompt");
    mount(canvas({ canModerate: true }));
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Hide canvas/ }));
    const dialog = await screen.findByRole("alertdialog");
    const submit = within(dialog).getByRole("button", { name: "HIDE" });
    await user.type(within(dialog).getByLabelText("Reason"), "   ");
    expect(submit.hasAttribute("disabled") || submit.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
    await user.type(within(dialog).getByLabelText("Reason"), "spam  ");
    await user.click(submit);
    await waitFor(() =>
      expect(calls.setCanvasHidden).toHaveBeenCalledWith({
        canvasId: "c1",
        hidden: true,
        reason: "spam",
      }),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("a failed report leaves the dialog's reason so it can be retried", async () => {
    calls.reportCanvas.mockRejectedValueOnce(new Error("rate limited"));
    mount(canvas({ canReport: true }));
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Report/ }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByLabelText("Reason"), "spam");
    await user.click(within(dialog).getByRole("button", { name: "REPORT" }));
    await waitFor(() => expect(calls.reportCanvas).toHaveBeenCalledTimes(1));
    const still = await screen.findByRole("alertdialog");
    expect((within(still).getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("spam");
  });
});
