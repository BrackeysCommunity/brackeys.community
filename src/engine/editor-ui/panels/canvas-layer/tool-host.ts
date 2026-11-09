import { Store } from "@tanstack/store";
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";

import type { ProjectSession } from "../../../collab/index";
import {
  createToolHost,
  DEFAULT_SNAP,
  SNAP_STEPS,
  type EditorSession,
  type EditorToolDef,
  type Pt,
  type SnapSettings,
  type ToolHost,
  type ToolHostOptions,
  type ToolOverlay,
} from "../../../editor/index";
import type { GameInstance, Vec2 } from "../../../index";
import { assetInfo } from "../../../project/index";
import { frameInView } from "../../frame/visible-rect";
import { STORAGE_PREFIX, type EditorNotify, type EditorStorage } from "../../host";
import { useKit } from "../../kit/index";
import { useStoreValue } from "../../session/use-store-value";
import { viewScale } from "./view";

/**
 * What the tool host needs from the game: its router and camera. Drags
 * preview in the overlay only, never in the edit world.
 */
export type ToolHostGame = Pick<
  GameInstance,
  "registry" | "router" | "getStore" | "screenToWorld" | "panBy" | "zoomAt" | "frame"
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

type AssetLookup = NonNullable<ToolHostOptions["asset"]>;

const hostAssets = new WeakMap<ToolHost, AssetLookup>();

/**
 * The project asset lookup `host` sizes sprite boxes with, for previews
 * drawn outside it, such as a drop's ghost; undefined without a project.
 */
export const hostAsset = (host: ToolHost): AssetLookup | undefined => hostAssets.get(host);

export const SNAP_KEY = `${STORAGE_PREFIX}snap`;

/** This viewer's snap settings: on/off and the grid step, over the defaults. */
export function readSnap(storage: EditorStorage): SnapSettings {
  try {
    const raw = storage.get(SNAP_KEY);
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

function writeSnap(storage: EditorStorage, { enabled, step }: SnapSettings) {
  storage.set(SNAP_KEY, JSON.stringify({ enabled, step }));
}

/**
 * Runs one tool host for `session` on `game` while mounted and publishes it
 * in `cell`. The game's own tools load first (a dynamic import); if they
 * fail to load, the engine's tools still run, and `notify` says so. With
 * `project`, sprite boxes are sized from its assets and re-indexed when the
 * project doc changes. Snap settings are kept in the kit's storage.
 */
export function useToolHostLifecycle(
  cell: ToolHostCell,
  session: EditorSession,
  game: ToolHostGame,
  notify: Pick<EditorNotify, "error">,
  project?: ProjectSession | null,
): void {
  const { storage } = useKit();
  // Read when the host starts and when snap changes, so a new callback doesn't restart the host.
  const latest = useRef({ notify, storage });
  useEffect(() => {
    latest.current = { notify, storage };
  });
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
      const asset: AssetLookup | undefined = project
        ? (id, frame) => view && assetInfo(view, id, frame)
        : undefined;
      const next = createToolHost({
        session,
        router: game.router,
        toWorld,
        scale: () => viewScale(game.getStore().state.camera),
        gameTools,
        tool: session.store.state.tool,
        snap: readSnap(latest.current.storage),
        pan: ([x, y]) => game.panBy({ x, y }),
        zoomAt: ([x, y], factor) => game.zoomAt({ x, y }, factor),
        frame: (rect) => frameInView(game, rect),
        ...(asset ? { asset } : {}),
      });
      hostToWorlds.set(next, toWorld);
      if (asset) hostAssets.set(next, asset);
      let saved = next.snap();
      unsubscribe = next.subscribe(() => {
        const snap = next.snap();
        if (snap.enabled === saved.enabled && snap.step === saved.step) return;
        saved = snap;
        writeSnap(latest.current.storage, snap);
      });
      host = next;
      cell.setState(() => next);
    };

    const load = game.registry.game?.editor?.tools;
    if (!load) start([]);
    else {
      load().then(start, (error: unknown) => {
        latest.current.notify.error("The game's editor tools didn't load", {
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

const sameHost = (h: ToolHost | null) => h;

export const useToolHost = (cell: ToolHostCell) => useStoreValue(cell, sameHost, Object.is);

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

/**
 * Re-renders on every change the host announces, and returns a version that
 * moves with them. Pass the version to whatever reads the host, so a
 * compiler-memoized render reads it again.
 */
export function useHostChanges(host: ToolHost | null): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!host) return;
    const off = host.subscribe(bump);
    return () => {
      off();
    };
  }, [host]);
  return version;
}

const overlayAt = (host: ToolHost | null, _version: number): ToolOverlay => host?.overlay() ?? {};

/** The host's overlay, read again after every change the host announces. */
export function useHostOverlay(host: ToolHost | null): ToolOverlay {
  return overlayAt(host, useHostChanges(host));
}
