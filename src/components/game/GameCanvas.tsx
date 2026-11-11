import {
  browserRemapStore,
  createGame,
  mountUi,
  selectDebugMode,
  selectFPS,
  selectPhase,
  type GameInstance,
  type GameStoreState,
} from "@jams/engine";
import { scenePhysics } from "@jams/engine/scene";
import { useStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/store";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { CanvasShell, Island } from "@/components/canvas/shell/CanvasShell";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel } from "@/components/ui/typography";
import { useFlag } from "@/lib/hooks/use-flag";
import { toast } from "@/lib/toast";

import { displayResolution, useDisplaySetting } from "./display-menu";
import { EditorLoading } from "./editor-loading";
import { DEFAULT_GAME, hostedGame, type HostedGame, type HostedGameModules } from "./hosted-games";
import { GameSiteIsland } from "./site-island";

const loadRapier = () => import("@dimforge/rapier2d");

/** `null` in production builds, so the editor's chunks (and the provider) are never emitted there. */
const SiteSceneEditor = import.meta.env.DEV
  ? lazy(() => import("./editor-host").then((m) => ({ default: m.SiteSceneEditor })))
  : null;

type GameCanvasProps = {
  roomId: string;
  /** The hosted game the room plays, by project id; default the platformer. */
  gameId?: string;
  /** Opens the scene editor; dev builds only. */
  edit?: boolean;
  /** The project the editor opens, by id; default the platformer. */
  project?: string;
  /** The project scene the editor opens, by id or name; default the project's own. */
  scene?: string;
};

export function GameCanvas({
  roomId,
  gameId = DEFAULT_GAME,
  edit = false,
  project,
  scene,
}: GameCanvasProps) {
  if (edit && SiteSceneEditor) {
    return (
      <Suspense fallback={<EditorLoading roomId={roomId} />}>
        <SiteSceneEditor roomId={roomId} project={project} scene={scene} />
      </Suspense>
    );
  }
  const hosted = hostedGame(gameId);
  if (!hosted) return <NotFoundPage subject="Game" />;
  return <GameRoom key={hosted.id} roomId={roomId} hosted={hosted} />;
}

/** The hosted game's modules once they load; null until then, and after a failure the toast reports. */
function useHostedModules(hosted: HostedGame): HostedGameModules | null {
  const [modules, setModules] = useState<HostedGameModules | null>(null);
  useEffect(() => {
    let live = true;
    hosted.load().then(
      (loaded) => {
        if (live) setModules(loaded);
      },
      (error: unknown) => {
        if (!live) return;
        toast.error(`${hosted.name} couldn't load`, {
          description: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      live = false;
    };
  }, [hosted]);
  return modules;
}

/**
 * The game room as everyone plays it: the hosted game's first scene, with its
 * DOM UI over the canvas. Under the display menu's flag the viewer's choice
 * is the host's resolution policy, and a new choice rebuilds the game, since
 * the engine reads it once at creation.
 */
function GameRoom({ roomId, hosted }: { roomId: string; hosted: HostedGame }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modules = useHostedModules(hosted);
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
    if (!canvas || !modules) return;
    const { game: definition, registry, scene, prefabs } = modules;

    let instance: GameInstance | null = null;
    let mounted = true;

    async function init() {
      if (!canvas || !mounted) return;

      const [debug, debugLayers] = import.meta.env.DEV
        ? await Promise.all([
            import("@jams/engine/debug").then((m) => m.createDebugOverlay),
            hosted.debugLayers(),
          ])
        : [undefined, undefined];
      if (!mounted) return;
      const created = await createGame(canvas, {
        game: definition,
        registry,
        displayWidth: window.innerWidth,
        displayHeight: window.innerHeight,
        dev: import.meta.env.DEV,
        debug,
        debugLayers,
        ...(scenePhysics(scene, registry) === "rapier" ? { rapier: loadRapier } : {}),
        // The page is the game: debug keys work with focus fallen to the body,
        // while play input still needs the canvas focused.
        keyTarget: window,
        // A player's remaps stay in their own browser.
        input: { touch: "auto", remaps: browserRemapStore() },
        prefabs,
        scene,
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

    init().catch((error: unknown) => {
      if (!mounted) return;
      toast.error(`${hosted.name} couldn't start`, {
        description: error instanceof Error ? error.message : String(error),
      });
    });

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
  }, [modules, hosted, resolution]);

  const ui = modules?.ui ?? null;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!game || !ui || !canvas) return;
    return mountUi(game, canvas, ui);
  }, [game, ui]);

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
      {modules ? null : (
        <div role="status" aria-label={`Loading ${hosted.name}`} className="absolute inset-0 p-6">
          <Skeleton className="h-full w-full bg-white/5" />
        </div>
      )}
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
