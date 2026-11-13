import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

import type { DebugLayerFactory, DebugOverlayFactory } from "../debug/index";
import { createRegistry } from "../game/index";
import {
  createAssetLoader,
  createGame,
  type CameraState,
  type GameDefinition,
  type GameInstance,
  type RapierModule,
} from "../index";
import type { ProjectId, ProjectRuntimeView } from "../project/index";
import { mountUi } from "../ui/layer";
import type { MountUi } from "../ui/types";
import type { SceneDocStatus, SceneFallback } from "./connect/scene-doc";
import {
  editorChrome,
  Island,
  type EditorChrome,
  type EditorFrameHandle,
} from "./frame/EditorFrame";
import { EditorBooting, EditorSkeleton } from "./frame/EditorSkeleton";
import { hostCue, type EditorHost, type NotifyOptions, type SceneHome } from "./host";
import { Button, createToaster, hostNotify, Toasts } from "./kit/index";
import type { PanelId } from "./layout/model";
import { InspectorReadOnly } from "./panels/EditorInspector";
import { createPending } from "./pending/pending";
import { PendingProvider } from "./pending/use-pending";
import { useSceneEditor, type BootPhase, type EditorAssets } from "./session/use-scene-editor";

export type SceneEditorProps = {
  host: EditorHost;
  /**
   * The game the project's scenes are for, as its `jams.project.json` names
   * it; null for an engine-only project, whose scenes the dev server and the
   * CLI judge by `createRegistry(null)`.
   */
  game: GameDefinition | null;
  project: ProjectId;
  /** The scene to open, by id or name; when the project has neither its first scene opens and `onSceneChange` reports it. */
  scene?: string;
  rapier: () => Promise<RapierModule>;
  /** The game's DOM UI (its project file's `ui`), mounted over the canvas while Play runs. */
  ui?: MountUi | null;
  /** Dev hosts: the debug overlay and the game's debug layers (F3). */
  debug?: () => Promise<{
    overlay: DebugOverlayFactory;
    layers?: readonly DebugLayerFactory[];
  }>;
  /** Called once the editor is up, with commands a host's own chrome can call. */
  onReady?: (handle: SceneEditorHandle) => void;
};

