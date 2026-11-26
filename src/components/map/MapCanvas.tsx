import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { Island } from "@/components/canvas/shell/CanvasShell";
import { MicroLabel, Text } from "@/components/ui/typography";
import { usePageVisible } from "@/lib/hooks/use-page-visible";

import type { MapTileView } from "../../../packages/mmo-api/src/index.ts";
import { ChunkCache, paint } from "../../../packages/mmo-map/src/draw.ts";
import {
  type Axial,
  buildFrame,
  type Camera,
  centreOn,
  fitRegions,
  type Frame,
  hexCentre,
  hexCorners,
  hexKey,
  pan,
  screenToHex,
  type View,
  worldToScreen,
  zoomAt,
} from "../../../packages/mmo-map/src/index.ts";
import { type TileContext, tileWords } from "./TilePanel";
import type { LiveMap } from "./use-live-map";

// structural: how gestures move the camera, and the backing store's limits.
const TAP_SLOP_PX = 8;
const WHEEL_RATE = 0.0015;
const KEY_PAN = 0.125;
const KEY_ZOOM = 1.25;
const FOCUS_ZOOM = 1.25;
const MAX_DPR = 2;
const CACHE_BITMAPS = 96;
const PICK_RIM_PX = 2;
const HOVER_OFFSET_PX = 14;
const HOVER_WIDTH_PX = 264;
const HOVER_HEIGHT_PX = 56;

export interface MapCanvasHandle {
  zoomBy(factor: number): void;
  /** The whole discovered world in view. */
  fit(): void;
  /** Centres on a tile, at least at tile zoom. */
  goTo(h: Axial): void;
}

interface Hover {
  key: string;
  x: number;
  y: number;
  tile: MapTileView;
}

/**
 * The live map on one canvas: pan by drag, zoom by wheel or pinch round the
 * pointer, arrows and +/- from the keyboard, and the tile under the pointer
 * on hover. It draws the frame the shared map module builds from what the
 * world sent, and nothing else.
 */
