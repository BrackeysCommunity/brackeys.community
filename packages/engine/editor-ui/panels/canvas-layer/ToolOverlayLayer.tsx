import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import type { Aabb, GizmoHandle, OverlayTone, Pt, ToolOverlay } from "../../../editor/index";
import { cssHex } from "../../../game/color";
import type { Style } from "../../../game/index";
import { aabb } from "../../../scene/index";
import { useIsomorphicLayoutEffect } from "../../kit/ssr";
import {
  num,
  POINT_RADIUS_PX,
  polylinePath,
  shapePath,
  toScreen,
  worldPx,
  type View,
} from "./view";

/** Handles keep this size on screen at any zoom. */
const HANDLE_PX = 8;
const DASH = "6 4";

const SQUARE_HANDLES: readonly GizmoHandle["kind"][] = ["vertex", "resize", "move", "waypoint"];

/** One handle in screen space: a square for points and edges, a circle for rotate and radius, a "+" to insert. */
function Handle({ handle, view }: { handle: GizmoHandle; view: View }) {
  const [x, y] = toScreen(view, handle.at);
  const fill = handle.active ? "var(--je-primary)" : "white";
  const common = {
    "data-handle": handle.kind,
    "data-handle-id": handle.id,
    stroke: "var(--je-primary)",
    strokeWidth: 1.5,
  };
  if (handle.kind === "insert") {
    const r = HANDLE_PX / 2;
    return (
      <g {...common}>
        <circle cx={num(x)} cy={num(y)} r={r + 1} fill="white" fillOpacity={0.85} />
        <path
          d={`M${num(x - r + 1)} ${num(y)}H${num(x + r - 1)}M${num(x)} ${num(y - r + 1)}V${num(y + r - 1)}`}
          fill="none"
        />
      </g>
    );
  }
  if (SQUARE_HANDLES.includes(handle.kind)) {
    const h = HANDLE_PX;
    return (
      <rect {...common} x={num(x - h / 2)} y={num(y - h / 2)} width={h} height={h} fill={fill} />
    );
  }
  return <circle {...common} cx={num(x)} cy={num(y)} r={HANDLE_PX / 2 + 0.5} fill={fill} />;
}

/** The line from the point a rotate handle turns about out to the handle, under the handles. */
function Stalk({ handle, view }: { handle: GizmoHandle; view: View }) {
  const [x0, y0] = toScreen(view, handle.stalk!);
  const [x1, y1] = toScreen(view, handle.at);
  return (
    <path
      data-stalk={handle.id}
      d={`M${num(x0)} ${num(y0)}L${num(x1)} ${num(y1)}`}
      stroke="var(--je-primary)"
      strokeWidth={1.5}
      fill="none"
    />
  );
}

/** A game template's colour for its ghost: its stroke, else its fill. */
function styleTone(style: Style | undefined): string | undefined {
  const c = style?.stroke ?? style?.fill;
  return c === undefined ? undefined : cssHex(c);
}

/** A rectangle's attributes in metres. */
const rectOf = (r: Aabb) => ({
  x: r.minX,
  y: r.minY,
  width: r.maxX - r.minX,
  height: r.maxY - r.minY,
});

/**
 * One outline, point, guide, placement ghost or path: a dark halo under the tone's stroke,
 * both a constant width on screen, so it reads over any art at any zoom.
 * Its look comes from the stylesheet by `data-tone`, and `data-preview`
 * fills a mark that shows a drag in progress.
 */
function Mark({
  kind,
  tone,
  of,
  candidate = false,
  preview = false,
  shape,
  dashed,
  closed,
  style,
  children,
}: {
  /** `placement` is a ghost about to be placed; `polyline` a path or pen stroke. */
  kind: "outline" | "point" | "guide" | "placement" | "polyline";
  tone: OverlayTone;
  /** The entity it belongs to. */
  of?: string | undefined;
  /** The marquee would select it. */
  candidate?: boolean;
  /** Where the drag in progress puts it. */
  preview?: boolean | undefined;
  /** The outline's shape type; an open chain is never filled. */
  shape?: string;
  /** A polyline drawn dashed: the pen's next segment, a path being replaced. */
  dashed?: boolean | undefined;
  closed?: boolean | undefined;
  style?: CSSProperties | undefined;
  /** The shape, drawn twice: once as the halo, once as the stroke. */
  children: (className: string) => ReactNode;
}) {
  return (
    <g
      className="je-ov-mark"
      {...{ [`data-${kind}`]: tone }}
      data-tone={tone}
      data-ref={of}
      data-candidate={candidate ? "" : undefined}
      data-preview={preview ? "" : undefined}
      data-shape={shape}
      data-dashed={dashed ? "" : undefined}
      data-closed={closed ? "" : undefined}
      style={style}
    >
      {children("je-ov-halo")}
      {children("je-ov-stroke")}
    </g>
  );
}

