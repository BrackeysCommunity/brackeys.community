import type { CSSProperties, ReactNode } from "react";

import type { Aabb, GizmoHandle, OverlayTone, Pt, ToolOverlay } from "../../../editor/index";
import { cssHex } from "../../../game/color";
import type { Style } from "../../../game/index";
import { aabb } from "../../../scene/index";
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

/** Places a tag at a world point, nudged by screen px. */
const placed = (view: View, at: Pt, dx: number, dy: number, centred = false) => {
  const [x, y] = toScreen(view, at);
  return {
    transform: `translate(${num(x + dx)}px, ${num(y + dy)}px)${centred ? " translateX(-50%)" : ""}`,
  };
};

/** Text over the canvas: the drag readout beside the cursor and why a ghost can't be placed. */
export function ToolOverlayLabels({ overlay, view }: { overlay: ToolOverlay; view: View }) {
  return (
    <>
      {overlay.ghosts?.map((g, i) => {
        if (g.valid || !g.reason) return null;
        const box = aabb(g.shape);
        return (
          <span
            key={`reason-${i}`}
            data-ghost-reason=""
            className="je-canvas-tag"
            data-tone="danger"
            style={placed(view, [(box.minX + box.maxX) / 2, box.minY], 0, -24, true)}
          >
            {g.reason}
          </span>
        );
      })}
      {overlay.readout ? (
        <span
          data-readout=""
          className="je-canvas-tag"
          data-tone="readout"
          style={placed(view, overlay.readout.at, 14, 14)}
        >
          {overlay.readout.text}
        </span>
      ) : null}
    </>
  );
}
