// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import type { EditorHost } from "@jams/engine/editor-ui";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { activeUserStore, type ActiveUserProfile } from "@/lib/active-user-store";
import { presenceColor } from "@/lib/canvas/presence";
import { toast } from "@/lib/toast";

const fakes = vi.hoisted(() => ({ play: vi.fn(), editor: vi.fn(), navigate: vi.fn() }));

vi.mock("@/lib/sound", async (original) => ({
  ...(await original<typeof import("@/lib/sound")>()),
  play: fakes.play,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => fakes.navigate,
}));
vi.mock("@/components/canvas/shell/SiteMenu", () => ({
  SiteMenu: (props: { back?: { label: string }; signinSource?: string }) => (
    <nav aria-label="Site menu">
      back to {props.back?.label} from {props.signinSource}
    </nav>
  ),
}));
vi.mock("@jams/engine/editor-ui", async (original) => ({
  ...(await original<typeof import("@jams/engine/editor-ui")>()),
  SceneEditor: (props: { host: EditorHost; onReady?: () => void }) => {
    fakes.editor(props);
    return <div className="je-root">{props.host.chrome?.topLeft}</div>;
  },
}));

const {
  DEFAULT_PROJECT,
  fetchProjectNames,
  SITE_PROJECTS,
  siteIdentity,
  SiteSceneEditor,
  useSiteEditorHost,
} = await import("../editor-host");
const { engineEditorGame } = await import("@/games/engine-editor");
const { platformerGame } = await import("@/games/platformer");

type EditorProps = {
  host: EditorHost;
  game: unknown;
  project: string;
  scene: string;
  onReady(): void;
};
const lastEditor = () => fakes.editor.mock.lastCall![0] as EditorProps;

type Navigation = {
  to: string;
  params: { roomId: string };
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
  replace: boolean;
};
const lastNavigation = () => fakes.navigate.mock.lastCall![0] as Navigation;

const profile = (patch: Partial<ActiveUserProfile> = {}): ActiveUserProfile => ({
  discordUsername: "ada",
  discordId: "1",
  avatarUrl: "https://cdn.example.test/ada.png",
  guildNickname: null,
  guildAvatarUrl: null,
  guildRoles: null,
  urlStub: null,
  inGuild: false,
  availableForWork: false,
  isStaff: false,
  isAdmin: false,
  ...patch,
});

const signIn = (p: ActiveUserProfile | null) =>
  act(() => activeUserStore.setState((s) => ({ ...s, profile: p })));

const noServer: Pick<EditorHost, "connect" | "assetUrl"> = {
  connect: () => {
    throw new Error("no server in this test");
  },
  assetUrl: () => "",
};

/** The dev server's routes as these tests answer them; anything else is a 404. */
const PROJECT_LISTING = {
  ok: true,
  projects: [
    { id: "engine", name: "Engine", game: null },
    { id: "platformer", name: "Platformer", game: "platformer" },
  ],
};
function serve(answers: Record<string, unknown>) {
  const fetch = vi.fn(async (url: string) => ({
    ok: url in answers,
    json: async () => answers[url],
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  activeUserStore.setState((s) => ({ ...s, profile: null }));
});

describe("the site's editor host", () => {
  it("notifies with the site's toast, at the top centre clear of the editor's columns", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    const shown = vi.spyOn(toast, "error");
    result.current.notify?.error("Couldn't import", { description: "why", id: "import" });
    expect(shown).toHaveBeenCalledWith("Couldn't import", {
      description: "why",
      id: "import",
      position: "top-center",
    });
    shown.mockRestore();
  });

  it("names the editor after the active user: guild nickname, else Discord username", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    expect(result.current.identity).toBeUndefined();
    signIn(profile());
    expect(result.current.identity).toEqual({
      name: "ada",
      avatarUrl: "https://cdn.example.test/ada.png",
    });
    signIn(
      profile({
        guildNickname: "Ada L.",
        inGuild: true,
        guildAvatarUrl: "https://cdn.example.test/guild.png",
      }),
    );
    expect(result.current.identity).toEqual({
      name: "Ada L.",
      avatarUrl: "https://cdn.example.test/guild.png",
    });
    expect(siteIdentity(profile({ discordUsername: null }))).toBeUndefined();
  });

  it("renders the site menu, the lobby link and the title top left", () => {
    const { result } = renderHook(() =>
      useSiteEditorHost({ title: "test-yard", project: noServer }),
    );
    render(<>{result.current.chrome?.topLeft}</>);
    expect(screen.getByRole("navigation", { name: "Site menu" }).textContent).toBe(
      "back to lobby from game",
    );
    expect(screen.getByRole("heading", { name: "test-yard" })).toBeTruthy();
  });

  it("colours peers as the site's presence does, and sounds cues through the site's palette", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    expect(result.current.peerColor?.("tab-1")).toBe(presenceColor("tab-1").color);
    result.current.cue?.("press");
    result.current.cue?.("tab");
    result.current.cue?.("error");
    expect(fakes.play.mock.calls.map(([name]) => name)).toEqual(["press", "page", "error"]);
  });

  it("answers flags from the site's flag store, off for names it doesn't know", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    expect(result.current.flag?.("engine-projects")).toBe(false);
    expect(result.current.flag?.("no-such-flag")).toBe(false);
  });

  it("leaves per-viewer storage to the package's guarded localStorage", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    expect(result.current.storage).toBeUndefined();
  });

  it("calls the latest onSceneChange through a host that stays the same", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onSceneChange }) => useSiteEditorHost({ title: "room", project: noServer, onSceneChange }),
      { initialProps: { onSceneChange: first } },
    );
    const host = result.current;
    rerender({ onSceneChange: second });
    expect(result.current).toBe(host);
    host.onSceneChange?.("engine-yard");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("engine-yard");
  });
});

