// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { CanvasDetail } from "../canvas-queries";
import { SharePopover } from "../shell/SharePopover";

const calls = vi.hoisted(() => ({
  listCanvasMembers: vi.fn(),
  setCanvasVisibility: vi.fn(),
  listCanvasScopes: vi.fn(),
  moveCanvasToTeam: vi.fn(),
  searchProfiles: vi.fn(),
}));

vi.mock("@/orpc/client", () => {
  const procedure = (name: string) => ({
    key: () => [name],
    queryOptions: ({ input }: { input: unknown }) => ({
      queryKey: [name, input],
      queryFn: () => (calls as Record<string, (i: unknown) => unknown>)[name]?.(input) ?? null,
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
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(async () => {}),
}));

function canvas(patch: Partial<CanvasDetail> = {}): CanvasDetail {
  return {
    id: "c1",
    path: "Plan.canvas",
    title: "Plan",
    scope: { kind: "personal" },
    visibility: "private",
    nodeCount: 0,
    hidden: false,
    deletedAt: null,
    hiddenReason: null,
    access: "owner",
    canModerate: false,
    memberRole: null,
    isMember: false,
    canShare: patch.canShare ?? true,
    canChangeVisibility: patch.canShare ?? true,
    canWidenVisibility: patch.canShare ?? true,
    canReport: false,
    snapshot: { nodes: [], edges: [] },
    state: null,
    attachments: {},
    ...patch,
  } as CanvasDetail;
}

const bob = {
  userId: "bob",
  role: "viewer" as const,
  invitedById: "alice",
  createdAt: new Date(),
  displayName: "Bob",
  avatarUrl: null,
  slug: "bob",
};

let natives: Record<"confirm" | "alert" | "prompt", ReturnType<typeof vi.fn>>;
let clipboard: ReturnType<typeof vi.fn>;
beforeEach(() => {
  calls.listCanvasMembers.mockResolvedValue([]);
  calls.listCanvasScopes.mockResolvedValue({
    teams: [
      { teamId: "t1", name: "Crew", status: "active", hidden: false },
      { teamId: "t2", name: "Old", status: "archived", hidden: false },
      { teamId: "t3", name: "Hidden", status: "active", hidden: true },
    ],
  });
  calls.setCanvasVisibility.mockResolvedValue({ id: "c1", visibility: "public" });
  calls.moveCanvasToTeam.mockResolvedValue({ id: "c1" });
  natives = { confirm: vi.fn(() => true), alert: vi.fn(), prompt: vi.fn(() => "x") };
  for (const [name, fn] of Object.entries(natives)) vi.stubGlobal(name, fn);
  clipboard = vi.fn(async () => {});
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of Object.values(calls)) fn.mockReset();
  for (const fn of Object.values(natives)) expect(fn).not.toHaveBeenCalled();
});

async function open(detail: CanvasDetail) {
  const user = userEvent.setup();
  // After setup: user-event installs its own clipboard on navigator.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SharePopover canvas={detail} teamName="Crew" />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Share" }));
  await screen.findByText("Copy link");
  return user;
}

describe("SharePopover flows", { timeout: 20_000 }, () => {
  it("Copy link writes the canvas's absolute permalink", async () => {
    const user = await open(canvas());
    await user.click(screen.getByRole("button", { name: /Copy link/ }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledOnce());
    expect(clipboard.mock.calls[0]![0]).toMatch(/^https?:\/\/[^/]+\/canvases\/c1$/);
  });

  it("Copy link is there for a member too", async () => {
    const user = await open(
      canvas({ access: "read", canShare: false, isMember: true, memberRole: "viewer" }),
    );
    await user.click(screen.getByRole("button", { name: /Copy link/ }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledOnce());
  });

  it("choosing a visibility sends it", async () => {
    const user = await open(canvas());
    await user.click(screen.getByRole("radio", { name: /^Public/ }));
    await waitFor(() =>
      expect(calls.setCanvasVisibility).toHaveBeenCalledWith({
        canvasId: "c1",
        visibility: "public",
      }),
    );
  });

  it("a team member who isn't the owner sees the team line and no visibility controls", async () => {
    await open(
      canvas({
        access: "write",
        canShare: false,
        scope: { kind: "team", teamId: "t1" },
        visibility: "team",
      }),
    );
    expect(screen.queryAllByRole("radio")).toEqual([]);
    expect(screen.getByText("Everyone on Crew can edit.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull();
  });

  it("moves without asking when nobody would lose access, offering only live teams", async () => {
    const user = await open(canvas());
    await user.click(screen.getByRole("button", { name: "Move to a team…" }));
    const crew = await screen.findByRole("radio", { name: "Crew" });
    expect(screen.queryByRole("radio", { name: "Old" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Hidden" })).toBeNull();
    await user.click(crew);
    await user.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() =>
      expect(calls.moveCanvasToTeam).toHaveBeenCalledWith({ canvasId: "c1", teamId: "t1" }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks through Confirm when invited people would lose access, and only moves on confirm", async () => {
    calls.listCanvasMembers.mockResolvedValue([bob]);
    const user = await open(canvas());
    await screen.findByText("Bob");
    await user.click(screen.getByRole("button", { name: "Move to a team…" }));
    await user.click(await screen.findByRole("radio", { name: "Crew" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/1 person loses access/)).toBeTruthy();
    expect(calls.moveCanvasToTeam).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "MOVE" }));
    await waitFor(() =>
      expect(calls.moveCanvasToTeam).toHaveBeenCalledWith({ canvasId: "c1", teamId: "t1" }),
    );
  });
});
