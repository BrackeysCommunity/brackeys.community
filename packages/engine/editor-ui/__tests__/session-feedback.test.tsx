// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  ASSET_CHANGED,
  createProjectSession,
  layoutPatch,
  layoutToDoc,
  memoryDocHost,
  prefabToDoc,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  writeEntry,
  type AssetChangedMessage,
  type SessionPrefabSource,
} from "../../collab/index";
import { createRegistry, defineGame } from "../../game/index";
import type { GameInstance } from "../../index";
import {
  createKindRegistry,
  materialKind,
  prefabKind,
  sceneKind,
  type AssetEntry,
  type DocLayout,
} from "../../project/index";
import { SCENE_FORMAT_VERSION, type Prefab, type SceneDefinition } from "../../scene/index";
import { EditorFrame, editorChrome } from "../frame/EditorFrame";
import type { EditorHost, EditorNotify, ProjectConnection, ProjectConnectionState } from "../host";
import { createPending, type Pending } from "../pending/pending";
import { PendingProvider } from "../pending/use-pending";
import { OPEN_TIMEOUT_MS, SceneEditor } from "../SceneEditor";
import {
  editorIdentity,
  openLiveEditor,
  openPrefabScope,
  prefabsReady,
  projectRegistry,
  type LiveEditor,
} from "../session/live-scene-editor";
import { useStoreValue } from "../session/use-store-value";
import { fakeWorldGame } from "./fake-world-game";

// jsdom has no WebGL, so the Pixi application is a stand-in; the containers are real.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

type Gate = { promise: Promise<void>; open: () => void; fail: (error: Error) => void };

function gate(): Gate {
  let open!: () => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

const games = vi.hoisted(() => ({
  made: [] as { destroyed: boolean }[],
  /** Holds every `createGame` until it opens. */
  gate: null as Promise<void> | null,
}));

vi.mock("../../index", async (importOriginal) => {
  const engine = await importOriginal<typeof import("../../index")>();
  return {
    ...engine,
    createGame: async (...args: Parameters<typeof engine.createGame>) => {
      if (games.gate) await games.gate;
      const game: GameInstance = await engine.createGame(...args);
      const made = { destroyed: false };
      games.made.push(made);
      const destroy = game.destroy;
      game.destroy = () => {
        made.destroyed = true;
        destroy();
      };
      return game;
    },
  };
});

const notify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
}) as unknown as EditorNotify & {
  error: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
};

const rapier = () => import("@dimforge/rapier2d");

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  games.made.length = 0;
  games.gate = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ─── A project on a server whose docs can be held back ───

const yardGame = defineGame({
  id: "session-feedback",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});
const yardKinds = createKindRegistry(yardGame);
const materialLayout = materialKind.layout as DocLayout;

const BOUNCY = {
  kind: "material",
  v: 1,
  description: "Bouncy rubber.",
  physics: { friction: 0.4, restitution: 0.9 },
};

const YARD: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "yard",
  bounds: [0, 0, 2000, 1200],
  entities: [
    { id: "ledge", type: "solid", shape: ["box", 820, 900, 80, 10], material: "bouncy" },
    { id: "pad", type: "marker", at: [1000, 1010] },
  ],
} as SceneDefinition;

const entry = (key: string, kind: string, path: string): AssetEntry => ({
  key,
  id: key,
  kind,
  path,
  created: { at: 0, by: "seed" },
});

/**
 * The yard and its material on a memory server, and a host whose `connect`
 * opens them. `held` docs (and the connection itself, under `"connect"`)
 * wait for their gate.
 */
