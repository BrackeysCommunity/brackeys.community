import {
  createGame,
  selectDebugMode,
  selectFPS,
  selectPhase,
  type GameInstance,
  type GameStoreState,
} from "@jams/engine";
import { expandScene } from "@jams/engine/scene";
import { useStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/store";
import { useEffect, useRef, useState } from "react";

import { MicroLabel } from "@/components/ui/typography";

import { getSceneDoc, onSceneFileChange, SCENE_NAME } from "./scene-source";
import { useSceneEditor } from "./use-scene-editor";

const SCENE_SOURCE = { get: getSceneDoc, subscribe: onSceneFileChange };

type GameCanvasProps = {
  roomId: string;
  /** Opens the scene editor; dev builds only. */
  edit?: boolean;
};

export function GameCanvas({ roomId, edit = false }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<GameInstance | null>(null);
  const editor = useSceneEditor({ game, source: SCENE_SOURCE, name: SCENE_NAME, enabled: edit });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let instance: GameInstance | null = null;
    let mounted = true;

    async function init() {
      if (!canvas || !mounted) return;

      // Display resolution = window size (Native mode).
      // A future settings UI can override with a fixed resolution.
      const debug = import.meta.env.DEV
        ? (await import("@jams/engine/debug")).createDebugOverlay
        : undefined;
      if (!mounted) return;
      instance = await createGame(canvas, {
        displayWidth: window.innerWidth,
        displayHeight: window.innerHeight,
        dev: import.meta.env.DEV,
        debug,
        rapier: () => import("@dimforge/rapier2d"),
        scene: expandScene(getSceneDoc()),
      });

      if (!mounted) {
        instance.destroy();
        return;
      }

      setGame(instance);
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
      setGame(null);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-[#1a1a2e]">
      <canvas ref={canvasRef} className="block h-full w-full" style={{ touchAction: "none" }} />
      {game && !editor && <GameHUD store={game.getStore()} roomId={roomId} />}
      {editor}
    </div>
  );
}

// ─── HUD overlay ─────────────────────────────────────────

function GameHUD({ store, roomId }: { store: Store<GameStoreState>; roomId: string }) {
  const phase = useStore(store, selectPhase);
  const fps = useStore(store, selectFPS);
  const debugMode = useStore(store, selectDebugMode);

  return (
    <div className="pointer-events-none fixed top-4 left-4 z-50 space-y-1 text-xs">
      <MicroLabel as="div" className="text-brand-yellow/80 uppercase">
        Room: {roomId}
      </MicroLabel>
      <div className="text-muted-foreground/60">
        {phase === "running" ? `${Math.round(fps)} FPS` : phase}
      </div>
      {import.meta.env.DEV && debugMode !== "off" && (
        <MicroLabel as="div" className="text-cyan-400/70 uppercase">
          Debug: {debugMode}
        </MicroLabel>
      )}
      <MicroLabel as="div" className="mt-2 text-muted-foreground/40">
        WASD / Arrow keys to move · Space to jump
        {import.meta.env.DEV && " · F3 debug overlay"}
      </MicroLabel>
    </div>
  );
}