export type SceneEditorHandle = {
  openPanel(id: PanelId): void;
  resetLayout(): void;
  /** The editor's current game; null while it builds (a rebuild included) and after unmount. */
  game(): GameInstance | null;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// ─── The editor ──────────────────────────────────────────

const CONNECTION_LABEL: Record<SceneDocStatus, string> = {
  connecting: "Connecting to the scene server",
  live: "Connecting to the scene server",
  reconnecting: "Reconnecting to the scene server",
  offline: "Offline",
  failed: "The editor couldn't open the project",
};

const PHASE_LABEL: Record<Exclude<BootPhase, "connecting">, string> = {
  scene: "Opening the scene",
  assets: "Opening materials and prefabs",
  game: "Building the game",
};

const REBUILD_LABEL = "Rebuilding the game";

/** How long the scene, or its materials and prefabs, may take to open before the editor says it couldn't. */
export const OPEN_TIMEOUT_MS = 30_000;

/** Whether a phase waits on the scene server sending docs, which it may never do. */
function isOpening(phase: BootPhase): boolean {
  return phase === "scene" || phase === "assets";
}

/** What the boot status says once the scene has taken longer than `OPEN_TIMEOUT_MS` to open. */
function openStalled(scene: string | undefined, project: string) {
  return {
    label: `Couldn't open ${scene ?? "the scene"} in project ${project}`,
    working: false,
    error: `The scene server hasn't sent it in ${OPEN_TIMEOUT_MS / 1000}s. The editor keeps asking. A dev server started before an engine change needs a restart, then a reload.`,
  };
}

/** What the editor is doing while its panels can't be used yet, and whether it is still at it. */
function bootStatus(
  phase: BootPhase,
  status: SceneDocStatus,
  failed: Error | null,
): { label: string; working: boolean; error: string | null } {
  if (failed) return { label: "The game couldn't start", working: false, error: failed.message };
  if (phase !== "connecting") return { label: PHASE_LABEL[phase], working: true, error: null };
  return {
    label: CONNECTION_LABEL[status],
    working: status !== "failed" && status !== "offline",
    error: null,
  };
}

/**
 * What the canvas is sized to: the box it sits in once laid out, else the
 * window, as a full-page editor is. Never the canvas's own box, which keeps
 * whatever size the renderer last gave it.
 */
function displaySize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const box = (canvas.parentElement ?? canvas).getBoundingClientRect();
  return box.width > 0 && box.height > 0
    ? { width: Math.round(box.width), height: Math.round(box.height) }
    : { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Puts `game`'s editor camera where `view` had another game's: the same
 * zoom, then the same centre, each within the camera's limits.
 */
export function restoreEditView(
  game: Pick<GameInstance, "getStore" | "zoomAt" | "panBy">,
  view: Pick<CameraState, "position" | "zoom">,
): void {
  const before = game.getStore().state.camera;
  if (before.zoom > 0 && before.zoom !== view.zoom)
    game.zoomAt({ x: 0, y: 0 }, view.zoom / before.zoom);
  const { position, scale } = game.getStore().state.camera;
  const dx = (position.x - view.position.x) * scale;
  const dy = (position.y - view.position.y) * scale;
  if (dx !== 0 || dy !== 0) game.panBy({ x: dx, y: dy });
}

/**
 * Mounts `ui` over `canvas` while `game` is in Play, and unmounts it on Stop,
 * on a rebuild and when `ui` changes. The layer sits on the canvas, so a
 * panel resize that resizes the canvas resizes it too.
 */
export function usePlayUi(
  game: GameInstance | null,
  canvas: () => HTMLCanvasElement | null,
  ui: MountUi | null | undefined,
): void {
  const [playing, setPlaying] = useState<GameInstance | null>(null);
  useEffect(() => {
    if (!game) return;
    const store = game.getStore();
    const read = () => setPlaying(store.state.mode === "play" ? game : null);
    read();
    const unsubscribe = store.subscribe(read);
    return () => {
      unsubscribe();
      setPlaying(null);
    };
  }, [game]);
  useEffect(() => {
    const el = canvas();
    if (!playing || !ui || !el) return;
    return mountUi(playing, el, ui);
  }, [playing, ui, canvas]);
}

/**
 * The "There's no scene" notice: what was asked for, where it is when another
 * project holds it, and what opened. With `open`, the notice carries an
 * action that opens the scene in its own project.
 */
export function fallbackNotice(
  fellBack: SceneFallback,
  home: SceneHome | null,
  projectName: (id: string) => string,
  open?: (home: SceneHome) => void,
): { message: string; description: string; action?: NonNullable<NotifyOptions["action"]> } {
  const elsewhere = home && home.project !== fellBack.project.id ? home : null;
  const opened = `${fellBack.openedName} opened instead.`;
  const message = `There's no scene "${elsewhere?.name ?? fellBack.wanted}" in ${fellBack.project.name}`;
  if (!elsewhere) return { message, description: opened };
  const name = projectName(elsewhere.project);
  if (!open) {
    return {
      message,
      description: `It's in ${name}: switch to that project in the Project panel. ${opened}`,
    };
  }
  return {
    message,
    description: `It's in ${name}. ${opened}`,
    action: { label: `Open in ${name}`, onClick: () => open(elsewhere) },
  };
}

/** Textures that didn't load draw as the fallback box; the console says which. */
function warnFailedTextures(scene: string, failed: readonly { id: string }[]): void {
  if (failed.length === 0) return;
  const ids = failed.map((e) => e.id).join(", ");
  console.warn(`[assets] ${scene}: ${failed.length} texture(s) failed to load: ${ids}`);
}

/**
 * The scene editor on the host's project: it owns the canvas and the game,
 * built with the host's game definition, Rapier and debug overlay, and
 * builds the game again when the project's materials, settings or tables
 * change. The frame draws the host's chrome in its top corners.
 */
export function SceneEditor(props: SceneEditorProps): ReactElement {
  const { host, game: definition, project, scene } = props;
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Destroying a game loses its canvas's WebGL context for good, and a game
  // built on that canvas again hangs in Pixi's shader probe: every build gets
  // a new canvas element.
  const [canvasKey, setCanvasKey] = useState(0);
  const [spent] = useState(() => new WeakSet<HTMLCanvasElement>());
  const frameRef = useRef<EditorFrameHandle>(null);
  const gameRef = useRef<GameInstance | null>(null);
  const [toaster] = useState(() => createToaster({ cue: hostCue(host) }));
  useEffect(() => () => toaster.destroy(), [toaster]);
  const [notify] = useState(() => hostNotify(host, toaster));
  const [pending] = useState(() => createPending({ notify }));
  const [getCanvas] = useState(() => () => canvasRef.current);
  const [loadRapier] = useState(() => () => latest.current.rapier());
  const registry = useMemo(() => createRegistry(definition), [definition]);

  const [built, setBuilt] = useState<{
    game: GameInstance;
    projectData: ProjectRuntimeView | null;
    /** Built with the open project's asset loader. */
    loads: boolean;
  } | null>(null);
  const [buildFailed, setBuildFailed] = useState<Error | null>(null);
  const game = built?.game ?? null;
  const editing = useSceneEditor({
    host,
    notify,
    pending,
    game,
    builtWith: built?.projectData ?? null,
    project,
    registry,
    scene: scene ?? null,
    enabled: true,
    rapier: loadRapier,
    canvas: getCanvas,
  });

  // Read by the build, never a key of it: the project's view changes with every edit.
  const assetsRef = useRef<EditorAssets | null>(null);
  useEffect(() => {
    assetsRef.current = editing.assets;
  }, [editing.assets]);

  const { registry: buildRegistry, projectData } = editing;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || spent.has(canvas)) return;

    let instance: GameInstance | null = null;
    let last = { width: 0, height: 0 };
    let mounted = true;
    // One loader per game, only while a project is open, over the host's blob URLs.
    const open = assetsRef.current;
    const loader = open
      ? createAssetLoader({ project: open.project, url: latest.current.host.assetUrl })
      : null;

    async function init() {
      if (!canvas || !mounted) return;
      const debug = await latest.current.debug?.();
      if (!mounted) return;
      const size = displaySize(canvas);
      const created = await createGame(canvas, {
        game: definition,
        registry: buildRegistry,
        project: projectData,
        displayWidth: size.width,
        displayHeight: size.height,
        // An editor's game validates and logs as a dev build's does.
        dev: true,
        ...(debug ? { debug: debug.overlay, debugLayers: debug.layers } : {}),
        rapier: loadRapier,
        // The page is the game: editor and debug keys work with focus on a panel
        // or fallen to the body, while play input still needs the canvas focused.
        keyTarget: window,
        ...(open && loader
          ? {
              assets: {
                loader,
                kinds: open.kinds,
                get view() {
                  return open.view();
                },
              },
            }
          : {}),
      });
      if (!mounted) {
        created.destroy();
        return;
      }
      instance = created;
      gameRef.current = created;
      last = size;
      setBuildFailed(null);
      setBuilt({ game: created, projectData, loads: loader !== null });
      created.start();
      // The box may have changed while the game was being made.
      handleResize();
    }

    init().catch((error: unknown) => {
      if (!mounted) return;
      setBuildFailed(error instanceof Error ? error : new Error(String(error)));
      notify.error("The game couldn't start", { description: errorMessage(error) });
    });

    function handleResize() {
      if (!instance || !canvas) return;
      const size = displaySize(canvas);
      if (size.width === last.width && size.height === last.height) return;
      last = size;
      instance.resize(size.width, size.height);
    }
    window.addEventListener("resize", handleResize);
    const box = canvas.parentElement;
    const observer =
      box && typeof ResizeObserver !== "undefined" ? new ResizeObserver(handleResize) : null;
    if (box) observer?.observe(box);

    return () => {
      mounted = false;
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
      gameRef.current = null;
      instance?.destroy();
      instance = null;
      loader?.destroy();
      setBuilt(null);
      spent.add(canvas);
      setCanvasKey((k) => k + 1);
    };
  }, [definition, buildRegistry, projectData, loadRapier, notify, spent, canvasKey]);

  usePlayUi(game, getCanvas, props.ui);

  // Said once per fallback; a host's route that follows it to the opened scene keeps the same one.
  const fellBack = editing.fellBack;
  useEffect(() => {
    if (!fellBack) return;
    const { host: current } = latest.current;
    current.onSceneChange?.(fellBack.opened);
    let live = true;
    const say = (home: SceneHome | null) => {
      if (!live) return;
      const nameOf = (id: string) => current.projects?.find((p) => p.id === id)?.name ?? id;
      // The editor's own toasts show no buttons, so only a host's toasts get the action.
      const change = current.onProjectChange;
      const open =
        change && current.notify && current.projects?.some((p) => p.id === home?.project)
          ? (to: SceneHome) => change(to.project, { scene: to.id })
          : undefined;
      const { message, ...opts } = fallbackNotice(fellBack, home, nameOf, open);
      notify.warning(message, { id: "scene-fallback", ...opts });
    };
    const find = current.findScene;
    if (find) find(fellBack.wanted).then(say, () => say(null));
    else say(null);
    return () => {
      live = false;
    };
  }, [fellBack, notify]);

  // A rebuilt game starts with its own camera: the editor puts the last
  // edit view of the same scene back once it is open on the new game.
  const editView = useRef<{ game: GameInstance; scene: string; camera: CameraState } | null>(null);
  const editorUp = editing.editor !== null;
  const openScene = editing.scene;
  useEffect(() => {
    if (!game || !editorUp || !openScene) return;
    const held = editView.current;
    if (held && held.game !== game && held.scene === openScene) restoreEditView(game, held.camera);
    const store = game.getStore();
    const keep = () => {
      if (store.state.mode === "edit")
        editView.current = { game, scene: openScene, camera: store.state.camera };
    };
    keep();
    return store.subscribe(keep);
  }, [game, editorUp, openScene]);

  // Once per game built over the project's loader: the opened scene's textures, and which failed.
  const editorSession = editing.editor?.session ?? null;
  const preloaded = useRef<GameInstance | null>(null);
  useEffect(() => {
    if (!game || !built?.loads || !editorSession || preloaded.current === game) return;
    preloaded.current = game;
    const doc = editorSession.getDoc();
    void game.preload(doc).then(
      ({ failed }) => warnFailedTextures(doc.name, failed),
      () => {},
    );
  }, [game, built, editorSession]);

  const publish = host.publish;
  const chrome = useMemo(
    () =>
      editing.editor
        ? editorChrome(
            { ...editing.editor, notify },
            { dev: true, ...(publish ? { publish } : {}) },
          )
        : null,
    [editing.editor, notify, publish],
  );

  const announced = useRef(false);
  useEffect(() => {
    if (!chrome || announced.current) return;
    announced.current = true;
    latest.current.onReady?.({
      openPanel: (id) => frameRef.current?.openPanel(id),
      resetLayout: () => frameRef.current?.resetLayout(),
      game: () => gameRef.current,
    });
  }, [chrome]);

  // Through a rebuild the last editor's chrome stays on screen, inert, until the next one opens.
  const [kept, setKept] = useState<EditorChrome | null>(null);
  const rebuilding = editing.rebuilding && !buildFailed;
  if (chrome && kept !== chrome) setKept(chrome);
  else if (!chrome && !rebuilding && kept) setKept(null);
  const shown = chrome ?? (rebuilding ? kept : null);
  const inert = !chrome && shown !== null;

  const phase = editing.phase;
  const [stalled, setStalled] = useState<BootPhase | null>(null);
  useEffect(() => {
    if (!phase || !isOpening(phase)) return;
    const timer = setTimeout(() => setStalled(phase), OPEN_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      setStalled(null);
    };
  }, [phase]);
  const booting =
    !shown && (phase || buildFailed)
      ? stalled !== null && stalled === phase && !buildFailed
        ? openStalled(scene, project)
        : bootStatus(phase ?? "game", editing.status ?? "connecting", buildFailed)
      : null;
  const activity = inert ? REBUILD_LABEL : booting?.working ? booting.label : null;
  // Stopped short of an editor: the panels' skeletons stop pulsing, so the error is the only state shown.
  const stopped = booting !== null && !booting.working;
  useEffect(() => {
    if (!activity) return;
    return pending.hold({ id: "editor:session", label: activity, scope: "editor" });
  }, [activity, pending]);

  return (
    <PendingProvider pending={pending}>
      <InspectorReadOnly value={editing.editor?.project?.readOnly ?? false}>
        <div
          className="je-session"
          style={{ display: "contents" }}
          inert={inert}
          aria-busy={inert || undefined}
          data-boot={stopped ? "stopped" : undefined}
        >
          <EditorSkeleton
            frameRef={frameRef}
            host={host}
            topLeft={host.chrome?.topLeft}
            topRight={host.chrome?.topRight}
            registry={registry}
            notify={notify}
            {...shown}
            status={
              shown ? (
                (shown.status ?? null)
              ) : booting ? (
                <>
                  <EditorBooting {...booting} />
                  {booting.error ? (
                    <Island className="je-boot-reload">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => window.location.reload()}
                      >
                        Reload
                      </Button>
                    </Island>
                  ) : null}
                </>
              ) : undefined
            }
            overlay={
              <>
                {shown?.overlay}
                {notify === toaster.notify ? <Toasts toaster={toaster} /> : null}
              </>
            }
          >
            <canvas key={canvasKey} ref={canvasRef} className="je-scene-canvas" />
          </EditorSkeleton>
        </div>
      </InspectorReadOnly>
    </PendingProvider>
  );
}

/** Renders `SceneEditor` into `element` with its own React root. */
export function mountSceneEditor(
  element: HTMLElement,
  props: SceneEditorProps,
): { update(props: SceneEditorProps): void; unmount(): void } {
  const root = createRoot(element);
  let mounted = true;
  const render = (next: SceneEditorProps) => root.render(<SceneEditor {...next} />);
  render(props);
  return {
    update(next) {
      if (mounted) render(next);
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      root.unmount();
    },
  };
}
