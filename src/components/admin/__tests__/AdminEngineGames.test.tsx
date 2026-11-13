// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AdminEngineGames } from "../AdminEngineGames";

const calls = vi.hoisted(() => ({
  listGameModerationQueue: vi.fn(),
  listImageFlags: vi.fn(),
  resolveGameReport: vi.fn(),
  unhideRelease: vi.fn(),
  approveGamePublic: vi.fn(),
  resolveImageFlags: vi.fn(),
  listSceneVersionQueue: vi.fn(),
  hideSceneVersion: vi.fn(),
  unhideSceneVersion: vi.fn(),
}));
const gate = vi.hoisted(() => ({ flag: true, allowed: true }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("@/orpc/client", () => {
  const call = (name: string, input: unknown) =>
    (calls as Record<string, (i: unknown) => unknown>)[name]?.(input);
  const procedure = (name: string) => ({
    key: () => [name],
    queryOptions: ({ input }: { input: unknown }) => ({
      queryKey: [name, input],
      queryFn: () => (calls as Record<string, (i: unknown) => unknown>)[name]?.(input) ?? null,
    }),
  });
  const client = new Proxy(
    {},
    { get: (_t, name: string) => (input: unknown) => call(name, input) },
  );
  return { client, orpc: new Proxy({}, { get: (_t, name: string) => procedure(name) }) };
});
vi.mock("@tanstack/react-router", () => ({
  createLink: <C,>(component: C) => component,
  Link: ({
    children,
    params,
    to,
  }: {
    children?: React.ReactNode;
    params?: Record<string, string>;
    to?: string;
  }) => (
    <a href={(to ?? "").replace(/\$(\w+)/g, (_m, key: string) => params?.[key] ?? "")}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/hooks/use-flag", () => ({
  useFlag: (key: string) => key === "engine-games-enabled" && gate.flag,
}));
vi.mock("@/lib/engine/guard", () => ({ engineGamesAllowed: () => gate.allowed }));
vi.mock("@/lib/toast", () => ({ toast: toasts }));
vi.mock("@/lib/product-insights", () => ({ reportMutationError: vi.fn() }));

const now = new Date("2026-11-10T12:00:00Z");

function report(patch: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: "tactics",
    releaseId: "a".repeat(64),
    version: 2,
    title: "Tactics",
    reason: "stolen art",
    createdAt: now,
    resolvedAt: null,
    resolution: null,
    reporter: { id: "carol", displayName: "Carol", avatarUrl: null, urlStub: "carol" },
    projectHiddenAt: null,
    releaseHiddenAt: null,
    ...patch,
  };
}

function review(patch: Record<string, unknown> = {}) {
  return {
    projectId: "kitchen",
    name: "Kitchen",
    teamName: "Cooks",
    requestedAt: now,
    hiddenAt: null,
    ...patch,
  };
}

function flag(patch: Record<string, unknown> = {}) {
  return {
    id: 7,
    objectKey: `engine-releases/tactics/${"b".repeat(64)}`,
    ownerType: "engine_release_file",
    ownerId: "tactics",
    uploaderId: null,
    kind: "nsfw",
    source: "scan",
    score: 0.97,
    evidence: null,
    status: "open",
    resolvedAt: null,
    resolvedById: null,
    createdAt: now,
    scanStatus: "quarantined",
    scannedAt: now,
    imageUrl: "/staff-image/engine-releases/tactics/bbbb",
    ownerTypeLabel: "Release file",
    owner: null,
    uploader: null,
    resolvedBy: null,
    ...patch,
  };
}

function sceneVersion(patch: Record<string, unknown> = {}) {
  return {
    projectId: "tactics",
    projectName: "Tactics",
    scene: "level-1",
    number: 4,
    id: "c".repeat(64),
    createdAt: now,
    compatKey: "d".repeat(64),
    pointers: ["preview", "production"],
    reports: { ok: 12, failed: 5 },
    blocked: null,
    hidden: null,
    ...patch,
  };
}

function queue(reports: unknown[] = [], reviews: unknown[] = []) {
  calls.listGameModerationQueue.mockResolvedValue({ reports, reviews });
}

function flags(items: unknown[] = []) {
  calls.listImageFlags.mockImplementation((input: { ownerType?: string }) =>
    Promise.resolve({
      items: items.filter((f) => (f as { ownerType: string }).ownerType === input.ownerType),
      total: items.length,
      page: 1,
      pageSize: 50,
      pageCount: 1,
    }),
  );
}

beforeEach(() => {
  gate.flag = true;
  gate.allowed = true;
  queue();
  flags();
  calls.listSceneVersionQueue.mockResolvedValue([]);
  for (const name of [
    "resolveGameReport",
    "unhideRelease",
    "approveGamePublic",
    "resolveImageFlags",
  ] as const) {
    calls[name].mockResolvedValue({ success: true });
  }
  calls.hideSceneVersion.mockResolvedValue(null);
  calls.unhideSceneVersion.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  for (const fn of Object.values(calls)) fn.mockReset();
  for (const fn of Object.values(toasts)) fn.mockReset();
  vi.unstubAllGlobals();
});

function mount(queryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <AdminEngineGames />
    </QueryClientProvider>,
  );
}

describe("AdminEngineGames", { timeout: 20_000 }, () => {
  it("renders a report, a public review request and a flagged release image", async () => {
    queue([report()], [review()]);
    flags([flag(), flag({ id: 8, ownerType: "engine_blob", ownerId: "kitchen", kind: "other" })]);
    mount();

    const game = await screen.findByRole("link", { name: "Tactics" });
    expect(game.getAttribute("href")).toBe("/games/tactics");
    expect(screen.getByText("V2")).toBeTruthy();
    expect(screen.getByText(/stolen art/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Carol/ }).getAttribute("href")).toBe("/profile/carol");
    expect(screen.getByText("C")).toBeTruthy();

    expect(screen.getByText("FIRST PUBLIC")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kitchen" }).getAttribute("href")).toBe(
      "/games/kitchen",
    );
    expect(screen.getByText("by Cooks")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve public" })).toBeTruthy();

    await waitFor(() => expect(screen.getAllByText("RELEASES HIDDEN")).toHaveLength(2));
    expect(screen.getByText("NSFW")).toBeTruthy();
    expect(screen.getAllByText(/flagged/).length).toBeGreaterThan(0);
    expect(calls.listImageFlags).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: "engine_release_file", includeResolved: false }),
    );
    expect(calls.listImageFlags).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: "engine_blob", includeResolved: false }),
    );
  });

  it("hides a version only once a reason is typed into the Confirm", async () => {
    queue([report()]);
    const nativeConfirm = vi.fn();
    vi.stubGlobal("confirm", nativeConfirm);
    mount();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Hide version" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("REASON (REQUIRED)")).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Hide version" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(dialog).getByRole("textbox"), "   ");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(within(dialog).getByRole("textbox"), "art lifted from another game");
    await user.click(confirm);
    await waitFor(() =>
      expect(calls.resolveGameReport).toHaveBeenCalledWith({
        reportId: 1,
        action: "hide-release",
        reason: "art lifted from another game",
      }),
    );
    expect(nativeConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
  });

  it("hides the whole game with a reason", async () => {
    queue([report({ version: null, releaseId: null })]);
    mount();
    const user = userEvent.setup();

    expect(await screen.findByRole("button", { name: "Hide game" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide version" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hide game" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox"), "hateful");
    await user.click(within(dialog).getByRole("button", { name: "Hide game" }));
    await waitFor(() =>
      expect(calls.resolveGameReport).toHaveBeenCalledWith({
        reportId: 1,
        action: "hide-project",
        reason: "hateful",
      }),
    );
  });

  it("dismisses a report through a Confirm", async () => {
    queue([report()]);
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Dismiss report" }));
    await waitFor(() =>
      expect(calls.resolveGameReport).toHaveBeenCalledWith({ reportId: 1, action: "dismiss" }),
    );
  });

  it("unhides a hidden version instead of offering to hide it again", async () => {
    queue([report({ releaseHiddenAt: now })]);
    mount();
    const user = userEvent.setup();
    expect(await screen.findByText("VERSION HIDDEN")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide version" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Unhide version" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Unhide version" }));
    await waitFor(() =>
      expect(calls.unhideRelease).toHaveBeenCalledWith({ projectId: "tactics", version: 2 }),
    );
  });

  it("approves a first-public request through the procedure", async () => {
    queue([], [review()]);
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve public" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve public" }));
    await waitFor(() =>
      expect(calls.approveGamePublic).toHaveBeenCalledWith({ projectId: "kitchen" }),
    );
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
  });

  it("dismisses a flagged release image, which restores its releases", async () => {
    flags([flag()]);
    mount();
    const user = userEvent.setup();
    await screen.findByText("RELEASES HIDDEN");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Dismiss and unhide" }));
    await waitFor(() =>
      expect(calls.resolveImageFlags).toHaveBeenCalledWith({ flagIds: [7], action: "dismiss" }),
    );
  });

  it("toasts a failed action", async () => {
    queue([], [review()]);
    calls.approveGamePublic.mockRejectedValue(new Error("Nope."));
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Approve public" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve public" }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
  });

  it.each([
    ["the flag is off", { flag: false, allowed: true }],
    ["the deployment may not host games", { flag: true, allowed: false }],
  ])("renders nothing and asks nothing when %s", async (_label, state) => {
    gate.flag = state.flag;
    gate.allowed = state.allowed;
    queue([report()], [review()]);
    mount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Game reports")).toBeNull();
    expect(calls.listGameModerationQueue).not.toHaveBeenCalled();
    expect(calls.listImageFlags).not.toHaveBeenCalled();
    expect(calls.listSceneVersionQueue).not.toHaveBeenCalled();
  });

  describe("scene versions", () => {
    it("lists a version with its project, channels, compatibility, reports and block", async () => {
      calls.listSceneVersionQueue.mockResolvedValue([
        sceneVersion({
          blocked: {
            at: now,
            by: "system",
            reason: "5 of 12 players' games failed after this update",
          },
        }),
      ]);
      mount();

      expect(await screen.findByText("level-1@4")).toBeTruthy();
      expect(screen.getByRole("link", { name: "Tactics" }).getAttribute("href")).toBe(
        "/games/tactics",
      );
      expect(screen.getByText("PREVIEW")).toBeTruthy();
      expect(screen.getByText("LIVE")).toBeTruthy();
      expect(screen.getByText(`compat ${"d".repeat(6)}…`)).toBeTruthy();
      expect(screen.getByText("Players' reports: 12 updated fine · 5 failed")).toBeTruthy();
      expect(screen.getByText("BLOCKED")).toBeTruthy();
      expect(screen.getByText(/Blocked automatically/)).toBeTruthy();
      expect(screen.getByText(/5 of 12 players' games failed/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Hide" })).toBeTruthy();
      expect(calls.listSceneVersionQueue).toHaveBeenCalledWith({ includeHidden: false });
    });

    it("hides a version only after asking, with the typed reason", async () => {
      calls.listSceneVersionQueue.mockResolvedValue([sceneVersion()]);
      const nativeConfirm = vi.fn();
      vi.stubGlobal("confirm", nativeConfirm);
      mount();
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Hide" }));
      expect(calls.hideSceneVersion).not.toHaveBeenCalled();
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText("Hide level-1@4?")).toBeTruthy();
      expect(within(dialog).getByText("REASON (REQUIRED)")).toBeTruthy();
      await user.type(within(dialog).getByRole("textbox"), "  slurs written into the level ");
      await user.click(within(dialog).getByRole("button", { name: "Hide scene version" }));

      await waitFor(() =>
        expect(calls.hideSceneVersion).toHaveBeenCalledWith({
          projectId: "tactics",
          scene: "level-1",
          number: 4,
          reason: "slurs written into the level",
        }),
      );
      expect(nativeConfirm).not.toHaveBeenCalled();
      await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    });

    it("can't confirm a hide with an empty or blank reason", async () => {
      calls.listSceneVersionQueue.mockResolvedValue([sceneVersion()]);
      mount();
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Hide" }));
      const dialog = await screen.findByRole("alertdialog");
      const confirm = within(dialog).getByRole("button", { name: "Hide scene version" });
      expect((confirm as HTMLButtonElement).disabled).toBe(true);
      await user.type(within(dialog).getByRole("textbox"), "   ");
      expect((confirm as HTMLButtonElement).disabled).toBe(true);
      await user.click(confirm);
      expect(calls.hideSceneVersion).not.toHaveBeenCalled();
    });

    it("shows a hidden version with Unhide, which asks first", async () => {
      calls.listSceneVersionQueue.mockResolvedValue([
        sceneVersion({ pointers: [], hidden: { at: now, reason: "stolen art" } }),
      ]);
      mount();
      const user = userEvent.setup();

      expect(await screen.findByText("HIDDEN")).toBeTruthy();
      expect(screen.getByText("NO CHANNEL")).toBeTruthy();
      expect(screen.getByText(/stolen art/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Unhide" }));
      expect(calls.unhideSceneVersion).not.toHaveBeenCalled();
      const dialog = await screen.findByRole("alertdialog");
      const confirm = within(dialog).getByRole("button", { name: "Unhide scene version" });
      expect((confirm as HTMLButtonElement).disabled).toBe(true);
      await user.type(within(dialog).getByRole("textbox"), " art was cleared ");
      await user.click(confirm);
      await waitFor(() =>
        expect(calls.unhideSceneVersion).toHaveBeenCalledWith({
          projectId: "tactics",
          scene: "level-1",
          number: 4,
          reason: "art was cleared",
        }),
      );
    });

    it("asks for hidden versions too under With hidden", async () => {
      mount();
      const user = userEvent.setup();
      await screen.findByText("No live scene version needs a look.");
      await user.click(screen.getByRole("button", { name: "With hidden" }));
      await waitFor(() =>
        expect(calls.listSceneVersionQueue).toHaveBeenCalledWith({ includeHidden: true }),
      );
      expect(
        await screen.findByText("No hosted game has published a scene version yet."),
      ).toBeTruthy();
    });

    it("says so when the list can't load, and the rest of the queue still renders", async () => {
      queue([], [review()]);
      calls.listSceneVersionQueue.mockRejectedValue(new Error("Nope."));
      mount(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
      expect(
        await screen.findByText("Scene versions couldn't load. Try again in a moment."),
      ).toBeTruthy();
      expect(screen.getByText("FIRST PUBLIC")).toBeTruthy();
    });

    it("toasts a failed hide", async () => {
      calls.listSceneVersionQueue.mockResolvedValue([sceneVersion()]);
      calls.hideSceneVersion.mockRejectedValue(new Error("Nope."));
      mount();
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Hide" }));
      const dialog = await screen.findByRole("alertdialog");
      await user.type(within(dialog).getByRole("textbox"), "broken");
      await user.click(within(dialog).getByRole("button", { name: "Hide scene version" }));
      await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    });
  });
});
