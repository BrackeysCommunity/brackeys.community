import type { Store } from "@tanstack/store";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  dropBatch,
  dropPreview,
  setHover,
  type AssetDrop,
  type DropPreview,
  type EditorSession,
  type Pt,
  type ToolHost,
  type ToolOverlay,
} from "../../../editor/index";
import { pxPerMetreOf } from "../../../game/units";
import type { GameStoreState } from "../../../index";
import type { EditorNotify } from "../../host";
import { Button, useKit } from "../../kit/index";
import { runOverlay, type LoadedRun } from "../../session/loaded-run";
import { useStoreValue } from "../../session/use-store-value";
import { carriesAsset, readAssetDrag } from "../project-tree/tree-rows";
import { BehaviorMarks, ColliderOutlines } from "./BehaviorMarks";
import {
  EditLayerNotes,
  EditLayers,
  useEditLayerDrawing,
  useEditLayers,
  useExpandedScene,
} from "./EditLayers";
import { OneWayMarks } from "./OneWayMarks";
import { RunMarks } from "./RunMarks";
import { hostAsset, hostToWorld, useHostOverlay, useHostValue } from "./tool-host";
import { ToolOverlayLabels, ToolOverlayMarks } from "./ToolOverlayLayer";
import { num, toScreen, useView, worldTransform } from "./view";

/** Screen px between the selection's bottom edge and the offer button. */
const OFFER_GAP_PX = 16;

/**
 * The canvas's input surface while editing: the tool host's cursor on it,
 * wheel turns kept from scrolling or zooming the page, the pointer
 * captured for a press, so a drag released off the canvas still ends there,
 * and the shared hover cleared when the pointer leaves it between gestures.
 */
function useCanvasInput(
  session: EditorSession,
  host: ToolHost | null,
  canvas: (() => HTMLElement | null) | undefined,
) {
  const cursor = useHostValue(host, (h) => h.cursor(), undefined);
  useEffect(() => {
    const el = canvas?.();
    if (!el) return;
    el.style.cursor = cursor ?? "";
    return () => {
      el.style.cursor = "";
    };
  }, [canvas, cursor]);

  useEffect(() => {
    const el = canvas?.();
    if (!el) return;
    const onWheel = (e: WheelEvent) => e.preventDefault();
    const onDown = (e: PointerEvent) => {
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        // A synthetic or already-released pointer can't be captured; the drag still works over the canvas.
      }
    };
    const onLeave = () => {
      if (host?.keyContext().gesture) return;
      setHover(session.store, null);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [canvas, session, host]);
}

/**
 * The asset a drag from the project tree carries. A browser hides a drag's
 * data until the drop, so it is read when the drag starts and kept until it
 * ends; a drag whose data is readable over the canvas is read there.
 */
function useDraggedAsset(): () => AssetDrop | null {
  const carried = useRef<AssetDrop | null>(null);
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      carried.current = carriesAsset(e.dataTransfer) ? readAssetDrag(e.dataTransfer) : null;
    };
    const onEnd = () => {
      carried.current = null;
    };
    document.addEventListener("dragstart", onStart);
    document.addEventListener("dragend", onEnd);
    document.addEventListener("drop", onEnd);
    return () => {
      document.removeEventListener("dragstart", onStart);
      document.removeEventListener("dragend", onEnd);
      document.removeEventListener("drop", onEnd);
    };
  }, []);
  return () => carried.current;
}

/**
 * The canvas as the project tree's drop target: while an asset row is
 * dragged over it, the ghost of what it would place follows the pointer,
 * snapped, and says why when it would be refused; dropped, it is placed at
 * the drop point in one batch (one undo step), through the same
 * screen-to-world conversion as the host's pointer, and sounds the `drop`
 * cue. A kind that can't be placed says so through `notify`. Returns the
 * ghost to draw, `null` with no drag over the canvas.
 */
