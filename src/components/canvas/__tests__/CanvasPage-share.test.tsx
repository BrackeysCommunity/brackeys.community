// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { CanvasDetail } from "../canvas-queries";
import { CanvasPage } from "../CanvasPage";

const current = vi.hoisted(() => ({ detail: null as unknown, mobile: false }));

vi.mock("../canvas-queries", () => ({
  canvasQueryOptions: (id: string) => ({
    queryKey: ["getCanvas", id],
    queryFn: () => current.detail,
  }),
  canvasScopesQueryOptions: () => ({ queryKey: ["scopes"], queryFn: () => ({ teams: [] }) }),
  useRestoreCanvas: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("@tanstack/react-router", () => ({ useBlocker: () => {} }));
vi.mock("@/lib/hooks/use-mobile", () => ({ useIsMobile: () => current.mobile }));
vi.mock("@/components/layout/ShellBoundary", () => ({
  ShellBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../CanvasSnapshotView", () => ({
  CanvasSnapshotView: () => <div data-testid="snapshot" />,
  snapshotCards: () => [],
}));
vi.mock("../OutlinePanel", () => ({ OutlinePanel: () => null }));
vi.mock("../shell/DocumentIsland", () => ({ DocumentIsland: () => null }));
vi.mock("../shell/SharePopover", () => ({
  SharePopover: ({ teamName }: { teamName: string }) => (
    <button type="button" data-testid="share">
      Share {teamName}
    </button>
  ),
}));
/** The editor gets the same toggles as the reader through `chrome`. */
vi.mock("../editor/CanvasEditor", () => ({
  default: ({ chrome }: { chrome: { toggles: React.ReactNode } }) => (
    <div data-testid="editor">{chrome.toggles}</div>
  ),
}));

function detail(patch: Partial<CanvasDetail>): CanvasDetail {
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
    access: "read",
    canModerate: false,
    memberRole: null,
    isMember: false,
    canShare: false,
    canReport: false,
    snapshot: { nodes: [], edges: [] },
    state: null,
    attachments: {},
    ...patch,
  } as CanvasDetail;
}

afterEach(() => {
  cleanup();
  current.mobile = false;
});

async function mount(patch: Partial<CanvasDetail>) {
  current.detail = detail(patch);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CanvasPage canvasId="c1" />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Outline");
}

describe("the Share island", () => {
  it("is in the editor's chrome for an owner who can edit", async () => {
    await mount({ access: "owner", canShare: true, state: "AA==" });
    const editor = await screen.findByTestId("editor");
    expect(editor.querySelector("[data-testid=share]")).not.toBeNull();
  });

  it("is in the reader for a viewer member", async () => {
    await mount({ access: "read", isMember: true, memberRole: "viewer" });
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.getByTestId("share")).toBeTruthy();
  });

  it("is in the reader for an owner on a phone", async () => {
    current.mobile = true;
    await mount({ access: "owner", canShare: true, state: "AA==" });
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.getByTestId("share")).toBeTruthy();
  });

  it("is in the editor for a team member who can edit, even without canShare", async () => {
    await mount({ access: "write", scope: { kind: "team", teamId: "t1" }, state: "AA==" });
    const editor = await screen.findByTestId("editor");
    expect(editor.querySelector("[data-testid=share]")).not.toBeNull();
  });

  it("is absent for a stranger reading a public canvas, and for a hidden canvas's owner", async () => {
    await mount({ access: "read", visibility: "public", canReport: true });
    expect(screen.queryByTestId("share")).toBeNull();
    cleanup();
    await mount({ access: "read", hidden: true, hiddenReason: "x", canShare: false });
    expect(screen.queryByTestId("share")).toBeNull();
  });
});