describe("SiteSceneEditor", () => {
  const projectFile = (path: string) =>
    JSON.parse(readFileSync(path, "utf8")) as { id: string; name: string };

  it("offers the projects whose jams.project.json the site knows, each with the game it edits with", () => {
    const platformer = projectFile("src/games/platformer/jams.project.json");
    const engine = projectFile("src/engine/scenes/jams.project.json");
    expect(SITE_PROJECTS.map(({ id }) => id)).toEqual([platformer.id, engine.id]);
    expect(DEFAULT_PROJECT).toBe(platformer.id);
    expect(SITE_PROJECTS.map((p) => [p.game, p.defaultScene])).toEqual([
      [platformerGame, "test-yard"],
      [engineEditorGame, "kitchen-sink"],
    ]);
  });

  it("opens the platformer project on the dev server, titled by the room until the editor is up", () => {
    render(<SiteSceneEditor roomId="lobby-1" />);
    const props = lastEditor();
    expect(props).toMatchObject({ project: DEFAULT_PROJECT, scene: "test-yard" });
    expect(props.game).toBe(platformerGame);
    expect(
      props.host.assetUrl("platformer", {
        id: "a",
        kind: "texture",
        sha256: "ab".repeat(32),
        bytes: 1,
      }),
    ).toBe(`/__project/platformer/blob/${"ab".repeat(32)}`);
    expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();
    act(() => props.onReady());
    expect(screen.getByRole("heading", { name: "test-yard" })).toBeTruthy();
  });

  it("follows the scene the editor opened instead in the room's ?scene=, replacing the entry", () => {
    render(<SiteSceneEditor roomId="lobby-1" scene="kitchen-sink" />);
    const props = lastEditor();
    props.host.onSceneChange?.("test-yard");
    expect(fakes.navigate).toHaveBeenCalledTimes(1);
    const to = lastNavigation();
    expect(to).toMatchObject({ to: "/game/$roomId", params: { roomId: "lobby-1" }, replace: true });
    expect(to.search({ edit: 1, scene: "kitchen-sink" })).toEqual({ edit: 1, scene: "test-yard" });
  });

  it("opens the engine project from ?project=engine, its scenes by name or id", () => {
    const { rerender } = render(<SiteSceneEditor roomId="lobby-1" project="engine" />);
    expect(lastEditor()).toMatchObject({ project: "engine", scene: "kitchen-sink" });
    expect(lastEditor().game).toBe(engineEditorGame);
    for (const scene of ["grid-yard", "engine-yard", "kitchen-sink", "7c1d2e3f"]) {
      rerender(<SiteSceneEditor roomId="lobby-1" project="engine" scene={scene} />);
      expect(lastEditor()).toMatchObject({ project: "engine", scene });
    }
  });

  it("names the projects as the dev server's listing does, so the project files are the one source", async () => {
    serve({
      "/__project": {
        ok: true,
        projects: [
          { id: "engine", name: "Engine Room", game: null },
          { id: "platformer", name: "Platformer", game: "platformer" },
        ],
      },
    });
    render(<SiteSceneEditor roomId="lobby-1" />);
    expect(lastEditor().host.projects).toEqual([
      { id: "platformer", name: "platformer" },
      { id: "engine", name: "engine" },
    ]);
    await waitFor(() =>
      expect(lastEditor().host.projects).toEqual([
        { id: "platformer", name: "Platformer" },
        { id: "engine", name: "Engine Room" },
      ]),
    );
  });

  it("reads no names from a listing it can't use", async () => {
    expect(await fetchProjectNames(async () => ({ ok: false, json: async () => null }))).toEqual(
      {},
    );
    expect(
      await fetchProjectNames(async () => {
        throw new Error("offline");
      }),
    ).toEqual({});
    expect(
      await fetchProjectNames(async () => ({
        ok: true,
        json: async () => ({ projects: [{ id: "a", name: "A" }, { id: 3 }, null] }),
      })),
    ).toEqual({ a: "A" });
  });

  it("hands the editor its projects, and opens a pick as a new history entry", async () => {
    serve({ "/__project": PROJECT_LISTING });
    render(<SiteSceneEditor roomId="lobby-1" scene="test-yard" />);
    await waitFor(() =>
      expect(lastEditor().host.projects).toEqual([
        { id: "platformer", name: "Platformer" },
        { id: "engine", name: "Engine" },
      ]),
    );
    const { host } = lastEditor();
    host.onProjectChange?.("engine");
    expect(lastNavigation()).toMatchObject({ params: { roomId: "lobby-1" }, replace: false });
    expect(lastNavigation().search({ edit: 1, scene: "test-yard" })).toEqual({
      edit: 1,
      project: "engine",
    });
    host.onProjectChange?.("platformer");
    expect(lastNavigation().search({ edit: 1, project: "engine", scene: "grid-yard" })).toEqual({
      edit: 1,
    });
  });

  it("opens the scene the fallback notice points to in its own project", () => {
    render(<SiteSceneEditor roomId="lobby-1" scene="test-yard" />);
    lastEditor().host.onProjectChange?.("engine", { scene: "grid-yard" });
    expect(lastNavigation().replace).toBe(false);
    expect(lastNavigation().search({ edit: 1, scene: "test-yard" })).toEqual({
      edit: 1,
      project: "engine",
      scene: "grid-yard",
    });
  });

  it("passes the notice's action to the site's toast", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }));
    const shown = vi.spyOn(toast, "warning");
    const onClick = vi.fn();
    result.current.notify?.warning("There's no scene", {
      id: "scene-fallback",
      action: { label: "Open in Engine", onClick },
    });
    expect(shown).toHaveBeenCalledWith("There's no scene", {
      id: "scene-fallback",
      action: { label: "Open in Engine", onClick },
      position: "top-center",
    });
    shown.mockRestore();
  });

  it("remounts the editor on another project, so its session and game start over", () => {
    const { rerender } = render(<SiteSceneEditor roomId="lobby-1" />);
    const first = lastEditor().host;
    rerender(<SiteSceneEditor roomId="lobby-1" project="engine" />);
    expect(lastEditor().host).not.toBe(first);
    expect(lastEditor().project).toBe("engine");
  });

  it("says a project the site doesn't know, opens the platformer, and drops it from the route", async () => {
    serve({ "/__project": PROJECT_LISTING });
    const warning = vi.spyOn(toast, "warning");
    render(<SiteSceneEditor roomId="lobby-1" project="nowhere" scene="grid-yard" />);
    expect(lastEditor()).toMatchObject({ project: "platformer", scene: "test-yard" });
    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(warning).toHaveBeenCalledWith(`There's no project "nowhere" here`, {
      id: "project-fallback",
      description: "Platformer opened instead.",
      position: "top-center",
    });
    expect(lastNavigation().replace).toBe(true);
    expect(lastNavigation().search({ edit: 1, project: "nowhere", scene: "grid-yard" })).toEqual({
      edit: 1,
      scene: "grid-yard",
    });
    warning.mockRestore();
  });

  it("asks the dev server which project holds a scene the open one lacks, by its names", async () => {
    serve({
      "/__scene": { ok: true, scenes: ["kitchen-sink", "test-yard"] },
      "/__scene/kitchen-sink": { v: 3, name: "kitchen-sink" },
      "/__scene/test-yard": { v: 3, game: "platformer", name: "test-yard" },
      "/__project": PROJECT_LISTING,
    });
    render(<SiteSceneEditor roomId="lobby-1" scene="kitchen-sink" />);
    const home = await lastEditor().host.findScene?.("kitchen-sink");
    expect(home).toEqual({ project: "engine", id: "kitchen-sink", name: "kitchen-sink" });
    await waitFor(() =>
      expect(lastEditor().host.projects?.find((p) => p.id === home?.project)?.name).toBe("Engine"),
    );
  });

  it("calls the onSceneChange it was given instead of navigating", () => {
    const onSceneChange = vi.fn();
    render(<SiteSceneEditor roomId="lobby-1" onSceneChange={onSceneChange} />);
    const props = lastEditor();
    props.host.onSceneChange?.("engine-yard");
    expect(onSceneChange).toHaveBeenCalledWith("engine-yard");
    expect(fakes.navigate).not.toHaveBeenCalled();
  });
});