export function MapCanvas({
  map,
  picked,
  onPick,
  at,
  label,
  ref,
}: {
  map: LiveMap;
  picked: Axial | undefined;
  onPick: (h: Axial | undefined) => void;
  at: TileContext;
  label: string;
  ref?: React.Ref<MapCanvasHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const camera = useRef<Camera | undefined>(undefined);
  const view = useRef<View>({ width: 0, height: 0 });
  const frame = useRef<Frame | undefined>(undefined);
  const cache = useRef<ChunkCache | undefined>(undefined);
  const raf = useRef<number | undefined>(undefined);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const tap = useRef<{ x: number; y: number; moved: boolean } | undefined>(undefined);
  const visible = usePageVisible();
  const [hover, setHover] = useState<Hover | undefined>(undefined);

  // The draw reads the newest props without re-subscribing its listeners.
  const latest = useRef({ map, picked, visible });
  latest.current = { map, picked, visible };

  const draw = useCallback(() => {
    raf.current = undefined;
    const { map: m, picked: p, visible: shown } = latest.current;
    const c = camera.current;
    const el = canvas.current;
    const v = view.current;
    if (!shown || !c || !el || !m.index || !m.style || v.width <= 0 || v.height <= 0) return;
    frame.current = buildFrame({
      camera: c,
      view: v,
      index: m.index,
      regions: m.regions,
      chunks: m.chunks,
      overlay: m.overlay,
      layers: m.layers,
      style: m.style,
    });
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(v.width * dpr));
    const h = Math.max(1, Math.round(v.height * dpr));
    if (el.width !== w) el.width = w;
    if (el.height !== h) el.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cache.current ??= new ChunkCache(CACHE_BITMAPS);
    paint(ctx, frame.current, c, v, cache.current);
    if (p) {
      const w0 = hexCentre(p, 1);
      const s = worldToScreen(c, v, w0.x, w0.y);
      const corners = hexCorners(s, c.size);
      ctx.beginPath();
      corners.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.closePath();
      ctx.strokeStyle = m.style.opaque("ink");
      ctx.lineWidth = PICK_RIM_PX;
      ctx.stroke();
    }
  }, []);

  const schedule = useCallback(() => {
    if (raf.current !== undefined) return;
    raf.current = requestAnimationFrame(draw);
  }, [draw]);
  useEffect(
    () => () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current);
      raf.current = undefined;
    },
    [],
  );

  const move = useCallback(
    (c: Camera) => {
      camera.current = c;
      setHover(undefined);
      schedule();
      latest.current.map.moved(c);
    },
    [schedule],
  );

  // The first settled camera is where the view starts; after that the canvas leads.
  useEffect(() => {
    if (!camera.current && map.camera) {
      camera.current = map.camera;
      schedule();
    }
  }, [map.camera, schedule]);

  useEffect(schedule, [
    schedule,
    visible,
    picked,
    map.index,
    map.style,
    map.regions,
    map.chunks,
    map.overlay,
    map.layers,
  ]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      view.current = { width: r.width, height: r.height };
      if (r.width > 0 && r.height > 0) latest.current.map.resized(view.current);
      schedule();
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedule]);

  const pointAt = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  // Wheel zoom must cancel the page's scroll, which React's passive listener cannot.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const c = camera.current;
      const style = latest.current.map.style;
      if (!c || !style) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      move(zoomAt(c, Math.exp(-e.deltaY * WHEEL_RATE), p, view.current, style.view));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [move]);

  useImperativeHandle(
    ref,
    () => ({
      zoomBy(factor) {
        const c = camera.current;
        const style = latest.current.map.style;
        if (!c || !style) return;
        const v = view.current;
        move(zoomAt(c, factor, { x: v.width / 2, y: v.height / 2 }, v, style.view));
      },
      fit() {
        const { regions, style } = latest.current.map;
        if (!regions || !style) return;
        move(fitRegions(regions, view.current, style.view));
      },
      goTo(h) {
        const style = latest.current.map.style;
        if (!style) return;
        move(centreOn(h, Math.max(camera.current?.size ?? 0, style.view.zoomTile * FOCUS_ZOOM)));
      },
    }),
    [move],
  );

  const hoverAt = (p: { x: number; y: number }) => {
    const f = frame.current;
    const c = camera.current;
    if (!f || !c) return;
    const t = f.hit(p.x, p.y);
    if (!t) {
      setHover(undefined);
      return;
    }
    const key = hexKey(screenToHex(c, view.current, p.x, p.y));
    setHover((was) => (was?.key === key ? was : { key, x: p.x, y: p.y, tile: t }));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointAt(e);
    pointers.current.set(e.pointerId, p);
    tap.current = pointers.current.size === 1 ? { ...p, moved: false } : undefined;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer cannot be captured; the drag still works.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointAt(e);
    const was = pointers.current.get(e.pointerId);
    const c = camera.current;
    const style = latest.current.map.style;
    if (!was || !c || !style) {
      if (e.pointerType === "mouse") hoverAt(p);
      return;
    }
    const t = tap.current;
    if (t && Math.hypot(p.x - t.x, p.y - t.y) > TAP_SLOP_PX) t.moved = true;
    if (pointers.current.size === 1) {
      pointers.current.set(e.pointerId, p);
      move(pan(c, p.x - was.x, p.y - was.y));
      return;
    }
    // Two fingers: zoom by how far they spread, round their midpoint, and follow it.
    const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (!other) return;
    pointers.current.set(e.pointerId, p);
    const before = Math.hypot(was.x - other.x, was.y - other.y);
    const after = Math.hypot(p.x - other.x, p.y - other.y);
    const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
    const midWas = { x: (was.x + other.x) / 2, y: (was.y + other.y) / 2 };
    let next = pan(c, mid.x - midWas.x, mid.y - midWas.y);
    if (before > 0 && after > 0) next = zoomAt(next, after / before, mid, view.current, style.view);
    move(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const t = tap.current;
    tap.current = undefined;
    const c = camera.current;
    if (cancelled || !t || t.moved || pointers.current.size > 0 || !c) return;
    const p = pointAt(e);
    const h = screenToHex(c, view.current, p.x, p.y);
    onPick(frame.current?.hit(p.x, p.y) ? h : undefined);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const c = camera.current;
    const style = map.style;
    if (!c || !style) return;
    const v = view.current;
    const centre = { x: v.width / 2, y: v.height / 2 };
    const step = { x: v.width * KEY_PAN, y: v.height * KEY_PAN };
    const moves: Record<string, () => Camera> = {
      ArrowLeft: () => pan(c, step.x, 0),
      ArrowRight: () => pan(c, -step.x, 0),
      ArrowUp: () => pan(c, 0, step.y),
      ArrowDown: () => pan(c, 0, -step.y),
      "+": () => zoomAt(c, KEY_ZOOM, centre, v, style.view),
      "=": () => zoomAt(c, KEY_ZOOM, centre, v, style.view),
      "-": () => zoomAt(c, 1 / KEY_ZOOM, centre, v, style.view),
    };
    const go = moves[e.key];
    if (go) {
      e.preventDefault();
      move(go());
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const h = screenToHex(c, v, centre.x, centre.y);
      onPick(frame.current?.hit(centre.x, centre.y) ? h : undefined);
    } else if (e.key === "Escape") {
      onPick(undefined);
    }
  };

  const words = hover ? tileWords(hover.tile, at) : undefined;
  return (
    <div ref={host} className="absolute inset-0 overflow-hidden bg-background">
      <canvas
        ref={canvas}
        tabIndex={0}
        role="application"
        aria-roledescription="map"
        aria-label={label}
        aria-describedby="map-keys"
        className="block h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerUp(e)}
        onPointerCancel={(e) => onPointerUp(e, true)}
        onPointerLeave={() => setHover(undefined)}
        onKeyDown={onKeyDown}
      />
      <span id="map-keys" className="sr-only">
        Arrow keys pan, plus and minus zoom, Enter picks the tile in the middle, Escape lets it go.
      </span>
      {words ? (
        <Island
          region={false}
          aria-hidden
          className="pointer-events-none absolute z-10 max-w-64 flex-col items-start gap-0 px-2 py-1"
          style={{
            left: Math.min(hover!.x + HOVER_OFFSET_PX, view.current.width - HOVER_WIDTH_PX),
            top: Math.min(hover!.y + HOVER_OFFSET_PX, view.current.height - HOVER_HEIGHT_PX),
          }}
        >
          <Text as="span" size="sm" bold>
            {words.title}
          </Text>
          <MicroLabel as="span">{words.age ?? words.fogLine}</MicroLabel>
        </Island>
      ) : null}
    </div>
  );
}
