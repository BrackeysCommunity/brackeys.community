import { useMemo } from "react";
import type * as Y from "yjs";

import { docToJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";
import { toast } from "@/lib/toast";

import type { CanvasCard } from "../canvas-cards";
import { canvasOutline, outlineMarkdown } from "../outline";
import {
  addCard,
  bringToFront,
  deleteElements,
  sendToBack,
  setCardFields,
  setEdgeFields,
  type CanvasDocView,
  type CanvasFlowEdge,
} from "./canvas-doc";

export type AlignKind = "left" | "center" | "right" | "top" | "middle" | "bottom";

const GROUP_PADDING = 40;

/** The selection's nodes and the edges wholly inside it, as a JSON Canvas fragment. */
export function selectionFragment(doc: Y.Doc, ids: Set<string>): JsonCanvas {
  const full = docToJsonCanvas(doc);
  return {
    nodes: full.nodes.filter((n) => ids.has(n.id)),
    edges: full.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)),
  };
}

function bounds(cards: CanvasCard[]) {
  const x = Math.min(...cards.map((c) => c.x));
  const y = Math.min(...cards.map((c) => c.y));
  return {
    x,
    y,
    right: Math.max(...cards.map((c) => c.x + c.w)),
    bottom: Math.max(...cards.map((c) => c.y + c.h)),
  };
}

/**
 * Every action on the current selection, in one place, so the selection
 * bar, the inspector and the keyboard can't drift apart.
 */
export function useCanvasCommands({
  doc,
  view,
  cards,
  selectedIds,
  selectedEdges,
  insertFragment,
  onReplaceImage,
}: {
  doc: Y.Doc;
  view: CanvasDocView;
  cards: Map<string, CanvasCard>;
  selectedIds: string[];
  selectedEdges: CanvasFlowEdge[];
  insertFragment: (fragment: JsonCanvas, at: { x: number; y: number }) => void;
  onReplaceImage: (cardId: string, file: File) => void;
}) {
  return useMemo(() => {
    const selected = selectedIds
      .map((id) => cards.get(id))
      .filter((c): c is CanvasCard => c != null);

    const select = (ids: Set<string>) =>
      view.patchLocal((current) => current.map((n) => ({ ...n, selected: ids.has(n.id) })));

    return {
      selected,

      setColor: (color: string | undefined) => {
        setCardFields(doc, new Map(selectedIds.map((id) => [id, { color }])));
        for (const edge of selectedEdges) setEdgeFields(doc, edge.id, { color });
      },

      duplicate: () => {
        if (selected.length === 0) return;
        const first = selected[0]!;
        insertFragment(selectionFragment(doc, new Set(selectedIds)), {
          x: first.x + 30,
          y: first.y + 30,
        });
      },

      copyMarkdown: async () => {
        const ids = new Set(selectedIds);
        const edges = [...docToJsonCanvas(doc).edges]
          .filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
          .map((e) => ({ from: e.fromNode, to: e.toNode, label: e.label }));
        try {
          await navigator.clipboard.writeText(outlineMarkdown(canvasOutline(selected), edges));
        } catch {
          toast.error("Couldn't copy to the clipboard.");
          return;
        }
        toast.success("Copied as Markdown.");
      },

      bringToFront: () => bringToFront(doc, selectedIds),
      sendToBack: () => sendToBack(doc, selectedIds),

      remove: () => {
        deleteElements(
          doc,
          selectedIds,
          selectedEdges.map((e) => e.id),
        );
      },

      setUrl: (id: string, url: string) => {
        setCardFields(doc, new Map([[id, { url }]]));
      },

      replaceImage: onReplaceImage,

      setSize: (id: string, size: { w?: number; h?: number }) => {
        const fields: Record<string, number> = {};
        if (size.w != null && Number.isFinite(size.w)) fields.w = Math.max(40, Math.round(size.w));
        if (size.h != null && Number.isFinite(size.h)) fields.h = Math.max(30, Math.round(size.h));
        setCardFields(doc, new Map([[id, fields]]));
      },

      /** Wraps the selection in a new group, sent behind it. */
      groupSelection: () => {
        const inner = selected.filter((c) => c.type !== "group" || selected.length > 1);
        if (inner.length === 0) return;
        const box = bounds(inner);
        const id = addCard(doc, {
          type: "group",
          label: "Group",
          x: box.x - GROUP_PADDING,
          y: box.y - GROUP_PADDING * 1.5,
          w: box.right - box.x + GROUP_PADDING * 2,
          h: box.bottom - box.y + GROUP_PADDING * 2.5,
        });
        sendToBack(doc, [id]);
        select(new Set([id]));
      },

      align: (kind: AlignKind) => {
        if (selected.length < 2) return;
        const box = bounds(selected);
        const updates = new Map<string, Record<string, unknown>>();
        for (const c of selected) {
          const x = {
            left: box.x,
            center: Math.round((box.x + box.right) / 2 - c.w / 2),
            right: box.right - c.w,
          };
          const y = {
            top: box.y,
            middle: Math.round((box.y + box.bottom) / 2 - c.h / 2),
            bottom: box.bottom - c.h,
          };
          if (kind in x) updates.set(c.id, { x: x[kind as keyof typeof x] });
          else updates.set(c.id, { y: y[kind as keyof typeof y] });
        }
        setCardFields(doc, updates);
      },

      /** Even gaps between the cards along one axis, the outer two staying put. */
      distribute: (axis: "horizontal" | "vertical") => {
        if (selected.length < 3) return;
        const pos = axis === "horizontal" ? "x" : "y";
        const size = axis === "horizontal" ? "w" : "h";
        const sorted = [...selected].sort((a, b) => a[pos] - b[pos]);
        const first = sorted[0]!;
        const last = sorted[sorted.length - 1]!;
        const total = sorted.reduce((sum, c) => sum + c[size], 0);
        const gap = (last[pos] + last[size] - first[pos] - total) / (sorted.length - 1);
        const updates = new Map<string, Record<string, unknown>>();
        let at = first[pos];
        for (const c of sorted) {
          updates.set(c.id, { [pos]: Math.round(at) });
          at += c[size] + gap;
        }
        setCardFields(doc, updates);
      },

      setEdgeEnds: (id: string, ends: { fromEnd?: "none" | "arrow"; toEnd?: "none" | "arrow" }) => {
        // `toEnd` defaults to an arrow and `fromEnd` to none, so each default is left unwritten.
        const fields: Record<string, unknown> = {};
        if (ends.fromEnd) fields.fromEnd = ends.fromEnd === "arrow" ? "arrow" : undefined;
        if (ends.toEnd) fields.toEnd = ends.toEnd === "arrow" ? undefined : "none";
        setEdgeFields(doc, id, fields);
      },
    };
  }, [cards, doc, insertFragment, onReplaceImage, selectedEdges, selectedIds, view]);
}

export type CanvasCommands = ReturnType<typeof useCanvasCommands>;
