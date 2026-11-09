import {
  createGame,
  selectDebugMode,
  selectFPS,
  selectPhase,
  type GameInstance,
  type GameStoreState,
} from "@jams/engine";
import { useStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/store";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { CanvasShell, Island } from "@/components/canvas/shell/CanvasShell";
import { MicroLabel } from "@/components/ui/typography";
import { platformerGame } from "@/games/platformer";
import { useFlag } from "@/lib/hooks/use-flag";

import { displayResolution, useDisplaySetting } from "./display-menu";
import { BUNDLED_PREFABS, BUNDLED_SCENE, SCENE_REGISTRY } from "./platformer-scene";
import { GameSiteIsland } from "./site-island";

const loadRapier = () => import("@dimforge/rapier2d");

/** `null` in production builds, so the editor's chunks (and the provider) are never emitted there. */
const SiteSceneEditor = import.meta.env.DEV
  ? lazy(() => import("./editor-host").then((m) => ({ default: m.SiteSceneEditor })))
  : null;

type GameCanvasProps = {
  roomId: string;
  /** Opens the scene editor; dev builds only. */
  edit?: boolean;
  /** The project scene the editor opens, by id; default the bundled one. */
  scene?: string;
};

export function GameCanvas({ roomId, edit = false, scene }: GameCanvasProps) {
  if (edit && SiteSceneEditor) {
    return (
      <Suspense fallback={<EditorLoading roomId={roomId} />}>
        <SiteSceneEditor roomId={roomId} scene={scene} />
      </Suspense>
    );
  }
  return <GameRoom roomId={roomId} />;
}

/** While the editor's chunk loads: the room's chrome and what is happening. */
function EditorLoading({ roomId }: { roomId: string }) {
  return (
    <CanvasShell
      topLeft={<GameSiteIsland title={roomId} />}
      status={
        <Island
          role="status"
          className="flex-col items-start gap-0.5 px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          <span>Loading the editor</span>
        </Island>
      }
    >
      <div className="h-full w-full bg-[#1a1a2e]" />
    </CanvasShell>
  );
}

/**
 * The game room as everyone plays it: the bundled scene. Under the display
 * menu's flag the viewer's choice is the host's resolution policy, and a new
 * choice rebuilds the game, since the engine reads it once at creation.
 */
function GameRoom({ roomId }: { roomId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<GameInstance | null>(null);
  const displayMenu = useFlag("game-display-menu");
  const [display, setDisplay] = useDisplaySetting();
  const resolutionKey = JSON.stringify(displayMenu ? (displayResolution(display) ?? null) : null);
  const resolution = useMemo(
    () => (JSON.parse(resolutionKey) as ReturnType<typeof displayResolution> | null) ?? undefined,
    [resolutionKey],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let instance: GameInstance | null = null;
    let mounted = true;

    async function init() {
      if (!canvas || !mounted) return;

      const [debug, debugLayers] = import.meta.env.DEV
        ? await Promise.all([
            import("@jams/engine/debug").then((m) => m.createDebugOverlay),
            import("@/games/platformer/debug").then((m) => m.PLATFORMER_DEBUG_LAYERS),
          ])
        : [undefined, undefined];
      if (!mounted) return;
      const created = await createGame(canvas, {
        game: platformerGame,
        registry: SCENE_REGISTRY,
        displayWidth: window.innerWidth,
        displayHeight: window.innerHeight,
        dev: import.meta.env.DEV,
        debug,
        debugLayers,
        rapier: loadRapier,
        // The page is the game: debug keys work with focus fallen to the body,
        // while play input still needs the canvas focused.
        keyTarget: window,
        prefabs: BUNDLED_PREFABS,
        scene: BUNDLED_SCENE,
        ...(resolution ? { resolution } : {}),
      });

      if (!mounted) {
        created.destroy();
        return;
      }

      instance = created;
      setGame(created);
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
      setGame(null);
    };
  }, [resolution]);

  return (
    <CanvasShell
      topLeft={
        <GameSiteIsland
          title={roomId}
          display={displayMenu ? { value: display, onChange: setDisplay } : undefined}
        />
      }
      status={game ? <GameHUD store={game.getStore()} /> : undefined}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full bg-[#1a1a2e] outline-none"
        style={{ touchAction: "none" }}
      />
    </CanvasShell>
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
