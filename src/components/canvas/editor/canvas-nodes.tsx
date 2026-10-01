import {
  BaseEdge,
  type EdgeProps,
  Handle,
  NodeResizer,
  type NodeProps,
  Position,
} from "@xyflow/react";
import { createContext, memo, use, useState } from "react";
import { createPortal } from "react-dom";

import { curvedEdge, type EdgeDrawing, type EdgeEnd } from "@/lib/canvas/edge-route";
import type { CanvasSide } from "@/lib/canvas/json-canvas";
import { cn } from "@/lib/utils";

import {
  CARD_SURFACE,
  CardBody,
  cardSizeLimits,
  type CanvasCard,
  ratioStepAllowed,
  EDGE_WIDTH,
  GROUP_LABEL_SLOT,
  GROUP_SURFACE,
  cardColorStyle,
  type CanvasDetailLevel,
  GroupLabel,
} from "../canvas-cards";
import type { CanvasAttachmentMap } from "../canvas-queries";
import type { CanvasFlowEdge, CanvasFlowNode } from "./canvas-doc";
import { CardTextEditor } from "./CardTextEditor";

export interface CanvasEditorContextValue {
  detail: CanvasDetailLevel;
  attachments: CanvasAttachmentMap;
  readOnly: boolean;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onResizeStart: () => void;
  onResizeEnd: (id: string, box: { x: number; y: number; width: number; height: number }) => void;
  onLabelChange: (kind: "node" | "edge", id: string, label: string) => void;
  /** The group or edge whose label is being typed. */
  labelEditId: string | null;
  setLabelEditId: (id: string | null) => void;
  /**
   * React Flow's `.react-flow__edgelabel-renderer`, found once. Its own
   * `EdgeLabelRenderer` re-queries the DOM for it from a store selector in
   * every edge on every store update, which dominates frame time once a
   * zoomed-out canvas has a thousand edges on screen.
   */
  labelLayer: HTMLElement | null;
  /** A connection routed from where its cards are on screen, for ends mid-drag. */
  liveDrawing: (source: string, target: string, start: EdgeEnd, end: EdgeEnd) => EdgeDrawing | null;
}

export const CanvasEditorContext = createContext<CanvasEditorContextValue | null>(null);

function useEditor(): CanvasEditorContextValue {
  const value = use(CanvasEditorContext);
  if (!value) throw new Error("Canvas nodes render inside CanvasEditorContext.");
  return value;
}

const HANDLES = [
  ["top", Position.Top],
  ["right", Position.Right],
  ["bottom", Position.Bottom],
  ["left", Position.Left],
] as const;

/** Handles are 12px (`size-3`) and centred on the border, so React Flow's edge ends sit this far out. */
const HANDLE_OVERHANG = 6;

/** One handle per side, each both a source and a target, named as JSON Canvas names sides. */
function SideHandles({ visible }: { visible: boolean }) {
  return HANDLES.map(([id, position]) => (
    <Handle
      key={id}
      id={id}
      type="source"
      position={position}
      className={cn(
        "!size-3 !border-2 !border-background !bg-primary transition-opacity",
        visible ? "opacity-100" : "opacity-0 group-hover/card:opacity-100",
      )}
    />
  ));
}

function Resizer({ id, selected, card }: { id: string; selected: boolean; card: CanvasCard }) {
  const { readOnly, onResizeStart, onResizeEnd } = useEditor();
  if (readOnly) return null;
  const limits = cardSizeLimits(card);
  return (
    <NodeResizer
      isVisible={selected}
      minWidth={limits.minWidth}
      minHeight={limits.minHeight}
      shouldResize={(_, next) =>
        ratioStepAllowed(limits.ratio, { w: card.w, h: card.h }, { w: next.width, h: next.height })
      }
      lineClassName="!border-primary"
      handleClassName="!size-2.5 !rounded-sm !border-primary !bg-background"
      onResizeStart={onResizeStart}
      onResizeEnd={(_, params) => onResizeEnd(id, params)}
    />
  );
}

const CardNode = memo(function CardNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<CanvasFlowNode>) {
  const { detail, attachments, readOnly, editingId, setEditingId } = useEditor();
  const { card, ytext } = data;
  const editing = editingId === id && ytext != null && !readOnly;

  return (
    <div
      className="group/card h-full w-full"
      style={cardColorStyle(card.color)}
      onDoubleClick={(e) => {
        if (readOnly || card.type !== "text" || !ytext) return;
        e.stopPropagation();
        setEditingId(id);
      }}
    >
      <Resizer id={id} selected={selected} card={card} />
      <div
        className={cn(
          CARD_SURFACE,
          selected && "ring-2 ring-primary/70",
          editing && "ring-2 ring-primary",
        )}
      >
        {editing ? (
          <CardTextEditor text={ytext} onDone={() => setEditingId(null)} />
        ) : (
          <CardBody
            card={card}
            detail={detail}
            attachments={attachments}
            size={{ w: width ?? card.w, h: height ?? card.h }}
            scrollable={selected}
          />
        )}
      </div>
      {readOnly ? null : <SideHandles visible={selected} />}
    </div>
  );
});

