// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
describe("SharePopover locked widening", { timeout: 20_000 }, () => {
  const editorView = (visibility: string) =>
    canvas({
      scope: { kind: "team", teamId: "t1" },
      visibility,
      access: "write",
      canShare: false,
      canChangeVisibility: true,
      canWidenVisibility: false,
    });

  it("arrow keys from the narrowest option never reach a locked one", async () => {
    calls.setCanvasVisibility.mockResolvedValue({ id: "c1", visibility: "team" });
    const user = await open(editorView("team"), "Crew");
    screen.getByRole("radio", { name: LABELS.team }).focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}{ArrowUp}{End}");
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.setCanvasVisibility).not.toHaveBeenCalled();
  });

  it("from public, every narrower option is open", async () => {
    await open(editorView("public"), "Crew");
    expect(
      screen.getByRole("radio", { name: LABELS.unlisted }).getAttribute("aria-disabled"),
    ).not.toBe("true");
    expect(screen.getByRole("radio", { name: LABELS.team }).getAttribute("aria-disabled")).not.toBe(
      "true",
    );
  });

  it("an editor of a personal canvas sees no visibility picker at all", async () => {
    await open(
      canvas({
        visibility: "unlisted",
        access: "write",
        canShare: false,
        canChangeVisibility: false,
        canWidenVisibility: false,
      }),
    );
    expect(
      screen.queryAllByRole("radio").filter((r) => r.closest("[role=radiogroup]")),
    ).toHaveLength(0);
  });
});
