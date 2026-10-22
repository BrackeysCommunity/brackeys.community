// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ProfileCanvasesSection } from "@/components/profile/ProfilePage/ProfileCanvases";

import { TeamPublicCanvases } from "../TeamCanvasesSection";

const state = vi.hoisted(() => ({
  listPublicCanvases: vi.fn(),
  flag: true,
}));

vi.mock("@/orpc/client", () => {
  const procedure = (name: string) => ({
    key: () => [name],
    queryOptions: ({ input }: { input: unknown }) => ({
      queryKey: [name, input],
      queryFn: () =>
        name === "listPublicCanvases" ? state.listPublicCanvases(input) : Promise.resolve(null),
    }),
  });
  return { client: {}, orpc: new Proxy({}, { get: (_t, name: string) => procedure(name) }) };
});
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children?: React.ReactNode; params?: { canvasId?: string } }) => (
    <a href={`/canvases/${params?.canvasId ?? ""}`}>{children}</a>
  ),
}));
vi.mock("@/lib/hooks/use-flag", () => ({ useFlag: () => state.flag }));
vi.mock("../CanvasThumbnail", () => ({ CanvasThumbnail: () => <div data-testid="thumb" /> }));
vi.mock("../NewCanvasDialog", () => ({ NewCanvasDialog: () => null }));

const items = [
  {
    id: "c1",
    path: "Ideas.canvas",
    title: "Ideas",
    nodeCount: 2,
    updatedAt: new Date(),
    thumbnail: null,
  },
  {
    id: "c2",
    path: "Map.canvas",
    title: "Map",
    nodeCount: 1,
    updatedAt: new Date(),
    thumbnail: null,
  },
];

afterEach(() => {
  cleanup();
  state.listPublicCanvases.mockReset();
  state.flag = true;
});

function mount(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
}

describe("profile Canvases section", () => {
  it("lists the member's public canvases, asking by owner", async () => {
    state.listPublicCanvases.mockResolvedValue(items);
    mount(<ProfileCanvasesSection index="07" profileId="alice" />);
    expect(await screen.findByText("Ideas")).toBeTruthy();
    expect(screen.getByText("Map")).toBeTruthy();
    expect(screen.getByText(/CANVASES/)).toBeTruthy();
    expect(state.listPublicCanvases).toHaveBeenCalledWith({ ownerId: "alice" });
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/canvases/c1",
      "/canvases/c2",
    ]);
  });

  it("renders nothing when there are none", async () => {
    state.listPublicCanvases.mockResolvedValue([]);
    const { container } = mount(<ProfileCanvasesSection index="07" profileId="alice" />);
    await waitFor(() => expect(state.listPublicCanvases).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("renders nothing, and asks nothing, with canvases off", async () => {
    state.flag = false;
    const { container } = mount(<ProfileCanvasesSection index="07" profileId="alice" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.textContent).toBe("");
    expect(state.listPublicCanvases).not.toHaveBeenCalled();
  });
});

describe("team page public canvases", () => {
  const wrap = (content: React.ReactNode) => (
    <section>
      <h2>CANVASES</h2>
      {content}
    </section>
  );

  it("lists the team's public canvases inside the section chrome", async () => {
    state.listPublicCanvases.mockResolvedValue(items.slice(0, 1));
    mount(<TeamPublicCanvases teamId="t1" wrap={wrap} />);
    expect(await screen.findByText("Ideas")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "CANVASES" })).toBeTruthy();
    expect(state.listPublicCanvases).toHaveBeenCalledWith({ teamId: "t1" });
  });

  it("renders no section at all when the team has none", async () => {
    state.listPublicCanvases.mockResolvedValue([]);
    const { container } = mount(<TeamPublicCanvases teamId="t1" wrap={wrap} />);
    await waitFor(() => expect(state.listPublicCanvases).toHaveBeenCalled());
    expect(container.querySelector("section")).toBeNull();
  });

  it("renders no section when the list fails", async () => {
    state.listPublicCanvases.mockRejectedValue(new Error("NOT_FOUND"));
    const { container } = mount(<TeamPublicCanvases teamId="t1" wrap={wrap} />);
    await waitFor(() => expect(state.listPublicCanvases).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector("section")).toBeNull();
  });
});