function InlineLabel({
  value,
  placeholder,
  onCommit,
  className,
}: {
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      // oxlint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      value={draft}
      placeholder={placeholder}
      maxLength={500}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(draft.trim());
        if (e.key === "Escape") onCommit(value);
        e.stopPropagation();
      }}
      className={cn(
        "nodrag nokey rounded-sm border border-primary bg-background px-1 text-sm outline-none",
        className,
      )}
    />
  );
}

const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const { readOnly, onLabelChange, labelEditId, setLabelEditId } = useEditor();
  const renaming = labelEditId === id;
  const { card } = data;

  return (
    <div
      className="group/card h-full w-full"
      style={cardColorStyle(card.color)}
      onDoubleClick={(e) => {
        // The label renames; the rest of the box falls through to the
        // editor, which adds a text card there as it does on bare canvas.
        if (readOnly || !(e.target as HTMLElement).closest("[data-group-label]")) return;
        e.stopPropagation();
        setLabelEditId(id);
      }}
    >
      <Resizer id={id} selected={selected} card={card} />
      <div data-group-surface="" className={cn(GROUP_SURFACE, selected && "border-primary")}>
        {renaming ? (
          <div className={GROUP_LABEL_SLOT}>
            <InlineLabel
              value={card.label ?? ""}
              placeholder="Group name"
              onCommit={(label) => {
                setLabelEditId(null);
                if (label !== (card.label ?? "")) onLabelChange("node", id, label);
              }}
            />
          </div>
        ) : (
          <GroupLabel label={card.label} />
        )}
      </div>
      {readOnly ? null : <SideHandles visible={selected} />}
    </div>
  );
});

const CanvasEdge = memo(function CanvasEdge(props: EdgeProps<CanvasFlowEdge>) {
  const { detail, readOnly, onLabelChange, labelLayer, labelEditId, setLabelEditId, liveDrawing } =
    useEditor();
  const editing = labelEditId === props.id;
  const start = cardEnd(props.sourceX, props.sourceY, props.sourcePosition);
  const end = cardEnd(props.targetX, props.targetY, props.targetPosition);
  // A route holds while both ends sit where the doc says; a card mid-drag
  // is ahead of the doc, so its routed connections route from the screen.
  const drawing = props.data?.drawing;
  const {
    d: path,
    label: [labelX, labelY],
  } =
    !drawing || detail === "blocks"
      ? curvedEdge(start, end)
      : sameEnd(drawing.anchors[0], start) && sameEnd(drawing.anchors[1], end)
        ? drawing
        : (liveDrawing(props.source, props.target, start, end) ?? curvedEdge(start, end));
  const label = props.data?.label;

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        markerStart={props.markerStart}
        style={
          props.selected
            ? { ...props.style, stroke: "var(--primary)", strokeWidth: EDGE_WIDTH + 1 }
            : props.style
        }
        interactionWidth={16}
      />
      {labelLayer && (label || editing || (props.selected && !readOnly))
        ? createPortal(
            <div
              className="nodrag nopan pointer-events-auto absolute"
              style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
              onDoubleClick={() => !readOnly && setLabelEditId(props.id)}
            >
              {editing ? (
                <InlineLabel
                  value={label ?? ""}
                  placeholder="Label"
                  onCommit={(next) => {
                    setLabelEditId(null);
                    if (next !== (label ?? "")) onLabelChange("edge", props.id, next);
                  }}
                />
              ) : label ? (
                <span className="rounded-sm bg-background px-1.5 py-0.5 text-xs text-foreground shadow-sm">
                  {label}
                </span>
              ) : props.selected && !readOnly ? (
                <span className="rounded-sm bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
                  Double-click to label
                </span>
              ) : null}
            </div>,
            labelLayer,
          )
        : null}
    </>
  );
});

const OUTWARD: Record<CanvasSide, [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

/** Where an edge meets its card: React Flow's handle point, brought back to the border. */
function cardEnd(x: number, y: number, position: Position): EdgeEnd {
  const side = position as CanvasSide;
  const [nx, ny] = OUTWARD[side];
  return { x: x - nx * HANDLE_OVERHANG, y: y - ny * HANDLE_OVERHANG, side };
}

function sameEnd(a: EdgeEnd, b: EdgeEnd): boolean {
  return a.side === b.side && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

export const NODE_TYPES = {
  text: CardNode,
  file: CardNode,
  link: CardNode,
  image: CardNode,
  entity: CardNode,
  canvasGroup: GroupNode,
};

export const EDGE_TYPES = { canvas: CanvasEdge };
