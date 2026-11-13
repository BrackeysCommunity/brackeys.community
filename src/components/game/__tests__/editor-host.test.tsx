// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { EditorHost, SceneEditorHandle } from "@jams/engine/editor-ui";
import { createRegistry, type GameDefinition } from "@jams/engine/game";
import { createKindRegistry, type KindRegistry } from "@jams/engine/project";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { activeUserStore, type ActiveUserProfile } from "@/lib/active-user-store";
import { presenceColor } from "@/lib/canvas/presence";
import { FEATURE_FLAGS, type FeatureFlagValues } from "@/lib/flags";
import { ServerFlagsContext } from "@/lib/hooks/use-flag";
import { toast } from "@/lib/toast";

const fakes = vi.hoisted(() => ({
  play: vi.fn(),
  editor: vi.fn(),
  navigate: vi.fn(),
  createAgentToken: vi.fn(),
  getGameSettings: vi.fn(),
  /** The fake editor's panels as its frame has them laid out. */
  laidOut: new Set<string>(),
}));

vi.mock("@/orpc/client", () => ({
  client: { createAgentToken: fakes.createAgentToken, getGameSettings: fakes.getGameSettings },
}));

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
vi.mock("@jams/engine/editor-ui", async (original) => {
  const { useEffect, useState } = await import("react");
  return {
    ...(await original<typeof import("@jams/engine/editor-ui")>()),
    SceneEditor: (props: { host: EditorHost; onReady?: () => void }) => {
      fakes.editor(props);
      // As the frame does: a panel the host brings late is laid out a commit later.
      const publish = props.host.publish !== undefined;
      const [laidOut, setLaidOut] = useState(false);
      useEffect(() => setLaidOut(publish), [publish]);
      useEffect(() => {
        if (laidOut) fakes.laidOut.add("publish");
        else fakes.laidOut.delete("publish");
      }, [laidOut]);
      return <div className="je-root">{props.host.chrome?.topLeft}</div>;
    },
  };
});

const {
  DEFAULT_PROJECT,
  fetchProjectNames,
  projectChoices,
  SITE_PROJECTS,
  siteIdentity,
  SiteSceneEditor,
  useHostedGame,
  useSiteEditorHost,
} = await import("../editor-host");
const { hostedGame, hostedGames } = await import("../hosted-games");
const { platformerGame } = await import("@/games/platformer");
const { discoverProjects } = await import("../../../../scripts/scene/projects");

type EditorProps = {
  host: EditorHost;
  game: unknown;
  project: string;
  scene: string;
  ui: unknown;
  onReady(handle?: SceneEditorHandle): void;
};
const lastEditor = () => fakes.editor.mock.lastCall![0] as EditorProps;
/** The editor's props once the project's game has loaded and it rendered for `project`. */
async function editorUp(project?: string): Promise<EditorProps> {
  await waitFor(() => {
    expect(fakes.editor).toHaveBeenCalled();
    if (project) expect(lastEditor().project).toBe(project);
  });
  return lastEditor();
}

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
    { id: "stress", name: "Stress", game: "stress" },
    { id: "tactics", name: "Tactics", game: "tactics" },
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

describe("the site's publish host in the editor", () => {
  const withFlags =
    (patch: Partial<FeatureFlagValues>) =>
    ({ children }: { children: React.ReactNode }) => (
      <ServerFlagsContext value={{ ...FEATURE_FLAGS, ...patch }}>{children}</ServerFlagsContext>
    );
  const gamesOn = withFlags({ "engine-games-enabled": true });

  it("has no publish host for the file-backed dev editor", () => {
    const { result } = renderHook(() => useSiteEditorHost({ title: "room", project: noServer }), {
      wrapper: gamesOn,
    });
    expect(result.current.publish).toBeUndefined();
  });

  it("has none for a hosted project while engine-games-enabled is off", () => {
    const { result } = renderHook(
      () => useSiteEditorHost({ title: "room", project: noServer, hosted: { project: "demo" } }),
      { wrapper: withFlags({}) },
    );
    expect(result.current.publish).toBeUndefined();
  });

  it("publishes a hosted project with the site's wording, and opens the token dialog", async () => {
    const { result } = renderHook(
      () =>
        useSiteEditorHost({
          title: "room",
          project: noServer,
          hosted: { project: "demo", team: "Bit Bakers" },
        }),
      { wrapper: gamesOn },
    );
    const publish = result.current.publish!;
    expect(publish.project).toBe("demo");
    expect(publish.wording.command).toBe("vp run scene game release create demo");
    expect(publish.wording.visibility.team).toBe("Team: everyone on Bit Bakers can play.");

    render(<>{result.current.chrome?.topLeft}</>);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => publish.openTokenDialog());
    expect((await screen.findByRole("dialog")).textContent).toContain("Agent token for demo");
    fakes.createAgentToken.mockResolvedValue({ id: "t1", secret: "jat_secret" });
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    const secret = await screen.findByRole<HTMLInputElement>("textbox", { name: "Agent token" });
    expect(secret.value).toBe("jat_secret");
    expect(fakes.createAgentToken).toHaveBeenCalledWith({
      projectId: "demo",
      access: "write",
      label: "Releases from the editor",
      ttlHours: 24,
    });
  });
});

