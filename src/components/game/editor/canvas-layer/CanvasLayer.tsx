import type { GameStoreState } from "@jams/engine";
import { dropBatch, type EditorSession, type ToolHost } from "@jams/engine/editor";
import { useStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/store";
import { useEffect, useMemo, useRef } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

import { runOverlay, type LoadedRun } from "../loaded-run";
import { carriesAsset, readAssetDrag } from "../project-tree/tree-rows";
import { useEditorDoc, useEditorStore } from "../use-editor-store";
import { RunMarks } from "./RunMarks";
import { hostToWorld, useHostChanges, useHostValue } from "./tool-host";
import { ToolOverlayLabels, ToolOverlayMarks } from "./ToolOverlayLayer";
import { num, toScreen, useView, worldTransform } from "./view";

/** Screen px between the selection's bottom edge and the offer button. */
const OFFER_GAP_PX = 16;

/**
 * The canvas's input surface while editing: the tool host's cursor on it,
 * wheel turns kept from scrolling or zooming the page, and the pointer
 * captured for a press, so a drag released off the canvas still ends there.
 */
function useCanvasInput(host: ToolHost | null, canvas: (() => HTMLElement | null) | undefined) {
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
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
    };
  }, [canvas]);
}

/**
 * The canvas as the project tree's drop target: an asset row dropped on it
 * is placed at the drop point, snapped as the tool host snaps, in one batch
 * (one undo step), through the same screen-to-world conversion as the
 * host's pointer. A kind that can't be placed says so in a toast.
 */
function useAssetDrop(
  session: EditorSession,
  host: ToolHost | null,
  canvas: (() => HTMLElement | null) | undefined,
) {
  const latest = useRef({ session, host });
  useEffect(() => {
    latest.current = { session, host };
  });
  useEffect(() => {
    const el = canvas?.();
    if (!el) return;
    const onOver = (e: DragEvent) => {
      if (!carriesAsset(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!carriesAsset(e.dataTransfer)) return;
      e.preventDefault();
      const drop = readAssetDrag(e.dataTransfer);
      if (!drop || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
      const { session: s, host: h } = latest.current;
      const toWorld = h && hostToWorld(h);
      if (!h || !toWorld) return;
      const rect = el.getBoundingClientRect();
      const at = toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      const result = dropBatch(drop, at, {
        def: s.getDoc(),
        registry: s.registry,
        prefabs: s.getPrefabs(),
        snap: h.snap(),
      });
      if (!result.ok) {
        toast(result.issues[0]?.message ?? `${drop.entry.id} can't be placed in a scene`);
        return;
      }
      const applied = s.dispatch(result.batch, { selectionAfter: result.select });
      if (!applied.ok) toast.error(applied.issue.message);
    };
    el.addEventListener("dragover", onOver);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onOver);
      el.removeEventListener("drop", onDrop);
    };
  }, [canvas]);
}

/**
 * The editor's layer over the game canvas, in edit mode: the tool host's
 * overlay (selection outlines as previewed, handles, the marquee, guides,
 * paths, placement ghosts and the drag readout), a loaded run, and the
 * fix the host offers after a commit. Only the offer takes the pointer;
 * assets dragged from the project tree drop on the canvas beneath.
 */
export function CanvasLayer({
  session,
  host,
  store,
  runStore,
  canvas,
}: {
  session: EditorSession;
  host: ToolHost | null;
  store: Store<GameStoreState>;
  /** The loaded run, drawn under the tools' overlay. */
  runStore: Store<LoadedRun | null>;
  canvas?: () => HTMLElement | null;
}) {
  const view = useView(store);
  const loaded = useStore(runStore);
  const run = useMemo(() => (loaded ? runOverlay(loaded) : null), [loaded]);
  useHostChanges(host);
  // The overlay draws the selection, which also changes from the panels.
  useEditorStore(session, (s) => s.selection);
  useEditorDoc(session);
  useCanvasInput(host, canvas);
  useAssetDrop(session, host, canvas);
  const overlay = host?.overlay() ?? {};
  const transform = worldTransform(view);

  let offerAt: [number, number] | null = null;
  if (host && overlay.offer) {
    const box = host.selectionBounds();
    offerAt = box
      ? toScreen(view, [(box.minX + box.maxX) / 2, box.maxY])
      : [view.width / 2, view.height - 120];
  }

  return (
    <div data-canvas-layer="" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <svg aria-hidden width={view.width} height={view.height} className="absolute inset-0">
        {run ? <RunMarks overlay={run} view={view} transform={transform} /> : null}
        <ToolOverlayMarks overlay={overlay} view={view} transform={transform} />
      </svg>
      <ToolOverlayLabels overlay={overlay} view={view} />
      {offerAt && overlay.offer ? (
        <div
          className="pointer-events-auto absolute top-0 left-0"
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
