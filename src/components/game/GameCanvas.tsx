import {
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

import {
  BUNDLED_PREFABS,
  BUNDLED_SCENE,
  BUNDLED_SCENE_ID,
  SCENE_REGISTRY,
} from "./platformer-scene";
import { SCENE_PROJECT } from "./scene-collab";
import type { SceneDocStatus } from "./use-scene-doc";
import { useSceneEditor } from "./use-scene-editor";

const loadRapier = () => import("@dimforge/rapier2d");

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

  // Rebuilt when the editor's project overlays other materials on the code registry, or its settings or tables change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let instance: GameInstance | null = null;
    let mounted = true;

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
      instance = await createGame(canvas, {
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
        scene: BUNDLED_SCENE,
        prefabs: BUNDLED_PREFABS,
      });

      if (!mounted) {
        instance.destroy();
        return;
      }

      setBuilt({ game: instance, projectData });
      instance.start();
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