function useAssetDrop(
  session: EditorSession,
  host: ToolHost | null,
  canvas: (() => HTMLElement | null) | undefined,
  notify: EditorNotify,
): DropPreview | null {
  const { cue } = useKit();
  const [ghost, setGhost] = useState<DropPreview | null>(null);
  const dragged = useDraggedAsset();
  const latest = useRef({ session, host, notify, cue, dragged });
  useEffect(() => {
    latest.current = { session, host, notify, cue, dragged };
  });
  useEffect(() => {
    const el = canvas?.();
    if (!el) return;
    /** The world point under a drag event, or null without a host. */
    const worldOf = (e: DragEvent): Pt | null => {
      const toWorld = latest.current.host && hostToWorld(latest.current.host);
      if (!toWorld || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return null;
      const rect = el.getBoundingClientRect();
      return toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    let shown: string | null = null;
    const clear = () => {
      shown = null;
      setGhost(null);
    };
    const onOver = (e: DragEvent) => {
      if (!carriesAsset(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      const { session: s, host: h, dragged: carried } = latest.current;
      const drop = readAssetDrag(e.dataTransfer) ?? carried();
      const at = worldOf(e);
      if (!drop || !at || !h) return;
      const ppm = pxPerMetreOf(s.registry);
      const key = `${drop.entry.id}\n${drop.frame ?? ""}\n${Math.round(at[0] * ppm)},${Math.round(at[1] * ppm)}`;
      if (shown === key) return;
      shown = key;
      const asset = hostAsset(h);
      setGhost(
        dropPreview(drop, at, {
          def: s.getDoc(),
          registry: s.registry,
          prefabs: s.getPrefabs(),
          snap: h.snap(),
          ...(asset ? { asset } : {}),
        }),
      );
    };
    const onLeave = (e: DragEvent) => {
      if (e.target === el) clear();
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesAsset(e.dataTransfer)) return;
      e.preventDefault();
      clear();
      const { session: s, host: h, notify: say, cue: sound, dragged: carried } = latest.current;
      const drop = readAssetDrag(e.dataTransfer) ?? carried();
      const at = worldOf(e);
      if (!drop || !h || !at) return;
      const result = dropBatch(drop, at, {
        def: s.getDoc(),
        registry: s.registry,
        prefabs: s.getPrefabs(),
        snap: h.snap(),
      });
      if (!result.ok) {
        say(result.issues[0]?.message ?? `${drop.entry.id} can't be placed in a scene`);
        return;
      }
      const applied = s.dispatch(result.batch, { selectionAfter: result.select });
      if (applied.ok) sound("drop");
      else say.error(applied.issue.message);
    };
    el.addEventListener("dragover", onOver);
    el.addEventListener("dragleave", onLeave);
    el.addEventListener("drop", onDrop);
    document.addEventListener("dragend", clear);
    return () => {
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("dragleave", onLeave);
      el.removeEventListener("drop", onDrop);
      document.removeEventListener("dragend", clear);
    };
  }, [canvas]);
  return ghost;
}

/** The host's overlay with a drag's ghost added. */
function withDropGhost(overlay: ToolOverlay, ghost: DropPreview | null): ToolOverlay {
  if (!ghost) return overlay;
  return {
    ...overlay,
    ghosts: [...(overlay.ghosts ?? []), ...ghost.ghosts],
    ...(ghost.points ? { points: [...(overlay.points ?? []), ...ghost.points] } : {}),
  };
}

/**
 * The editor's layer over the game canvas, in edit mode: the tool host's
 * overlay (selection outlines as previewed, handles, the marquee, guides,
 * paths, placement ghosts and the drag readout), the View menu's grid,
 * occupancy, nav and collider-outline layers, one-way solids'
 * landing faces, the selected entity's behavior gizmo (collider, joint,
 * path, force, spawn), a loaded run, and
 * the fix the host offers after a commit. Only the offer takes the pointer;
 * assets dragged from the project tree drop on the canvas beneath.
 */
export function CanvasLayer({
  session,
  host,
  store,
  runStore,
  canvas,
  notify,
}: {
  session: EditorSession;
  host: ToolHost | null;
  store: Store<GameStoreState>;
  /** The loaded run, drawn under the tools' overlay. */
  runStore: Store<LoadedRun | null>;
  canvas?: () => HTMLElement | null;
  /** Where a drop that can't be placed is explained. */
  notify: EditorNotify;
}) {
  const view = useView(store);
  const loaded = useStoreValue(runStore, (r) => r, Object.is);
  const run = useMemo(() => (loaded ? runOverlay(loaded) : null), [loaded]);
  // The host announces selection, hover and doc changes, including the panels'.
  const hostOverlay = useHostOverlay(host);
  useCanvasInput(session, host, canvas);
  const dropGhost = useAssetDrop(session, host, canvas, notify);
  const overlay = withDropGhost(hostOverlay, dropGhost);
  const transform = worldTransform(view);
  const scene = useExpandedScene(session);
  const step = useHostValue(host, (h) => h.snap().step, null);
  const layers = useEditLayerDrawing(session, scene, view, step);
  const [shown] = useEditLayers(session);

  let offerAt: [number, number] | null = null;
  if (host && overlay.offer) {
    const box = host.selectionBounds();
    offerAt = box
      ? toScreen(view, [(box.minX + box.maxX) / 2, box.maxY])
      : [view.width / 2, view.height - 120];
  }

  return (
    <div data-canvas-layer="" className="je-canvas-layer">
      <svg aria-hidden width={view.width} height={view.height} className="je-canvas-svg">
        <EditLayers drawing={layers} transform={transform} />
        {shown.colliders ? <ColliderOutlines session={session} transform={transform} /> : null}
        <OneWayMarks session={session} scene={scene} view={view} transform={transform} />
        {run ? <RunMarks overlay={run} view={view} transform={transform} /> : null}
        <BehaviorMarks session={session} view={view} transform={transform} overlay={overlay} />
        <ToolOverlayMarks overlay={overlay} view={view} transform={transform} />
      </svg>
      <ToolOverlayLabels overlay={overlay} view={view} />
      <EditLayerNotes drawing={layers} />
      {offerAt && overlay.offer ? (
        <div
          className="je-canvas-offer"
          style={{
            transform: `translate(${num(offerAt[0])}px, ${num(offerAt[1] + OFFER_GAP_PX)}px) translateX(-50%)`,
          }}
        >
          <Button size="sm" variant="secondary" onClick={() => host?.acceptOffer()}>
            {overlay.offer.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
