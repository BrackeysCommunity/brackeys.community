import {
  browserRemapStore,
  createAssetLoader,
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
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CanvasShell, Island } from "@/components/canvas/shell/CanvasShell";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel } from "@/components/ui/typography";
import { useFlag } from "@/lib/hooks/use-flag";

import { displayResolution, useDisplaySetting } from "./display-menu";
import { EditorLoading } from "./editor-loading";
import {
  DEFAULT_GAME,
  hostedGame,
  useLoaded,
  type HostedGame,
  type HostedGameModules,
} from "./hosted-games";
import { LoadFailed } from "./load-failed";
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
  /** The project the editor opens, by id; default the hosted game `gameId` names, else the platformer. */
  project?: string;
  /** The project scene the editor opens, by id or name; default the project's own. */
  scene?: string;
};

export function GameCanvas({ roomId, gameId, edit = false, project, scene }: GameCanvasProps) {
  const hosted = hostedGame(gameId ?? DEFAULT_GAME);
  if (edit && SiteSceneEditor && (hosted || project !== undefined)) {
    const editing = project ?? gameId;
    return (
      <Suspense fallback={<EditorLoading roomId={roomId} />}>
        <SiteSceneEditor roomId={roomId} project={editing} scene={scene} />
      </Suspense>
    );
  }
  if (!hosted) return <NotFoundPage subject="Game" />;
  return <GameRoom key={hosted.id} roomId={roomId} hosted={hosted} />;
}

/**
 * The game room as everyone plays it: the hosted game's first scene, with its
 * DOM UI over the canvas. Under the display menu's flag the viewer's choice
 * is the host's resolution policy, and a new choice rebuilds the game, since
 * the engine reads it once at creation.
 */
function GameRoom({ roomId, hosted }: { roomId: string; hosted: HostedGame }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const load = useCallback(() => hosted.load(), [hosted]);
  const { value: modules, error: loadError, retry } = useLoaded<HostedGameModules>(load);
  const [game, setGame] = useState<GameInstance | null>(null);
  const [start, setStart] = useState<{ attempt: number; error: string | null }>({
    attempt: 0,
    error: null,
  });
  const retryStart = useCallback(
    () => setStart((s) => ({ attempt: s.attempt + 1, error: null })),
    [],
  );
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
    const { game: definition, registry, scene, prefabs, project, assets } = modules;

    let instance: GameInstance | null = null;
    let mounted = true;
    const loader = assets ? createAssetLoader({ project: hosted.id, url: assets.url }) : null;

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
        ...(scenePhysics(scene, registry, project.engine) === "rapier"
          ? { rapier: loadRapier }
          : {}),
        // The page is the game: debug keys work with focus fallen to the body,
        // while play input still needs the canvas focused.
        keyTarget: window,
        // A player's remaps stay in their own browser.
        input: { touch: "auto", remaps: browserRemapStore() },
        prefabs,
        scene,
        project,
        ...(assets && loader ? { assets: { loader, view: assets.view, kinds: assets.kinds } } : {}),
        ...(resolution ? { resolution } : {}),
      });

      if (!mounted) {
        created.destroy();
        return;
      }

      instance = created;
      setGame(created);
      setStart((s) => (s.error === null ? s : { ...s, error: null }));
      created.start();
    }

    init().catch((error: unknown) => {
      if (!mounted) return;
      const message = error instanceof Error ? error.message : String(error);
      setStart((s) => ({ ...s, error: message }));
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
      loader?.destroy();
      setGame(null);
    };
  }, [modules, hosted, resolution, start.attempt]);

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
      status={
        game ? (
          <GameHUD
            store={game.getStore()}
            clocked={(modules?.game.time?.kind ?? "fixed") === "fixed"}
          />
        ) : undefined
      }
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full bg-[#1a1a2e] outline-none"
        style={{ touchAction: "none" }}
      />
      {modules ? (
        start.error !== null ? (
          <LoadFailed
            title={`${hosted.name} couldn't start`}
            error={start.error}
            onRetry={retryStart}
          />
        ) : null
      ) : loadError !== null ? (
        <LoadFailed title={`${hosted.name} couldn't load`} error={loadError} onRetry={retry} />
      ) : (
        <div role="status" aria-label={`Loading ${hosted.name}`} className="absolute inset-0 p-6">
          <Skeleton className="h-full w-full bg-white/5" />
        </div>
      )}
    </CanvasShell>
  );
}

// ─── HUD overlay ─────────────────────────────────────────

/**
 * The room's status: the frame rate for a game on a fixed clock (a turns or
 * event game draws only when it wakes, so its rate says nothing), else the
 * phase while it isn't running; in dev builds, the debug mode and its key.
 * Nothing when there is nothing to say.
 */
function GameHUD({ store, clocked }: { store: Store<GameStoreState>; clocked: boolean }) {
  const phase = useStore(store, selectPhase);
  const fps = useStore(store, selectFPS);
  const debugMode = useStore(store, selectDebugMode);
  const reading = phase !== "running" ? phase : clocked ? `${Math.round(fps)} FPS` : null;
  if (reading === null && !import.meta.env.DEV) return null;

  return (
    <Island role="status" className="flex-col items-start gap-0.5 px-2.5 py-1.5 text-xs">
      {reading !== null && <span className="text-muted-foreground">{reading}</span>}
      {import.meta.env.DEV && debugMode !== "off" && (
        <MicroLabel as="span" className="text-cyan-400/70 uppercase">
          Debug: {debugMode}
        </MicroLabel>
      )}
      {import.meta.env.DEV && (
        <MicroLabel as="span" className="text-muted-foreground">
          F3 debug overlay
        </MicroLabel>
      )}
    </Island>
  );
}