describe("useHostedGame", () => {
  const withFlags =
    (patch: Partial<FeatureFlagValues>) =>
    ({ children }: { children: React.ReactNode }) => (
      <ServerFlagsContext value={{ ...FEATURE_FLAGS, ...patch }}>{children}</ServerFlagsContext>
    );

  it("names the open project hosted once the site answers for its settings", async () => {
    const read = vi.fn(async () => ({}));
    const { result } = renderHook(() => useHostedGame("demo", read), {
      wrapper: withFlags({ "engine-games-enabled": true }),
    });
    await waitFor(() => expect(result.current).toEqual({ project: "demo", team: null }));
    expect(read).toHaveBeenCalledWith("demo");
  });

  it("carries the team that owns the project, so the Publish panel offers Team", async () => {
    const read = vi.fn(async () => ({ team: "Night Owls" }));
    const { result } = renderHook(() => useHostedGame("demo", read), {
      wrapper: withFlags({ "engine-games-enabled": true }),
    });
    await waitFor(() => expect(result.current).toEqual({ project: "demo", team: "Night Owls" }));
  });

  it("leaves a project the site refuses or doesn't host unpublished", async () => {
    const read = vi.fn(async () => {
      throw new Error('There is no hosted project "demo".');
    });
    const { result } = renderHook(() => useHostedGame("demo", read), {
      wrapper: withFlags({ "engine-games-enabled": true }),
    });
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it("asks nothing while engine-games-enabled is off", () => {
    const read = vi.fn(async () => ({}));
    const { result } = renderHook(() => useHostedGame("demo", read), { wrapper: withFlags({}) });
    expect(read).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });
});

describe("SiteSceneEditor", () => {
  // The first load transforms each hosted game's UI, scenes, prefabs and docs; pay it once
  // here rather than inside whichever test loads a project first.
  beforeAll(() => Promise.all(SITE_PROJECTS.map((p) => p.load())), 30_000);

  const projectFile = (path: string) =>
    JSON.parse(readFileSync(path, "utf8")) as { id: string; name: string };

  it("offers the hosted games' projects, then the engine's, each with the game its file names", async () => {
    const platformer = projectFile("src/games/platformer/jams.project.json");
    const engine = projectFile("packages/engine/scenes/jams.project.json");
    const hosted = hostedGames().map((g) => g.id);
    expect(hosted).toContain(platformer.id);
    expect(SITE_PROJECTS.map(({ id }) => id)).toEqual([...hosted, engine.id]);
    expect(DEFAULT_PROJECT).toBe(platformer.id);
    const opened = await Promise.all(SITE_PROJECTS.map((p) => p.load()));
    expect(opened[hosted.indexOf(platformer.id)]).toEqual({
      game: platformerGame,
      ui: null,
      defaultScene: "test-yard",
    });
    // The engine project opens its scene list's start, as a hosted game's does.
    const engineList = JSON.parse(
      readFileSync("packages/engine/scenes/scene-list.json", "utf8"),
    ) as {
      start: string;
    };
    expect(engineList.start).toBe("engine-yard");
    expect(opened.at(-1)).toEqual({ game: null, ui: null, defaultScene: engineList.start });
  });

  it("shows the editor's loading frame while the project's game loads", () => {
    render(<SiteSceneEditor roomId="lobby-1" />);
    expect(fakes.editor).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();
  });

  it("says the project failed to load in place of the loading frame, and retries", async () => {
    const hosted = hostedGame("platformer")!;
    const load = vi.spyOn(hosted, "load").mockRejectedValueOnce(new Error("chunk gone"));
    try {
      render(<SiteSceneEditor roomId="lobby-1" />);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain('The project "platformer" couldn\'t load');
      expect(alert.textContent).toContain("chunk gone");
      expect(screen.getByRole("heading", { name: "lobby-1" })).toBeTruthy();
      expect(fakes.editor).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect((await editorUp("platformer")).project).toBe("platformer");
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      load.mockRestore();
    }
  });

  it("hands the editor the hosted game's UI for its Play canvas", async () => {
    const mountHud = () => ({ destroy() {} });
    const hosted = hostedGame("platformer")!;
    const modules = await hosted.load();
    const load = vi.spyOn(hosted, "load").mockResolvedValue({ ...modules, ui: mountHud });
    try {
      render(<SiteSceneEditor roomId="lobby-1" />);
      expect((await editorUp()).ui).toBe(mountHud);
    } finally {
      load.mockRestore();
    }
  });

  it("opens the platformer project on the dev server, titled by the room until the editor is up", async () => {
    render(<SiteSceneEditor roomId="lobby-1" />);
    const props = await editorUp();
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

  describe("?panel=publish", () => {
    const gamesOn = ({ children }: { children: React.ReactNode }) => (
      <ServerFlagsContext value={{ ...FEATURE_FLAGS, "engine-games-enabled": true }}>
        {children}
      </ServerFlagsContext>
    );
    /** The editor's handle, its `openPanel` taking only a panel the frame has laid out. */
    const handle = () => {
      const opened: string[] = [];
      const openPanel = vi.fn((id: string) => {
        if (fakes.laidOut.has(id)) opened.push(id);
      });
      return { opened, openPanel, resetLayout: vi.fn(), game: () => null };
    };

    it("opens the Publish panel once the editor is up and the site says the viewer publishes, then drops it", async () => {
      let answer!: (settings: { team: string | null }) => void;
      fakes.getGameSettings.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      render(<SiteSceneEditor roomId="dev" project="engine" panel="publish" />, {
        wrapper: gamesOn,
      });
      const editor = handle();
      const props = await editorUp("engine");
      act(() => props.onReady(editor));
      expect(lastEditor().host.publish).toBeUndefined();
      expect(editor.openPanel).not.toHaveBeenCalled();

      await act(async () => answer({ team: null }));
      await waitFor(() => expect(editor.openPanel).toHaveBeenCalled());
      expect(lastEditor().host.publish?.project).toBe("engine");
      expect(editor.openPanel).toHaveBeenCalledTimes(1);
      expect(editor.opened).toEqual(["publish"]);
      const to = lastNavigation();
      expect(to.replace).toBe(true);
      expect(
        to.search({ edit: 1, project: "engine", scene: "kitchen-sink", panel: "publish" }),
      ).toEqual({ edit: 1, project: "engine", scene: "kitchen-sink" });
    });

    it("leaves the panels alone while the viewer can't publish", async () => {
      render(<SiteSceneEditor roomId="dev" project="engine" panel="publish" />);
      const editor = handle();
      const props = await editorUp("engine");
      act(() => props.onReady(editor));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(editor.openPanel).not.toHaveBeenCalled();
      expect(fakes.getGameSettings).not.toHaveBeenCalled();
    });
  });

  it("follows the scene the editor opened instead in the room's ?scene=, replacing the entry", async () => {
    render(<SiteSceneEditor roomId="lobby-1" scene="kitchen-sink" />);
    const props = await editorUp();
    props.host.onSceneChange?.("test-yard");
    expect(fakes.navigate).toHaveBeenCalledTimes(1);
    const to = lastNavigation();
    expect(to).toMatchObject({ to: "/game/$roomId", params: { roomId: "lobby-1" }, replace: true });
    expect(to.search({ edit: 1, scene: "kitchen-sink" })).toEqual({ edit: 1, scene: "test-yard" });
  });

  it("opens the engine project from ?project=engine, its scenes by name or id", async () => {
    const { rerender } = render(<SiteSceneEditor roomId="lobby-1" project="engine" />);
    expect(await editorUp()).toMatchObject({ project: "engine", scene: "engine-yard" });
    expect(lastEditor().game).toBeNull();
    expect(lastEditor().host.readOnly).toBeUndefined();
    for (const scene of ["grid-yard", "engine-yard", "kitchen-sink", "7c1d2e3f"]) {
      rerender(<SiteSceneEditor roomId="lobby-1" project="engine" scene={scene} />);
      expect(lastEditor()).toMatchObject({ project: "engine", scene });
    }
  });

  it("judges each project as the dev server does, so its scenes open editable", async () => {
    // Code skew compares these hashes: a page whose differ from the server's opens read-only.
    const hashes = (kinds: KindRegistry, game: GameDefinition | null) =>
      kinds.schemaHashes({ registry: createRegistry(game), project: null });
    const cache = await mkdtemp(join(tmpdir(), "site-projects-"));
    try {
      const served = await discoverProjects(
        process.cwd(),
        [
          "src/games/platformer/jams.project.json",
          "src/games/stress/jams.project.json",
          "src/games/tactics/jams.project.json",
          "packages/engine/scenes/jams.project.json",
        ],
        { cacheDirOf: (id) => join(cache, id) },
      );
      for (const project of SITE_PROJECTS) {
        const server = served.find((p) => p.file.id === project.id)!;
        expect(server, project.id).toBeDefined();
        const { game } = await project.load();
        expect(game, project.id).toBe(server.game);
        expect(createRegistry(game).id).toBe(server.registry.id);
        expect(await hashes(createKindRegistry(game), game)).toEqual(
          await hashes(server.kinds, server.game),
        );
      }
      expect(served.find((p) => p.file.id === "engine")?.game).toBeNull();
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  }, 30_000);

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
    // Each project goes by its id until the listing answers.
    expect(projectChoices({})).toEqual([
      { id: "platformer", name: "platformer" },
      { id: "stress", name: "stress" },
      { id: "tactics", name: "tactics" },
      { id: "engine", name: "engine" },
    ]);
    render(<SiteSceneEditor roomId="lobby-1" />);
    await waitFor(() =>
      expect(lastEditor().host.projects).toEqual([
        { id: "platformer", name: "Platformer" },
        { id: "stress", name: "stress" },
        { id: "tactics", name: "tactics" },
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
        { id: "stress", name: "Stress" },
        { id: "tactics", name: "Tactics" },
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
    expect(lastNavigation().search({ edit: 1, game: "tactics" })).toEqual({ edit: 1 });
  });

  it("opens the scene the fallback notice points to in its own project", async () => {
    render(<SiteSceneEditor roomId="lobby-1" scene="test-yard" />);
    (await editorUp()).host.onProjectChange?.("engine", { scene: "grid-yard" });
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

  it("remounts the editor on another project, so its session and game start over", async () => {
    const { rerender } = render(<SiteSceneEditor roomId="lobby-1" />);
    const first = (await editorUp()).host;
    rerender(<SiteSceneEditor roomId="lobby-1" project="engine" />);
    expect((await editorUp("engine")).host).not.toBe(first);
    expect(lastEditor().project).toBe("engine");
  });

  it("says a project the site doesn't know, opens the platformer, and drops it from the route", async () => {
    serve({ "/__project": PROJECT_LISTING });
    const warning = vi.spyOn(toast, "warning");
    render(<SiteSceneEditor roomId="lobby-1" project="nowhere" scene="grid-yard" />);
    expect(await editorUp()).toMatchObject({ project: "platformer", scene: "test-yard" });
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
    const home = await (await editorUp()).host.findScene?.("kitchen-sink");
    expect(home).toEqual({ project: "engine", id: "kitchen-sink", name: "kitchen-sink" });
    await waitFor(() =>
      expect(lastEditor().host.projects?.find((p) => p.id === home?.project)?.name).toBe("Engine"),
    );
  });

  it("calls the onSceneChange it was given instead of navigating", async () => {
    const onSceneChange = vi.fn();
    render(<SiteSceneEditor roomId="lobby-1" onSceneChange={onSceneChange} />);
    const props = await editorUp();
    props.host.onSceneChange?.("engine-yard");
    expect(onSceneChange).toHaveBeenCalledWith("engine-yard");
    expect(fakes.navigate).not.toHaveBeenCalled();
  });
});