function gatedProject(held: Partial<Record<string, Gate>> = {}) {
  const server = memoryDocHost();
  seedProjectDoc(
    server.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {
        yard: entry("yard", "scene", "scenes/yard.json"),
        bouncy: entry("bouncy", "material", "materials/bouncy.json"),
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(YARD, { doc: server.doc("scene:p.yard"), key: sequentialKeys("yard") });
  layoutToDoc(server.doc("asset:p.bouncy"), materialLayout, BOUNCY);

  const connect: EditorHost["connect"] = ({ project, registry, origin }) => {
    let state: ProjectConnectionState = {
      status: "connecting",
      session: null,
      access: "write",
      stopped: {},
      error: null,
      unsynced: 0,
    };
    const listeners = new Set<() => void>();
    const client = server.client();
    let gone = false;
    void (held.connect?.promise ?? Promise.resolve())
      .then(() =>
        createProjectSession({
          project,
          openDoc: async (name) => {
            await held[name]?.promise;
            return client.openDoc(name);
          },
          origin,
          registry,
          kinds: yardKinds,
        }),
      )
      .then((session) => {
        if (gone) return session.destroy();
        state = { ...state, status: "live", session };
        for (const l of listeners) l();
      });
    const connection: ProjectConnection = {
      getState: () => state,
      subscribe(l) {
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      onAssetChanged: () => () => {},
      destroy: () => {
        gone = true;
        state.session?.destroy();
      },
    };
    return connection;
  };
  const onSceneChange = vi.fn();
  const host: EditorHost = {
    assetUrl: (p, e) => `/blobs/${p}/${e.sha256}`,
    storage: null,
    notify,
    connect,
    onSceneChange,
  };
  return { server, host, onSceneChange };
}

const status = () =>
  screen
    .getAllByRole("status")
    .map((s) => s.textContent ?? "")
    .join(" | ");
const outliner = () => within(screen.getByRole("navigation", { name: "Outliner" }));
const skeletons = (container: HTMLElement) =>
  container.querySelectorAll(".je-panel-group .je-skeleton").length;
/** Lets pending promises and the effects they start run. */
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

// ─── Boot ────────────────────────────────────────────────

describe("booting", () => {
  // Each phase waits on a real Yjs round trip; a loaded CI runner can take longer than waitFor's 1 s default.
  const PHASE_WAIT = { timeout: 5_000 };

  it("draws the frame with skeleton panels at once and names each phase until the scene is up", async () => {
    const held = {
      connect: gate(),
      "scene:p.yard": gate(),
      "asset:p.bouncy": gate(),
    };
    const gameGate = gate();
    games.gate = gameGate.promise;
    const { host } = gatedProject(held);
    const { container } = render(
      <SceneEditor host={host} game={yardGame} project="p" scene="yard" rapier={rapier} />,
    );

    expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
    expect(skeletons(container)).toBeGreaterThan(0);
    await waitFor(() => expect(status()).toContain("Connecting to the scene server"), PHASE_WAIT);

    held.connect.open();
    await waitFor(() => expect(status()).toContain("Opening the scene"), PHASE_WAIT);
    expect(skeletons(container)).toBeGreaterThan(0);

    held["scene:p.yard"].open();
    await waitFor(() => expect(status()).toContain("Opening materials and prefabs"), PHASE_WAIT);

    held["asset:p.bouncy"].open();
    await waitFor(() => expect(status()).toContain("Building the game"), PHASE_WAIT);
    expect(skeletons(container)).toBeGreaterThan(0);

    gameGate.open();
    await waitFor(() => outliner().getByRole("button", { name: /ledge/ }), { timeout: 10_000 });
    expect(skeletons(container)).toBe(0);
    expect(status()).not.toMatch(/Opening|Building|Connecting/);
  }, 40_000);

  it("says it couldn't open the scene once it takes too long, and opens it if it comes after all", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const held = { "scene:p.yard": gate() };
      const { host } = gatedProject(held);
      const { container } = render(
        <SceneEditor host={host} game={yardGame} project="p" scene="yard" rapier={rapier} />,
      );
      const session = container.querySelector<HTMLElement>(".je-session")!;
      await waitFor(() => expect(status()).toContain("Opening the scene"), PHASE_WAIT);
      act(() => void vi.advanceTimersByTime(OPEN_TIMEOUT_MS - 1_000));
      expect(status()).toContain("Opening the scene");
      expect(session.dataset.boot).toBeUndefined();
      expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
      act(() => void vi.advanceTimersByTime(1_000));
      expect(status()).toContain("Couldn't open yard in project p");
      expect(status()).toContain("The scene server hasn't sent it in 30s");
      expect(status()).toContain("needs a restart");
      expect(status()).not.toContain("Opening the scene");
      // The panels' skeletons stop, so the error is the only state on screen, and Reload starts over.
      expect(session.dataset.boot).toBe("stopped");
      const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");
      const still = /\.je-session\[data-boot="stopped"\] \.je-skeleton \{([^}]*)\}/.exec(css)?.[1];
      expect(still).toContain("animation: none");
      expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();

      held["scene:p.yard"].open();
      await waitFor(() => outliner().getByRole("button", { name: /ledge/ }), { timeout: 10_000 });
      expect(status()).not.toContain("Couldn't open");
      expect(session.dataset.boot).toBeUndefined();
      expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  }, 40_000);
});

// ─── Rebuild ─────────────────────────────────────────────

describe("a rebuild", () => {
  it("keeps the panels mounted and inert, says so, and restores the selection and tool", async () => {
    const { host, server } = gatedProject();
    const { container } = render(
      <SceneEditor host={host} game={yardGame} project="p" scene="yard" rapier={rapier} />,
    );
    const row = await waitFor(() => outliner().getByRole("button", { name: /ledge/ }), {
      timeout: 10_000,
    });
    fireEvent.click(row);
    // A running activity, such as the physical check that follows the editor
    // opening, moves the shape tools into "More tools" until it lands, so the
    // click goes to whichever Box is on screen when it does.
    const box = () => screen.getByRole("button", { name: "Box" });
    await waitFor(
      () => {
        fireEvent.click(box());
        expect(box().getAttribute("aria-pressed")).toBe("true");
      },
      { timeout: 5_000 },
    );
    const outlinerNav = screen.getByRole("navigation", { name: "Outliner" });
    const built = games.made.length;

    const next = gate();
    games.gate = next.promise;
    act(() =>
      layoutPatch(server.doc("asset:p.bouncy"), materialLayout, {
        ...BOUNCY,
        physics: { friction: 0.4, restitution: 0.2 },
      }),
    );

    const session = container.querySelector<HTMLElement>(".je-session")!;
    await waitFor(() => expect(session.hasAttribute("inert")).toBe(true));
    expect(session.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("navigation", { name: "Outliner" })).toBe(outlinerNav);
    expect(skeletons(container)).toBe(0);
    await waitFor(() => expect(status()).toContain("Rebuilding the game"), { timeout: 2_000 });
    expect(screen.getByRole("navigation", { name: "Outliner" })).toBe(outlinerNav);

    next.open();
    await waitFor(() => expect(session.hasAttribute("inert")).toBe(false), { timeout: 10_000 });
    expect(games.made.length).toBe(built + 1);
    expect(games.made[built - 1]!.destroyed).toBe(true);
    expect(screen.getByRole("navigation", { name: "Outliner" })).toBe(outlinerNav);
    expect(outliner().getByRole("button", { name: /ledge/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("region", { name: "Identity" })).toBeTruthy();
    await waitFor(() => expect(box().getAttribute("aria-pressed")).toBe("true"), {
      timeout: 5_000,
    });
    await waitFor(() => expect(status()).not.toContain("Rebuilding the game"));
  }, 20_000);
});

// ─── The scene fallback ──────────────────────────────────

describe("a scene the project doesn't hold", () => {
  it("says which scene opened instead, once, and tells the host", async () => {
    const { host, onSceneChange } = gatedProject();
    const props = { host, game: yardGame, project: "p", rapier };
    const view = render(<SceneEditor {...props} scene="kitchen-sink" />);
    await waitFor(() => expect(onSceneChange).toHaveBeenCalledWith("yard"), { timeout: 10_000 });
    expect(notify.warning).toHaveBeenCalledTimes(1);
    expect(notify.warning).toHaveBeenCalledWith(
      'There\'s no scene "kitchen-sink" in P',
      expect.objectContaining({ description: "yard opened instead." }),
    );

    view.rerender(<SceneEditor {...props} scene="yard" />);
    await flush();
    expect(notify.warning).toHaveBeenCalledTimes(1);
    expect(onSceneChange).toHaveBeenCalledTimes(1);
  }, 20_000);
});

// ─── Prefabs ─────────────────────────────────────────────

const registry = createRegistry();

const POST: Prefab = {
  kind: "prefab",
  v: SCENE_FORMAT_VERSION,
  id: "post",
  entities: [{ id: "top", type: "marker", at: [0, -40] }],
  bulk: { solid: [["box", 0, 0, 6, 40]] },
};

const POSTS: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  name: "posts",
  bounds: [0, 0, 2000, 1200],
  instances: [{ id: "post-1", prefab: "post", at: [100, 900] }],
};

function Editor({ live, game, pending }: { live: LiveEditor; game: unknown; pending: Pending }) {
  const open = useStoreValue(live.prefab);
  const chrome = useMemo(
    () =>
      editorChrome({
        ...live.editing(open),
        host: live.host,
        game: game as Parameters<typeof editorChrome>[0]["game"],
        notify,
        onPlay: live.play,
        onReplay: live.replay,
        onStop: live.stop,
        onRestart: live.restart,
      }),
    [live, game, open],
  );
  return (
    <PendingProvider pending={pending}>
      <EditorFrame topLeft={null} {...chrome}>
        <canvas />
      </EditorFrame>
    </PendingProvider>
  );
}

/** The posts scene in the live editor, its prefab docs' opens waiting on `held.current` when set. */
async function prefabEditor() {
  const server = memoryDocHost();
  seedProjectDoc(
    server.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {
        posts: entry("posts", "scene", "posts.json"),
        post: entry("post", "prefab", "prefabs/post.json"),
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(POSTS, { doc: server.doc("scene:p.posts"), key: sequentialKeys("t") });
  prefabToDoc(POST, { doc: server.doc("asset:p.post"), key: sequentialKeys("p") });
  const identity = editorIdentity("Ada");
  const project = await createProjectSession({
    project: "p",
    openDoc: server.client().openDoc,
    origin: identity.origin,
    registry,
    kinds: createKindRegistry(null, [sceneKind, prefabKind]),
  });
  await prefabsReady(project);
  const scene = await project.open("scene:p.posts");
  const fake = fakeWorldGame(registry);
  const pending = createPending({ notify });
  const live = openLiveEditor({
    game: fake.game,
    doc: scene.doc,
    awareness: scene.awareness,
    name: "posts",
    identity,
    notify,
    pending,
    issuesDebounceMs: 0,
    project: { session: project, doc: "scene:p.posts" },
  });
  const source = live.session.prefabs as SessionPrefabSource;
  const realOpen = source.open.bind(source);
  const held: { current: Gate | null } = { current: null };
  const opens = vi.spyOn(source, "open").mockImplementation(async (id) => {
    const waiting = held.current;
    if (waiting) await waiting.promise;
    return realOpen(id);
  });
  render(<Editor live={live} game={fake.game} pending={pending} />);
  return { live, project, pending, held, opens };
}

const inspector = () => within(screen.getByRole("tabpanel", { name: "Inspector" }));
const crumb = () => screen.queryByRole("navigation", { name: "Breadcrumb" })?.textContent ?? null;

describe("opening a prefab", () => {
  it("is busy on the instance's scope while its doc opens, and a second press joins", async () => {
    const { live, project, pending, held, opens } = await prefabEditor();
    act(() => live.session.select(["post-1"]));
    held.current = gate();

    fireEvent.click(inspector().getByRole("button", { name: "Open prefab" }));
    expect(pending.busy(openPrefabScope("post-1"))).toMatchObject({ label: "Opening post" });
    fireEvent.click(inspector().getByRole("button", { name: "Open prefab" }));
    let again = false;
    act(() => {
      again = live.openPrefab("post", "post-1");
    });
    expect(again).toBe(true);
    await flush();
    expect(opens).toHaveBeenCalledTimes(1);
    expect(crumb()).toBeNull();

    act(() => held.current!.open());
    await flush();
    expect(crumb()).toBe("posts›post");
    expect(pending.busy(openPrefabScope("post-1"))).toBeUndefined();
    expect(pending.store.state.tasks).toEqual([]);
    live.destroy();
    project.destroy();
  });

  it("shows Create variant busy under the header it came from, joins a second press, then opens the variant", async () => {
    const { live, project, held } = await prefabEditor();
    act(() => {
      live.openPrefab("post", "post-1");
    });
    await flush();
    expect(crumb()).toBe("posts›post");

    held.current = gate();
    fireEvent.click(screen.getByRole("button", { name: "Create variant" }));
    const button = screen.getByRole("button", { name: "Create variant" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(crumb()).toBe("posts›post");
    fireEvent.click(button);
    act(() => {
      live.createVariant("post");
    });
    expect(live.session.getPrefabs().has("post-variant")).toBe(true);
    expect(live.session.getPrefabs().has("post-variant-2")).toBe(false);

    act(() => held.current!.open());
    await flush();
    expect(crumb()).toBe("posts›post-variant");
    expect(screen.getByRole("button", { name: "Create variant" }).getAttribute("aria-busy")).toBe(
      null,
    );
    live.destroy();
    project.destroy();
  });

  it("toasts a failure once and settles", async () => {
    const { live, project, pending, held } = await prefabEditor();
    held.current = gate();
    act(() => {
      live.openPrefab("post", "post-1");
      live.openPrefab("post", "post-1");
    });
    act(() => held.current!.fail(new Error("the server went away")));
    await flush();
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith("Prefab post couldn't be opened", {
      description: "the server went away",
    });
    expect(pending.store.state.tasks).toEqual([]);
    expect(crumb()).toBeNull();
    live.destroy();
    project.destroy();
  });
});

// ─── Art reload ──────────────────────────────────────────

describe("hot reload of art", () => {
  const OLD = "a".repeat(64);
  const NEW = "b".repeat(64);
  const crate: AssetEntry = {
    ...entry("crate", "texture", "art/crate.png"),
    sha256: OLD,
    bytes: 10,
    meta: { format: "png", width: 40, height: 20 },
  };
  const message: AssetChangedMessage = {
    type: ASSET_CHANGED,
    project: "p",
    key: "crate",
    id: "crate",
    kind: "texture",
    path: "art/crate.png",
    sha256: NEW,
    bytes: 12,
    previous: OLD,
  };

  async function reimport(reloaded: Promise<void>) {
    const server = memoryDocHost();
    seedProjectDoc(
      server.doc("project:p"),
      {
        meta: { projectId: "p", layout: 1, name: "P" },
        assets: { crate },
        history: {},
        code: {},
        build: {},
      },
      { kind: "migration" },
    );
    const session = await createProjectSession({
      project: "p",
      openDoc: server.client().openDoc,
      origin: editorIdentity("Ada").origin,
      registry: createRegistry(yardGame),
      kinds: yardKinds,
    });
    const watch = projectRegistry(session);
    await watch.ready();
    const pending = createPending({ notify });
    let send: ((m: AssetChangedMessage) => void) | undefined;
    const off = watch.followAssets(
      {
        onAssetChanged(listener) {
          send = listener;
          return () => (send = undefined);
        },
      },
      { reloadAssets: () => reloaded.then(() => ({ failed: [], errors: [] })) },
      { pending },
    );
    writeEntry(server.doc("project:p"), { ...crate, sha256: NEW, bytes: 12 });
    send?.(message);
    const done = () => {
      off();
      watch.destroy();
      session.destroy();
    };
    return { pending, done };
  }

  it("holds a task naming the file until the game has redrawn it", async () => {
    const reloaded = gate();
    const { pending, done } = await reimport(reloaded.promise);
    expect(pending.busy("editor")).toMatchObject({ label: "Reloading crate.png" });
    reloaded.open();
    await vi.waitFor(() => expect(pending.store.state.tasks).toEqual([]));
    expect(notify.error).not.toHaveBeenCalled();
    done();
  });

  it("toasts a reload that failed, once", async () => {
    const reloaded = gate();
    const { pending, done } = await reimport(reloaded.promise);
    reloaded.fail(new Error("decode failed"));
    await vi.waitFor(() => expect(pending.store.state.tasks).toEqual([]));
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith("The art couldn't reload", {
      description: "decode failed",
    });
    done();
  });
});
