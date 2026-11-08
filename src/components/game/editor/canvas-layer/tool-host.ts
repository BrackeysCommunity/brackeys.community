import type { GameInstance, Vec2 } from "@jams/engine";
import type { ProjectSession } from "@jams/engine/collab";
import {
  createToolHost,
  DEFAULT_SNAP,
  SNAP_STEPS,
  type EditorSession,
  type EditorToolDef,
  type PreviewRuntime,
  type Pt,
  type SnapSettings,
  type ToolHost,
} from "@jams/engine/editor";
import { assetInfo } from "@jams/engine/project";
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useCallback, useEffect, useReducer, useSyncExternalStore } from "react";

import { toast } from "@/lib/toast";

import { viewScale } from "./view";

/** What the tool host needs from the game: its router, camera and edit world. */
export type ToolHostGame = Pick<
  GameInstance,
  "registry" | "router" | "getStore" | "screenToWorld" | "panBy" | "zoomAt" | "frame" | "runtime"
>;

/** The live tool host, shared by the dock, the keys and the canvas layer; null until it's up. */
export type ToolHostCell = Store<ToolHost | null>;

export const createToolHostCell = (): ToolHostCell => new Store<ToolHost | null>(null);

const hostToWorlds = new WeakMap<ToolHost, (screen: Vec2) => Pt>();

/**
 * The screen-to-world conversion `host` routes its pointer through (the
 * game's own `screenToWorld`), for canvas input that doesn't pass through
 * the router, such as a drop. `screen` is in px from the canvas's top left.
 */
export const hostToWorld = (host: ToolHost): ((screen: Vec2) => Pt) | null =>
  hostToWorlds.get(host) ?? null;

const SNAP_KEY = "game-editor:snap";

/** This viewer's snap settings: on/off and the grid step, over the defaults. */
export function readSnap(): SnapSettings {
  try {
    const raw = window.localStorage.getItem(SNAP_KEY);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved !== "object") return DEFAULT_SNAP;
    const { enabled, step } = saved as Partial<SnapSettings>;
    return {
      ...DEFAULT_SNAP,
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      ...((SNAP_STEPS as readonly unknown[]).includes(step) ? { step } : {}),
    };
  } catch {
    return DEFAULT_SNAP;
  }
}

function writeSnap({ enabled, step }: SnapSettings) {
  try {
    window.localStorage.setItem(SNAP_KEY, JSON.stringify({ enabled, step }));
  } catch {
    // Storage can be unavailable (private windows, blocked site data); snap settings are a convenience.
  }
}

/** The edit world as the host previews into it; `loadScene` replaces the runtime, so it's looked up each time. */
function previewRuntime(game: Pick<GameInstance, "runtime">): PreviewRuntime {
  return {
    update: (entities) => game.runtime()?.update(entities),
    add: (entities) => game.runtime()?.add(entities),
    remove: (ids) => game.runtime()?.remove(ids),
  };
}

/**
 * Runs one tool host for `session` on `game` while mounted and publishes it
 * in `cell`. The game's own tools load first (a dynamic import); if they
 * fail to load, the engine's tools still run. With `project`, sprite boxes
 * are sized from its assets and re-indexed when the project doc changes.
 */
export function useToolHostLifecycle(
  cell: ToolHostCell,
  session: EditorSession,
  game: ToolHostGame,
  project?: ProjectSession | null,
): void {
  useEffect(() => {
    let host: ToolHost | null = null;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    let view = project?.view() ?? null;
    const onProjectUpdate = () => {
      if (!project) return;
      view = project.view();
      host?.reindex();
    };
    project?.projectDoc.on("update", onProjectUpdate);

    const start = (gameTools: readonly EditorToolDef[]) => {
      if (cancelled) return;
      const toWorld = (screen: Vec2): Pt => {
        const { x, y } = game.screenToWorld(screen);
        return [x, y];
      };
      const next = createToolHost({
        session,
        router: game.router,
        toWorld,
        scale: () => viewScale(game.getStore().state.camera),
        runtime: previewRuntime(game),
        gameTools,
        snap: readSnap(),
        pan: ([x, y]) => game.panBy({ x, y }),
        zoomAt: ([x, y], factor) => game.zoomAt({ x, y }, factor),
        frame: (rect) => game.frame(rect),
        ...(project
          ? { asset: (id: string, frame?: string) => view && assetInfo(view, id, frame) }
          : {}),
      });
      hostToWorlds.set(next, toWorld);
      let saved = next.snap();
      unsubscribe = next.subscribe(() => {
        const snap = next.snap();
        if (snap.enabled === saved.enabled && snap.step === saved.step) return;
        saved = snap;
        writeSnap(snap);
      });
      host = next;
      cell.setState(() => next);
    };

    const load = game.registry.game?.editor?.tools;
    if (!load) start([]);
    else {
      load().then(start, (error: unknown) => {
        toast.error("The game's editor tools didn't load", {
          description: error instanceof Error ? error.message : undefined,
        });
        start([]);
      });
    }

    return () => {
      cancelled = true;
      project?.projectDoc.off("update", onProjectUpdate);
      unsubscribe?.();
      if (host && cell.state === host) cell.setState(() => null);
      host?.destroy();
    };
  }, [cell, session, game, project]);
}

export const useToolHost = (cell: ToolHostCell) => useStore(cell);

/**
 * A value read from the host, re-read whenever it changes; `fallback`
 * without a host. `read` must return a primitive or an object the host
 * keeps (`snap()`), not a fresh one per call (`overlay()`).
 */
export function useHostValue<T>(
  host: ToolHost | null,
  read: (host: ToolHost) => T,
  fallback: T,
): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const off = host?.subscribe(onChange);
      return () => {
        off?.();
      };
    },
    [host],
  );
  return useSyncExternalStore(
    subscribe,
    () => (host ? read(host) : fallback),
    () => fallback,
  );
}

/** Re-renders on every change the host announces; for reads that build a fresh value (`overlay()`). */
export function useHostChanges(host: ToolHost | null): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!host) return;
    const off = host.subscribe(bump);
    return () => {
      off();
    };
  }, [host]);
}
