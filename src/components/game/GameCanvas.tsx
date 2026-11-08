import {
  createAssetLoader,
  createGame,
  selectDebugMode,
  selectFPS,
  selectPhase,
  type GameInstance,
  type GameStoreState,
} from "@jams/engine";
import type { ProjectRuntimeView } from "@jams/engine/project";
import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/store";
import { useEffect, useRef, useState } from "react";

import { CanvasShell, Island } from "@/components/canvas/shell/CanvasShell";
import { ShellTitle, SiteIsland } from "@/components/canvas/shell/SiteIsland";
import { MicroLabel } from "@/components/ui/typography";
import { platformerGame } from "@/games/platformer";

import { editorAssetUrl } from "./asset-urls";
import {
  BUNDLED_PREFABS,
  BUNDLED_SCENE,
  BUNDLED_SCENE_ID,
  SCENE_REGISTRY,
} from "./platformer-scene";
import { SCENE_PROJECT } from "./scene-collab";
import type { SceneDocStatus } from "./use-scene-doc";
import { useSceneEditor, type EditorAssets } from "./use-scene-editor";

const loadRapier = () => import("@dimforge/rapier2d");

/** Textures that didn't load draw as the fallback box; the console says which. */
export function warnFailedTextures(scene: string, failed: readonly { id: string }[]): void {
  if (failed.length === 0) return;
  const ids = failed.map((e) => e.id).join(", ");
  console.warn(`[assets] ${scene}: ${failed.length} texture(s) failed to load: ${ids}`);
}

type GameCanvasProps = {
  roomId: string;
  /** Opens the scene editor; dev builds only. */
  edit?: boolean;
  /** The project scene the editor opens, by id; default the bundled one. */
  scene?: string;
};

export function GameCanvas({ roomId, edit = false, scene }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [built, setBuilt] = useState<{
    game: GameInstance;
    projectData: ProjectRuntimeView | null;
  } | null>(null);
  const game = built?.game ?? null;
  const {
    chrome: editor,
    status: connection,
    scene: editing,
    error,
    registry,
    projectData,
    assets,
  } = useSceneEditor({
    game,
    builtWith: built?.projectData ?? null,
    project: SCENE_PROJECT,
    registry: SCENE_REGISTRY,
    scene: scene ?? BUNDLED_SCENE_ID,
    enabled: edit,
    rapier: loadRapier,
    canvas: () => canvasRef.current,
  });

  // Read by the build, never a key of it: the project's view changes with every edit.
  const assetsRef = useRef<EditorAssets | null>(null);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  // Rebuilt when the editor's project overlays other materials on the code registry, or its settings or tables change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let instance: GameInstance | null = null;
    let mounted = true;
    // One loader per game instance, only while a project is open: the bundled room has no blobs to fetch.
    // Its URL scheme is the editor session's blob host, so textures load from where its uploads went.
    const open = assetsRef.current;
    const loader = open ? createAssetLoader({ project: open.project, url: editorAssetUrl }) : null;

    async function init() {
      if (!canvas || !mounted) return;

      // Display resolution = window size (Native mode).
      // A future settings UI can override with a fixed resolution.
      const [debug, debugLayers] = import.meta.env.DEV
        ? await Promise.all([
            import("@jams/engine/debug").then((m) => m.createDebugOverlay),
            import("@/games/platformer/debug").then((m) => m.PLATFORMER_DEBUG_LAYERS),
          ])
        : [undefined, undefined];
      if (!mounted) return;
      const created = await createGame(canvas, {
        game: platformerGame,
        registry,
        project: projectData,
        displayWidth: window.innerWidth,
        displayHeight: window.innerHeight,
        dev: import.meta.env.DEV,
        debug,
        debugLayers,
        rapier: loadRapier,
        // The page is the game: editor and debug keys work with focus on a panel
        // or fallen to the body, while play input still needs the canvas focused.
        keyTarget: window,
        prefabs: BUNDLED_PREFABS,
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
          : { scene: BUNDLED_SCENE }),
      });

      if (mounted && loader) {
        const { failed } = await created.preload(BUNDLED_SCENE);
        warnFailedTextures(BUNDLED_SCENE.name, failed);
        if (mounted) {
          const report = created.loadScene(BUNDLED_SCENE);
          if (!report.ok) console.warn(`[scene] ${BUNDLED_SCENE.name}: ${report.error}`);
        }
      }

      if (!mounted) {
        created.destroy();
        return;
      }

      instance = created;
      setBuilt({ game: created, projectData });
      created.start();
    }

    init();

    function handleResize() {
      if (!instance) return;
      instance.resize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      mounted = false;
      window.removeEventListener("resize", handleResize);
      if (instance) {
        instance.destroy();
        instance = null;
      }
      loader?.destroy();
      setBuilt(null);
    };
  }, [registry, projectData]);

  return (
    <CanvasShell
      topLeft={
        <SiteIsland
          label="Game"
          site={{ back: { label: "lobby", link: <Link to="/game" /> }, signinSource: "game" }}
        >
          <ShellTitle>{editor && editing ? editing : roomId}</ShellTitle>
        </SiteIsland>
      }
      status={
        editor ? undefined : connection ? (
          <EditorConnecting status={connection} error={error} />
        ) : game ? (
          <GameHUD store={game.getStore()} />
        ) : undefined
      }
      {...editor}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full bg-[#1a1a2e] outline-none"
        style={{ touchAction: "none" }}
      />
    </CanvasShell>
  );
}

const CONNECTING_LABEL: Record<SceneDocStatus, string> = {
  connecting: "Connecting to the scene server",
  live: "Opening the editor",
  reconnecting: "Reconnecting to the scene server",
  offline: "Offline",
  failed: "The editor couldn't open the project",
};

function EditorConnecting({ status, error }: { status: SceneDocStatus; error: Error | null }) {
  return (
    <Island
      role="status"
      className="flex-col items-start gap-0.5 px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      <span>{CONNECTING_LABEL[status]}</span>
      {status === "failed" && error ? (
        <span className="text-destructive">{error.message}</span>
      ) : null}
    </Island>
  );
}

// ─── HUD overlay ─────────────────────────────────────────

function GameHUD({ store }: { store: Store<GameStoreState> }) {
  const phase = useStore(store, selectPhase);
  const fps = useStore(store, selectFPS);
  const debugMode = useStore(store, selectDebugMode);

  return (
    <Island role="status" className="flex-col items-start gap-0.5 px-2.5 py-1.5 text-xs">
      <span className="text-muted-foreground">
        {phase === "running" ? `${Math.round(fps)} FPS` : phase}
      </span>
      {import.meta.env.DEV && debugMode !== "off" && (
        <MicroLabel as="span" className="text-cyan-400/70 uppercase">
          Debug: {debugMode}
        </MicroLabel>
      )}
      <MicroLabel as="span" className="text-muted-foreground">
        WASD / Arrow keys to move · Space to jump
        {import.meta.env.DEV && " · F3 debug overlay"}
      </MicroLabel>
    </Island>
  );
}
