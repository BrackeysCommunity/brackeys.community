import { Store } from "@tanstack/store";
import {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";

import type { DebugLayerFactory, DebugOverlayFactory } from "../debug/index";
import { createRegistry } from "../game/index";
import {
  createAssetLoader,
  createGame,
  type GameDefinition,
  type GameInstance,
  type RapierModule,
} from "../index";
import type { ProjectId, ProjectRuntimeView } from "../project/index";
import type { SceneDocStatus } from "./connect/scene-doc";
import { EditorFrame, editorChrome, Island } from "./frame/EditorFrame";
import { hostCue, type EditorHost, type EditorNotify } from "./host";
import { createToaster, Toasts } from "./kit/index";
import type { PanelId } from "./layout/model";
import type { Pending, PendingTask } from "./pending/pending";
import { useSceneEditor, type EditorAssets } from "./session/use-scene-editor";

export type SceneEditorProps = {
  host: EditorHost;
  /** The game the project's scenes are for; an engine-only project passes a minimal one. */
  game: GameDefinition;
  project: ProjectId;
  /** The scene to open, by id; the project's first scene (with a notice) when it has none of that id. */
  scene?: string;
  rapier: () => Promise<RapierModule>;
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
};

// ─── Pending ─────────────────────────────────────────────

const PendingContext = createContext<Pending | null>(null);

function PendingProvider({ pending, children }: { pending: Pending; children: ReactNode }) {
  return <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Runs each task straight away and tracks none: no busy state, no activity line. */
function immediatePending(notify: EditorNotify): Pending {
  const store = new Store<{ tasks: readonly PendingTask[] }>({ tasks: [] });
  const step = { progress() {}, label() {} };
  return {
    store,
    async run(spec, work) {
      try {
        const value = await work(step);
        const said = typeof spec.success === "function" ? spec.success(value) : spec.success;
        if (said) notify.success(said);
        return { ok: true, value };
      } catch (error) {
        const title = typeof spec.error === "function" ? spec.error(error) : spec.error;
        notify.error(title, { description: errorMessage(error) });
        return { ok: false, error };
      }
    },
    hold: () => (outcome) => {
      if (outcome?.error !== undefined)
        notify.error(outcome.errorTitle ?? "Something went wrong", {
          description: errorMessage(outcome.error),
        });
    },
    busy: () => undefined,
  };
}

// ─── The editor ──────────────────────────────────────────

const CONNECTING_LABEL: Record<SceneDocStatus, string> = {
  connecting: "Connecting to the scene server",
  live: "Opening the editor",
  reconnecting: "Reconnecting to the scene server",
  offline: "Offline",
  failed: "The editor couldn't open the project",
};

function EditorConnecting({ status, error }: { status: SceneDocStatus; error: Error | null }) {
  return (
    <Island role="status" className="je-editor-connecting">
      <span>{CONNECTING_LABEL[status]}</span>
      {status === "failed" && error ? (
        <span className="je-editor-connecting-error">{error.message}</span>
      ) : null}
    </Island>
  );
}

/** The island each panel sits in, for `openPanel`. */
const PANEL_ISLAND: Readonly<Record<string, string>> = {
  outliner: ".je-island-outliner",
  project: ".je-island-project",
  inspector: ".je-island-inspector",
  problems: ".je-island-problems",
  run: ".je-island-run",
  history: ".je-island-history",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** What the canvas is sized to: its own box once laid out, else the window, as a full-page editor is. */
function displaySize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const box = canvas.getBoundingClientRect();
  return box.width > 0 && box.height > 0
    ? { width: Math.round(box.width), height: Math.round(box.height) }
    : { width: window.innerWidth, height: window.innerHeight };
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
  const [toaster] = useState(() => createToaster({ cue: hostCue(host) }));
  useEffect(() => () => toaster.destroy(), [toaster]);
  const [notify] = useState(() => host.notify ?? toaster.notify);
  const [pending] = useState(() => immediatePending(notify));
  const [getCanvas] = useState(() => () => canvasRef.current);
  const [loadRapier] = useState(() => () => latest.current.rapier());
  const registry = useMemo(() => createRegistry(definition), [definition]);

  const [built, setBuilt] = useState<{
    game: GameInstance;
    projectData: ProjectRuntimeView | null;
  } | null>(null);
  const game = built?.game ?? null;
  const editing = useSceneEditor({
    host,
    notify,
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
    if (!canvas) return;

    let instance: GameInstance | null = null;
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
      setBuilt({ game: created, projectData });
      created.start();
    }

    init().catch((error: unknown) =>
      notify.error("The game couldn't start", { description: errorMessage(error) }),
    );

    function handleResize() {
      if (!instance || !canvas) return;
      const size = displaySize(canvas);
      instance.resize(size.width, size.height);
    }
    window.addEventListener("resize", handleResize);

    return () => {
      mounted = false;
      window.removeEventListener("resize", handleResize);
      instance?.destroy();
      instance = null;
      loader?.destroy();
      setBuilt(null);
    };
  }, [definition, buildRegistry, projectData, loadRapier, notify]);

  const opened = editing.scene;
  useEffect(() => {
    if (opened !== null && opened !== latest.current.scene)
      latest.current.host.onSceneChange?.(opened);
  }, [opened]);

  const chrome = useMemo(
    () => (editing.editor ? editorChrome({ ...editing.editor, notify }) : null),
    [editing.editor, notify],
  );

  const announced = useRef(false);
  useEffect(() => {
    if (!chrome || announced.current) return;
    announced.current = true;
    latest.current.onReady?.({
      openPanel(id) {
        const selector = PANEL_ISLAND[id];
        const frame = canvasRef.current?.closest(".je-frame");
        const island = selector ? frame?.querySelector<HTMLElement>(selector) : null;
        if (!island) return;
        island.scrollIntoView?.({ block: "nearest" });
        const target = island.querySelector<HTMLElement>(FOCUSABLE) ?? island;
        if (target === island && !island.hasAttribute("tabindex")) island.tabIndex = -1;
        target.focus({ preventScroll: true });
      },
      // The columns are fixed, so there is no layout to put back.
      resetLayout() {},
    });
  }, [chrome]);

  const connecting =
    !chrome && editing.status ? (
      <EditorConnecting status={editing.status} error={editing.error} />
    ) : undefined;

  return (
    <PendingProvider pending={pending}>
      <EditorFrame
        host={host}
        topLeft={host.chrome?.topLeft}
        topRight={host.chrome?.topRight}
        {...chrome}
        status={chrome?.status ?? connecting}
        overlay={
          <>
            {chrome?.overlay}
            {host.notify ? null : <Toasts toaster={toaster} />}
          </>
        }
      >
        <canvas ref={canvasRef} className="je-scene-canvas" />
      </EditorFrame>
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
