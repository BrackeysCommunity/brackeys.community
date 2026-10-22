// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { CanvasDetail } from "../canvas-queries";
import { SharePopover } from "../shell/SharePopover";

const calls = vi.hoisted(() => ({
  listCanvasMembers: vi.fn(),
  removeCanvasMember: vi.fn(),
  setCanvasVisibility: vi.fn(),
  listCanvasScopes: vi.fn(),
  searchProfiles: vi.fn(),
}));

/** Every procedure as both a client call and a query-options factory. */
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
    lastEditedById: null,
    lastEditedAt: null,
    hidden: false,
    deletedAt: null,
    updatedAt: new Date(),
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

const members = [
  {
    userId: "bob",
    role: "editor" as const,
    invitedById: "alice",
    createdAt: new Date(),
    displayName: "Bob",
    avatarUrl: null,
    slug: "bob",
  },
];

let nativeConfirm: ReturnType<typeof vi.fn>;
beforeEach(() => {
  calls.listCanvasMembers.mockResolvedValue(members);
  calls.removeCanvasMember.mockResolvedValue({ userId: "bob" });
  calls.listCanvasScopes.mockResolvedValue({ teams: [] });
  nativeConfirm = vi.fn(() => true);
  vi.stubGlobal("confirm", nativeConfirm);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const fn of Object.values(calls)) fn.mockReset();
});

async function open(detail: CanvasDetail, teamName = "Personal") {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SharePopover canvas={detail} teamName={teamName} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Share" }));
  await screen.findByText("Copy link");
  return user;
}

const LABELS = {
  private: /^Private/,
  team: /^Team/,
  unlisted: /^Anyone with the link/,
  public: /^Public/,
};
const radioNames = () =>
  (Object.keys(LABELS) as (keyof typeof LABELS)[]).filter(
    (value) => screen.queryByRole("radio", { name: LABELS[value] }) != null,
  );

describe("SharePopover", { timeout: 20_000 }, () => {
  it("offers a personal canvas's owner its own visibilities and its people", async () => {
    await open(canvas());
    expect(radioNames()).toEqual(["private", "unlisted", "public"]);
    expect(await screen.findByText("Bob")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to a team…" })).toBeTruthy();
  });

  it("offers a team canvas's owner the team's visibilities, and no people list", async () => {
    await open(canvas({ scope: { kind: "team", teamId: "t1" }, visibility: "team" }), "Crew");
    expect(radioNames()).toEqual(["team", "unlisted", "public"]);
    expect(screen.getByText("Everyone on Crew can edit.")).toBeTruthy();
    expect(screen.queryByText("PEOPLE")).toBeNull();
    expect(screen.queryByRole("button", { name: "Move to a team…" })).toBeNull();
  });

  it("lets a team canvas's editor narrow it, with wider options locked and explained", async () => {
    calls.setCanvasVisibility.mockResolvedValue({ id: "c1", visibility: "team" });
    const user = await open(
      canvas({
        scope: { kind: "team", teamId: "t1" },
        visibility: "unlisted",
        access: "write",
        canShare: false,
        canChangeVisibility: true,
        canWidenVisibility: false,
      }),
      "Crew",
    );
    const publicRadio = screen.getByRole("radio", { name: LABELS.public });
    expect(publicRadio.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("radio", { name: LABELS.team }).getAttribute("aria-disabled")).not.toBe(
      "true",
    );

    await user.hover(publicRadio.closest("label")!);
    expect(
      await screen.findByText("Only the team's owners can make this canvas more visible."),
    ).toBeTruthy();
    await user.click(publicRadio);
    expect(calls.setCanvasVisibility).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: LABELS.team }));
    await waitFor(() =>
      expect(calls.setCanvasVisibility).toHaveBeenCalledWith({
        canvasId: "c1",
        visibility: "team",
      }),
    );
  });

  it("locks nothing for a team canvas's owner", async () => {
    await open(canvas({ scope: { kind: "team", teamId: "t1" }, visibility: "team" }), "Crew");
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.getAttribute("aria-disabled")).not.toBe("true");
    }
  });

  it("shows a member their role and Leave, nothing to manage", async () => {
    await open(canvas({ access: "read", canShare: false, isMember: true, memberRole: "viewer" }));
    expect(screen.getByText("You can view this canvas.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Leave" })).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toEqual([]);
    expect(await screen.findByText("Bob")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("removes through the Confirm dialog, never a native prompt", async () => {
    const user = await open(canvas());
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove Bob?")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "REMOVE" }));
    await waitFor(() =>
      expect(calls.removeCanvasMember).toHaveBeenCalledWith({ canvasId: "c1", userId: "bob" }),
    );
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("leaves through the Confirm dialog", async () => {
    const user = await open(
      canvas({ access: "read", canShare: false, isMember: true, memberRole: "viewer" }),
    );
    await user.click(screen.getByRole("button", { name: "Leave" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "LEAVE" }));
    await waitFor(() => expect(calls.removeCanvasMember).toHaveBeenCalledWith({ canvasId: "c1" }));
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