/** The world-space half: outlines, ghosts, the marquee, guides, paths and points. */
function WorldMarks({ overlay, view }: { overlay: ToolOverlay; view: View }) {
  const r = worldPx(view, POINT_RADIUS_PX);
  const hits = new Set(overlay.marquee?.hits ?? []);
  const candidate = (tone: OverlayTone, ref: string | undefined) =>
    tone === "hover" && ref !== undefined && hits.has(ref);
  return (
    <g fill="none" strokeWidth={2}>
      {overlay.ghosts?.map((g, i) => {
        const d = shapePath(g.shape);
        const tint = g.valid ? styleTone(g.style) : undefined;
        return (
          <Mark
            key={`ghost-${i}`}
            kind="placement"
            tone={g.valid ? "ghost" : "invalid"}
            shape={g.shape.type}
            style={tint ? ({ "--je-place-tone": tint } as CSSProperties) : undefined}
          >
            {(className) => <path className={className} d={d} vectorEffect="non-scaling-stroke" />}
          </Mark>
        );
      })}
      {overlay.bounds ? (
        <g className="je-ov-mark" data-bounds="">
          <rect
            className="je-ov-halo"
            {...rectOf(overlay.bounds)}
            vectorEffect="non-scaling-stroke"
          />
          <rect
            className="je-ov-stroke"
            {...rectOf(overlay.bounds)}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}
      {overlay.outlines?.map((o, i) => {
        const d = shapePath(o.shape);
        return (
          <Mark
            key={`outline-${i}`}
            kind="outline"
            tone={o.tone}
            of={o.ref}
            candidate={candidate(o.tone, o.ref)}
            preview={o.preview}
            shape={o.shape.type}
          >
            {(className) => <path className={className} d={d} vectorEffect="non-scaling-stroke" />}
          </Mark>
        );
      })}
      {overlay.polylines?.map((p, i) => {
        const d = polylinePath(p.pts, p.closed);
        const line = { fill: "none", strokeDasharray: p.dashed ? DASH : "none" };
        return (
          <Mark
            key={`polyline-${i}`}
            kind="polyline"
            tone={p.tone}
            dashed={p.dashed}
            closed={p.closed}
          >
            {(className) => (
              <path className={className} d={d} style={line} vectorEffect="non-scaling-stroke" />
            )}
          </Mark>
        );
      })}
      {overlay.guides?.map((g, i) => (
        <Mark key={`guide-${i}`} kind="guide" tone="guide">
          {(className) => (
            <line
              className={className}
              x1={g.from[0]}
              y1={g.from[1]}
              x2={g.to[0]}
              y2={g.to[1]}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </Mark>
      ))}
      {overlay.points?.map((p, i) => (
        <Mark
          key={`point-${i}`}
          kind="point"
          tone={p.tone}
          of={p.ref}
          candidate={candidate(p.tone, p.ref)}
          preview={p.preview}
        >
          {(className) => (
            <circle
              className={className}
              cx={p.at[0]}
              cy={p.at[1]}
              r={r}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </Mark>
      ))}
      {overlay.marquee ? (
        <rect
          className="je-ov-marquee"
          data-marquee={overlay.marquee.touch ? "touch" : "contain"}
          {...rectOf(overlay.marquee.rect)}
          strokeDasharray={overlay.marquee.touch ? DASH : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  );
}

/** The screen-space half: handles and waypoint numbers, at a constant size. */
function ScreenMarks({ overlay, view }: { overlay: ToolOverlay; view: View }) {
  const numbered = overlay.polylines?.filter((p) => p.numbered) ?? [];
  return (
    <g>
      {numbered.map((p, i) => (
        <g key={`numbers-${i}`} data-waypoints="">
          {p.pts.map((pt, n) => {
            const [x, y] = toScreen(view, pt);
            return (
              <text
                key={n}
                x={num(x + 7)}
                y={num(y - 7)}
                fontSize={11}
                fontWeight={600}
                fill="white"
                stroke="black"
                strokeOpacity={0.7}
                strokeWidth={3}
                paintOrder="stroke"
              >
                {n}
              </text>
            );
          })}
        </g>
      ))}
      {overlay.handles?.map((h) =>
        h.stalk ? <Stalk key={`stalk-${h.id}`} handle={h} view={view} /> : null,
      )}
      {overlay.handles?.map((h) => (
        <Handle key={h.id} handle={h} view={view} />
      ))}
    </g>
  );
}

/** The host's overlay drawn into an SVG the size of the canvas. */
export function ToolOverlayMarks({
  overlay,
  view,
  transform,
}: {
  overlay: ToolOverlay;
  view: View;
  /** The world group's transform. */
  transform: string;
}) {
  return (
    <>
      <g transform={transform}>
        <WorldMarks overlay={overlay} view={view} />
      </g>
      <ScreenMarks overlay={overlay} view={view} />
    </>
  );
}

/** Screen px a tag keeps from the edges of the canvas the chrome leaves visible. */
const TAG_MARGIN_PX = 8;
/** How long a readout's text holds before it is announced, so a drag's changing numbers aren't read on every move. */
const ANNOUNCE_SETTLE_MS = 300;

type Insets = { left: number; right: number; top: number; bottom: number };
const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

/** What the editor's chrome covers of the canvas: the safe area the frame gives a game's HUD; none outside a frame. */
function chromeInsets(el: Element): Insets {
  const doc = el.closest(".je-frame")?.querySelector(":scope > [data-je-document]");
  if (!doc) return NO_INSETS;
  const style = getComputedStyle(doc);
  const px = (side: keyof Insets) =>
    Number.parseFloat(style.getPropertyValue(`--jams-ui-safe-${side}`)) || 0;
  return { left: px("left"), right: px("right"), top: px("top"), bottom: px("bottom") };
}

/** `v` moved into [lo, hi]; to `lo` when the range is empty. */
const within = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * A tag at a world point, nudged by screen px (centred on it when `centred`)
 * and kept inside the visible canvas, so text about a selection that runs
 * off screen or under a panel still shows.
 */
function CanvasTag({
  view,
  at,
  dx,
  dy,
  centred = false,
  ...attrs
}: {
  view: View;
  at: Pt;
  dx: number;
  dy: number;
  centred?: boolean;
  className: string;
  children: ReactNode;
  [data: `data-${string}`]: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [sx, sy] = toScreen(view, at);
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const inset = chromeInsets(el);
    const x = within(
      sx + dx - (centred ? w / 2 : 0),
      inset.left + TAG_MARGIN_PX,
      view.width - inset.right - TAG_MARGIN_PX - w,
    );
    const y = within(
      sy + dy,
      inset.top + TAG_MARGIN_PX,
      view.height - inset.bottom - TAG_MARGIN_PX - h,
    );
    el.style.transform = `translate(${num(x)}px, ${num(y)}px)`;
  });
  return <span ref={ref} {...attrs} />;
}

/** `text` once it has held still for a moment; empty while there is none. */
function useSettled(text: string | undefined): string {
  const [settled, setSettled] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (text === undefined) return;
    const timer = setTimeout(() => setSettled(text), ANNOUNCE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return text !== undefined && settled === text ? text : "";
}

/**
 * Text over the canvas: the drag readout beside the cursor and why a ghost
 * can't be placed. The readout is also announced, since it carries why a
 * command did nothing.
 */
export function ToolOverlayLabels({ overlay, view }: { overlay: ToolOverlay; view: View }) {
  const announced = useSettled(overlay.readout?.text);
  return (
    <>
      {overlay.ghosts?.map((g, i) => {
        if (g.valid || !g.reason) return null;
        const box = aabb(g.shape);
        return (
          <CanvasTag
            key={`reason-${i}`}
            view={view}
            at={[(box.minX + box.maxX) / 2, box.minY]}
            dx={0}
            dy={-24}
            centred
            data-ghost-reason=""
            className="je-canvas-tag"
            data-tone="danger"
          >
            {g.reason}
          </CanvasTag>
        );
      })}
      {overlay.readout ? (
        <CanvasTag
          view={view}
          at={overlay.readout.at}
          dx={14}
          dy={14}
          data-readout=""
          className="je-canvas-tag"
          data-tone="readout"
        >
          {overlay.readout.text}
        </CanvasTag>
      ) : null}
      <span role="status" aria-live="polite" aria-atomic="true" className="je-sr-only">
        {announced}
      </span>
    </>
  );
}
