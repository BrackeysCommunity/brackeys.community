import type { GizmoHandle, OverlayTone, Pt, ToolOverlay } from "@jams/engine/editor";
import { aabb } from "@jams/engine/scene";

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

type ToneLook = { stroke: string; opacity?: number; dashed?: boolean };

const TONE: Record<OverlayTone, ToneLook> = {
  selected: { stroke: "var(--primary)" },
  hover: { stroke: "var(--primary)", opacity: 0.55 },
  invalid: { stroke: "var(--destructive)" },
  ghost: { stroke: "var(--primary)", opacity: 0.8, dashed: true },
  guide: { stroke: "var(--info)", dashed: true },
};

const strokeOf = (tone: OverlayTone, dashed?: boolean) => {
  const look = TONE[tone];
  return {
    stroke: look.stroke,
    strokeOpacity: look.opacity,
    strokeDasharray: dashed || look.dashed ? DASH : undefined,
  };
};

const SQUARE_HANDLES = new Set<GizmoHandle["kind"]>(["vertex", "resize", "move", "waypoint"]);

/** One handle in screen space: a square for points and edges, a circle for rotate and radius, a "+" to insert. */
function Handle({ handle, view }: { handle: GizmoHandle; view: View }) {
  const [x, y] = toScreen(view, handle.at);
  const fill = handle.active ? "var(--primary)" : "white";
  const common = {
    "data-handle": handle.kind,
    "data-handle-id": handle.id,
    stroke: "var(--primary)",
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
  if (SQUARE_HANDLES.has(handle.kind)) {
    const h = HANDLE_PX;
    return (
      <rect {...common} x={num(x - h / 2)} y={num(y - h / 2)} width={h} height={h} fill={fill} />
    );
  }
  return <circle {...common} cx={num(x)} cy={num(y)} r={HANDLE_PX / 2 + 0.5} fill={fill} />;
}

/** The world-space half: outlines, ghosts, the marquee, guides, paths and points. */
function WorldMarks({ overlay, view }: { overlay: ToolOverlay; view: View }) {
  const r = worldPx(view, POINT_RADIUS_PX);
  return (
    <g fill="none" strokeWidth={2}>
      {overlay.ghosts?.map((g, i) => {
        const color = g.valid ? "var(--primary)" : "var(--destructive)";
        return (
          <path
            key={`ghost-${i}`}
            data-ghost-shape={g.valid ? "valid" : "invalid"}
            d={shapePath(g.shape)}
            fill={color}
            fillOpacity={0.15}
            stroke={color}
            strokeDasharray={DASH}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {overlay.outlines?.map((o, i) => (
        <path
          key={`outline-${i}`}
          data-outline={o.tone}
          d={shapePath(o.shape)}
          {...strokeOf(o.tone)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {overlay.polylines?.map((p, i) => (
        <path
          key={`polyline-${i}`}
          data-polyline={p.closed ? "closed" : "open"}
          d={polylinePath(p.pts, p.closed)}
          {...strokeOf(p.tone, p.dashed)}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {overlay.guides?.map((g, i) => (
        <line
          key={`guide-${i}`}
          data-guide=""
          x1={g.from[0]}
          y1={g.from[1]}
          x2={g.to[0]}
          y2={g.to[1]}
          strokeWidth={1}
          {...strokeOf("guide")}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {overlay.points?.map((p, i) => (
        <circle
          key={`point-${i}`}
          data-point={p.tone}
          cx={p.at[0]}
          cy={p.at[1]}
          r={r}
          {...strokeOf(p.tone)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {overlay.marquee ? (
        <rect
          data-marquee={overlay.marquee.touch ? "touch" : "contain"}
          x={overlay.marquee.rect.minX}
          y={overlay.marquee.rect.minY}
          width={overlay.marquee.rect.maxX - overlay.marquee.rect.minX}
          height={overlay.marquee.rect.maxY - overlay.marquee.rect.minY}
          fill="var(--primary)"
          fillOpacity={0.08}
          stroke="var(--primary)"
          strokeWidth={1}
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

const TAG =
  "absolute top-0 left-0 rounded-md px-1.5 py-0.5 text-[11px] leading-tight whitespace-nowrap shadow-sm";

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
            className={`${TAG} bg-destructive font-medium text-white`}
            style={placed(view, [(box.minX + box.maxX) / 2, box.minY], 0, -24, true)}
          >
            {g.reason}
          </span>
        );
      })}
      {overlay.readout ? (
        <span
          data-readout=""
          className={`${TAG} bg-popover font-mono text-popover-foreground`}
          style={placed(view, overlay.readout.at, 14, 14)}
        >
          {overlay.readout.text}
        </span>
      ) : null}
    </>
  );
}
