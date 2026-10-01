import "@xyflow/react/dist/style.css";
import { SidebarRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  type Connection,
  MiniMap,
  type NodeChange,
  type EdgeChange,
  type OnConnectEnd,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useOnViewportChange,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as Y from "yjs";

import { Button } from "@/components/ui/button";
import { base64ToBytes } from "@/lib/canvas/encoding";
import {
  applyJsonCanvas,
  canvasEdges,
  canvasNodes,
  docToJsonCanvas,
  jsonCanvasSchema,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { postImageForm } from "@/lib/image-upload";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

import {
  CanvasLinksContext,
  cardSizeLimits,
  detailLevelFor,
  GRID_DOT,
  GRID_GAP,
  useCanvasLinks,
} from "../canvas-cards";
import type { CanvasAttachmentMap, CanvasDetail, CanvasScope } from "../canvas-queries";
import { ImageTooLargeError, prepareImage } from "../io/prepare-image";
import { canvasOutline, flattenOutline } from "../outline";
import { OutlinePanel } from "../OutlinePanel";
import { CanvasShell, Island } from "../shell/CanvasShell";
import {
  addCard,
  addEdge,
  CanvasDocView,
  cardsInside,
  deleteElements,
  LOCAL,
  SERVER,
  setCardFields,
  setEdgeFields,
  type CanvasFlowEdge,
  type CanvasFlowNode,
} from "./canvas-doc";
import {
  CanvasEditorContext,
  type CanvasEditorContextValue,
  EDGE_TYPES,
  NODE_TYPES,
} from "./canvas-nodes";
import { HistoryPanel } from "./HistoryPanel";
import { Inspector } from "./Inspector";
import { PlacementLayer, type Placement } from "./PlacementLayer";
import { SelectionBar } from "./SelectionBar";
import { type CanvasTool, TOOL_KEYS, ToolDock } from "./ToolDock";
import { selectionFragment, useCanvasCommands } from "./use-canvas-commands";
import { type SaveStatus, useCanvasSave } from "./use-canvas-save";
import { ZoomMenu } from "./ZoomMenu";

const DRAG_WRITE_MS = 50;
const NEW_CARD = { w: 260, h: 120 };
const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" } as const;
const NUDGE = 10;

const INSPECTOR_KEY = "brackeys:canvas-inspector";
const WIDE_QUERY = "(min-width: 1280px)";

export interface CanvasEditorHandle {
  status: SaveStatus;
  flush: () => Promise<void>;
  /** The canvas as it stands, for Export. */
  exportJson: () => JsonCanvas;
}

/** The page's own chrome, placed in the editor's shell. */
interface CanvasChrome {
  topLeft: React.ReactNode;
  /** Outline and History toggles, leading the top-right island. */
  toggles: React.ReactNode;
  status: React.ReactNode;
  /** The scope's files, for the Outline panel's Files tab. */
  files?: { scope: CanvasScope; currentId: string };
}

function rememberedInspector(): boolean {
  try {
    return window.localStorage.getItem(INSPECTOR_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

function rememberInspector(open: boolean) {
  try {
    window.localStorage.setItem(INSPECTOR_KEY, open ? "open" : "collapsed");
  } catch {
    // A blocked store just means the choice isn't remembered.
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest(".cm-editor, input, textarea, select, [contenteditable]") != null
  );
}

/** Menus, popovers and dialogs own Escape while focus is inside them. */
function inOverlay(): boolean {
  return (
    document.activeElement?.closest(
      '[role="menu"], [role="dialog"], [data-slot="popover-content"]',
    ) != null
  );
}

/** Loads the image to size a new card, capped to a sensible first size. */
function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      resolve({
        w: Math.round(img.naturalWidth * scale),
        h: Math.round(img.naturalHeight * scale),
      });
    };
    img.onerror = () => resolve({ w: 400, h: 300 });
    img.src = url;
  });
}

function parseCanvasText(text: string): JsonCanvas | null {
  try {
    const parsed = jsonCanvasSchema.safeParse(JSON.parse(text));
    return parsed.success && (parsed.data.nodes?.length ?? 0) > 0
      ? (parsed.data as JsonCanvas)
      : null;
  } catch {
    return null;
  }
}

export type CanvasPanel = "history" | "outline" | null;

function EditorInner({
  canvas,
  onStatus,
  panel,
  onClosePanel,
  chrome,
}: {
  canvas: CanvasDetail;
  onStatus: (handle: CanvasEditorHandle) => void;
  panel: CanvasPanel;
  onClosePanel: () => void;
  chrome: CanvasChrome;
}) {
  const [doc] = useState(() => {
    const d = new Y.Doc();
    if (canvas.state) Y.applyUpdate(d, base64ToBytes(canvas.state), SERVER);
    return d;
  });
  const [view] = useState(() => new CanvasDocView(doc));
  const [undo] = useState(
    () =>
      new Y.UndoManager([canvasNodes(doc), canvasEdges(doc)], {
        trackedOrigins: new Set([LOCAL]),
        captureTimeout: 400,
      }),
  );
  // The doc, the view and the undo manager are this component's alone and
  // are collected with it, so only the view's observers are managed here.
  // Destroying them in a cleanup would break under StrictMode, which runs
  // the cleanup and the effect again on the same instances.
  useEffect(() => {
    view.connect();
    return () => view.disconnect();
  }, [view]);
  const undoDepth = useSyncExternalStore(
    (listener) => {
      undo.on("stack-item-added", listener);
      undo.on("stack-item-popped", listener);
      undo.on("stack-cleared", listener);
      return () => {
        undo.off("stack-item-added", listener);
        undo.off("stack-item-popped", listener);
        undo.off("stack-cleared", listener);
      };
    },
    () => `${undo.undoStack.length}:${undo.redoStack.length}`,
    () => "0:0",
  );
  const [undoCount, redoCount] = undoDepth.split(":").map(Number) as [number, number];

  const nodes = useSyncExternalStore(
    view.subscribe,
    () => view.nodes,
    () => view.nodes,
  );
  const edges = useSyncExternalStore(
    view.subscribe,
    () => view.edges,
    () => view.edges,
  );
  const serverVector = useMemo(
    () =>
      canvas.state
        ? Y.encodeStateVectorFromUpdate(base64ToBytes(canvas.state))
        : new Uint8Array([0]),
    [canvas.state],
  );
  const saver = useCanvasSave(doc, canvas.id, serverVector);
  useEffect(
    () =>
      onStatus({
        status: saver.status,
        flush: saver.save,
        exportJson: () => docToJsonCanvas(doc),
      }),
    [doc, onStatus, saver.status, saver.save],
  );

  const flow = useReactFlow<CanvasFlowNode, CanvasFlowEdge>();
  const detail = useStore((s) => detailLevelFor(s.transform[2]));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelEditId, setLabelEditId] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(false);
  const [viewportMoving, setViewportMoving] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(rememberedInspector);
  const wide = useMediaQuery(WIDE_QUERY);
  const imageInput = useRef<HTMLInputElement>(null);
  useOnViewportChange({
    onStart: () => setViewportMoving(true),
    onEnd: () => setViewportMoving(false),
  });
  const [attachments, setAttachments] = useState<CanvasAttachmentMap>(canvas.attachments);
  const host = useRef<HTMLDivElement>(null);
  const [labelLayer, setLabelLayer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setLabelLayer(host.current?.querySelector(".react-flow__edgelabel-renderer") ?? null);
  }, []);

  // Image cards that arrived after load (another tab's save, a restore).
  useEffect(() => {
    const missing = nodes
      .map((n) => n.data.card.attachmentId)
      .filter((id): id is string => id != null && !(id in attachments));
    if (missing.length === 0) return;
    let cancelled = false;
    void client
      .listCanvasAttachments({ canvasId: canvas.id, attachmentIds: [...new Set(missing)] })
      .then((found) => {
        if (!cancelled) setAttachments((prev) => ({ ...prev, ...found }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [nodes, attachments, canvas.id]);

  const cards = useMemo(() => new Map(nodes.map((n) => [n.id, n.data.card])), [nodes]);
  const selectedIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const selectedEdges = useMemo(() => edges.filter((e) => e.selected), [edges]);
  const atCap = nodes.length >= CANVAS_LIMITS.maxNodes;

  // ── Dragging ──────────────────────────────────────────────────────────────

  const pendingMoves = useRef(new Map<string, { x: number; y: number }>());
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const groupDrag = useRef<{
    id: string;
    start: { x: number; y: number };
    carried: Map<string, { x: number; y: number }>;
  } | null>(null);

  const flushMoves = useCallback(() => {
    if (moveTimer.current) clearTimeout(moveTimer.current);
    moveTimer.current = null;
    const updates = new Map<string, Record<string, unknown>>();
    for (const [id, { x, y }] of pendingMoves.current) {
      updates.set(id, { x: Math.round(x), y: Math.round(y) });
    }
    pendingMoves.current.clear();
    setCardFields(doc, updates);
  }, [doc]);

  const queueMoves = useCallback(
    (moves: Iterable<[string, { x: number; y: number }]>, final: boolean) => {
      for (const [id, position] of moves) pendingMoves.current.set(id, position);
      if (final) flushMoves();
      else moveTimer.current ??= setTimeout(flushMoves, DRAG_WRITE_MS);
    },
    [flushMoves],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasFlowNode>[]) => {
      const local: NodeChange<CanvasFlowNode>[] = [];
      const moves: [string, { x: number; y: number }][] = [];
      let final = false;
      for (const change of changes) {
        if (change.type === "remove") continue;
        // A resize draws live and lands in the doc once, from `onResizeEnd`.
        if (change.type === "position" && change.position && !resizingRef.current) {
          moves.push([change.id, change.position]);
          if (!change.dragging) final = true;
        }
        local.push(change);
      }

      const group = groupDrag.current;
      if (group) {
        const lead = moves.find(([id]) => id === group.id);
        if (lead) {
          const dx = lead[1].x - group.start.x;
          const dy = lead[1].y - group.start.y;
          for (const [id, start] of group.carried) {
            const position = { x: start.x + dx, y: start.y + dy };
            moves.push([id, position]);
            local.push({ type: "position", id, position });
          }
        }
      }

      if (local.length) view.patchLocal((current) => applyNodeChanges(local, current));
      if (moves.length) queueMoves(moves, final);
    },
    [view, queueMoves],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasFlowEdge>[]) => {
      const local = changes.filter((c) => c.type !== "remove");
      if (local.length) view.patchLocalEdges((current) => applyEdgeChanges(local, current));
    },
    [view],
  );

  const onDelete = useCallback(
    ({ nodes: gone, edges: goneEdges }: { nodes: CanvasFlowNode[]; edges: CanvasFlowEdge[] }) => {
      deleteElements(
        doc,
        gone.map((n) => n.id),
        goneEdges.map((e) => e.id),
      );
    },
    [doc],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target)
        return;
      addEdge(doc, {
        from: connection.source,
        to: connection.target,
        fromSide: connection.sourceHandle ?? undefined,
        toSide: connection.targetHandle ?? undefined,
      });
    },
    [doc],
  );

  // ── Adding ────────────────────────────────────────────────────────────────

  const centerOfView = useCallback(() => {
    const rect = host.current?.getBoundingClientRect();
    return flow.screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
    });
  }, [flow]);

  const add = useCallback(
    (fields: Record<string, unknown>, at?: { x: number; y: number }) => {
      if (atCap) {
        toast.error(`A canvas holds ${CANVAS_LIMITS.maxNodes} cards at most.`);
        return null;
      }
      const w = (fields.w as number | undefined) ?? 260;
      const h = (fields.h as number | undefined) ?? 120;
      const point = at ?? centerOfView();
      const id = addCard(doc, {
        ...fields,
        w,
        h,
        x: Math.round(point.x - w / 2),
        y: Math.round(point.y - h / 2),
      });
      view.patchLocal((current) => current.map((n) => ({ ...n, selected: n.id === id })));
      return id;
    },
    [atCap, centerOfView, doc, view],
  );

  const addText = useCallback(
    (at?: { x: number; y: number }) => {
      const id = add({ type: "text", text: "" }, at);
      if (id) requestAnimationFrame(() => setEditingId(id));
    },
    [add],
  );

  /** Downscales and uploads an image into the scope; null (with a toast) if that fails. */
  const uploadAttachment = useCallback(
    async (original: File) => {
      let file: File;
      try {
        file = await prepareImage(original);
      } catch (error) {
        toast.error(
          error instanceof ImageTooLargeError ? error.message : "Couldn't read that image.",
        );
        return null;
      }
      const fields: Record<string, string> =
        canvas.scope.kind === "team"
          ? { scope: "team", teamId: canvas.scope.teamId }
          : { scope: "personal" };
      try {
        const uploaded = await postImageForm<{
          id: string;
          path: string;
          url: string;
          key: string;
        }>("/api/canvas/image", file, fields, "Couldn't upload that image.");
        setAttachments((prev) => ({
          ...prev,
          [uploaded.id]: { path: uploaded.path, url: uploaded.url, quarantined: false },
        }));
        return uploaded;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't upload that image.");
        return null;
      }
    },
    [canvas.scope],
  );

  const uploadImage = useCallback(
    async (original: File, at?: { x: number; y: number }) => {
      const uploaded = await uploadAttachment(original);
      if (!uploaded) return;
      const size = await imageSize(uploaded.url);
      add({ type: "image", attachmentId: uploaded.id, file: uploaded.path, ...size }, at);
    },
    [add, uploadAttachment],
  );

  const replaceImage = useCallback(
    async (cardId: string, original: File) => {
      const uploaded = await uploadAttachment(original);
      if (!uploaded) return;
      setCardFields(doc, new Map([[cardId, { attachmentId: uploaded.id, file: uploaded.path }]]));
    },
    [doc, uploadAttachment],
  );

  /**
   * A connection dropped somewhere other than a handle: on a card, it
   * connects to that card; on empty canvas, it makes a text card there,
   * connected and ready to type in.
   */
  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, state) => {
      if (state.isValid || !state.fromNode) return;
      const from = state.fromNode.id;
      const fromSide = (state.fromHandle?.id ?? undefined) as keyof typeof OPPOSITE | undefined;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      if (!point) return;
      const dropped = document
        .elementFromPoint(point.clientX, point.clientY)
        ?.closest<HTMLElement>(".react-flow__node")?.dataset.id;
      if (dropped) {
        if (dropped !== from) addEdge(doc, { from, to: dropped, fromSide });
        return;
      }
      const at = flow.screenToFlowPosition({ x: point.clientX, y: point.clientY });
      const toSide = fromSide ? OPPOSITE[fromSide] : "left";
      // The new card's facing side sits on the drop point.
      const [dx, dy] = {
        left: [NEW_CARD.w / 2, 0],
        right: [-NEW_CARD.w / 2, 0],
        top: [0, NEW_CARD.h / 2],
        bottom: [0, -NEW_CARD.h / 2],
      }[toSide];
      const id = add({ type: "text", text: "", ...NEW_CARD }, { x: at.x + dx, y: at.y + dy });
      if (!id) return;
      addEdge(doc, { from, to: id, fromSide, toSide });
      requestAnimationFrame(() => setEditingId(id));
    },
    [add, doc, flow],
  );

  const place = useCallback(
    ({ at, size }: Placement) => {
      const kind = tool;
      setTool("select");
      const defaults =
        kind === "group"
          ? { type: "group" as const, label: "Group", w: 600, h: 400 }
          : { type: "text" as const, text: "" };
      // A dragged-out card is held to the same minimum a resize is.
      const limits = cardSizeLimits(defaults);
      const fields = size
        ? {
            ...defaults,
            w: Math.max(limits.minWidth, Math.round(size.w)),
            h: Math.max(limits.minHeight, Math.round(size.h)),
          }
        : defaults;
      const w = (fields.w as number | undefined) ?? 260;
      const h = (fields.h as number | undefined) ?? 120;
      const id = add(fields, size ? { x: at.x + w / 2, y: at.y + h / 2 } : at);
      if (id && kind === "text") requestAnimationFrame(() => setEditingId(id));
    },
    [add, tool],
  );

  const insertFragment = useCallback(
    (fragment: JsonCanvas, at: { x: number; y: number }) => {
      if (nodes.length + fragment.nodes.length > CANVAS_LIMITS.maxNodes) {
        toast.error(`A canvas holds ${CANVAS_LIMITS.maxNodes} cards at most.`);
        return;
      }
      const { created } = applyJsonCanvas(doc, fragment, { at, origin: LOCAL });
      const createdSet = new Set(created);
      requestAnimationFrame(() =>
        view.patchLocal((current) =>
          current.map((n) => ({ ...n, selected: createdSet.has(n.id) })),
        ),
      );
    },
    [doc, nodes.length, view],
  );

  // ── Keyboard, clipboard, drops ────────────────────────────────────────────

  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (inOverlay()) return;
        if (connectFrom) setConnectFrom(null);
        else if (tool !== "select") setTool("select");
        else if (selectedIds.length || edges.some((edge) => edge.selected)) {
          view.patchLocal((current) =>
            current.map((n) => (n.selected ? { ...n, selected: false } : n)),
          );
          view.patchLocalEdges((current) =>
            current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
          );
        }
      } else if (e.key === " " && !e.repeat) {
        // A focused button keeps Space for itself.
        if ((e.target as HTMLElement | null)?.closest("button, a, [role='menuitem']")) return;
        e.preventDefault();
        setSpaceHeld(true);
      } else if (!mod && !e.altKey && !e.shiftKey && key in TOOL_KEYS) {
        const picked = TOOL_KEYS[key as keyof typeof TOOL_KEYS];
        if (picked === "select" || picked === "hand") setTool(picked);
        else if (atCap) return;
        else if (picked === "text" || picked === "group") setTool(picked);
        else if (picked === "link") setLinkOpen(true);
        else if (picked === "image") imageInput.current?.click();
        else setPickerOpen(true);
        e.preventDefault();
      } else if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) undo.redo();
        else undo.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        undo.redo();
      } else if (mod && key === "a") {
        e.preventDefault();
        view.patchLocal((current) => current.map((n) => ({ ...n, selected: true })));
      } else if (mod && key === "d" && selectedIds.length) {
        e.preventDefault();
        const fragment = selectionFragment(doc, new Set(selectedIds));
        const first = cards.get(selectedIds[0]!);
        insertFragment(fragment, { x: (first?.x ?? 0) + 30, y: (first?.y ?? 0) + 30 });
      } else if (mod && key === "0") {
        e.preventDefault();
        void flow.fitView({ duration: 200 });
      } else if (mod && (key === "=" || key === "+")) {
        e.preventDefault();
        void flow.zoomIn({ duration: 150 });
      } else if (mod && key === "-") {
        e.preventDefault();
        void flow.zoomOut({ duration: 150 });
      } else if (!mod && e.key.startsWith("Arrow") && selectedIds.length) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : NUDGE;
        const [dx, dy] = {
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
        }[e.key] ?? [0, 0];
        const updates = new Map<string, Record<string, unknown>>();
        for (const id of selectedIds) {
          const card = cards.get(id);
          if (card) updates.set(id, { x: card.x + dx!, y: card.y + dy! });
        }
        setCardFields(doc, updates);
      } else if (e.key === "Enter" && selectedIds.length === 1) {
        const card = cards.get(selectedIds[0]!);
        if (card?.type === "text") {
          e.preventDefault();
          setEditingId(card.id);
        }
      }
    };

    const onCopy = (e: ClipboardEvent, cut = false) => {
      if (isEditableTarget(e.target) || selectedIds.length === 0 || !e.clipboardData) return;
      e.preventDefault();
      const fragment = selectionFragment(doc, new Set(selectedIds));
      const json = JSON.stringify(fragment);
      // Obsidian reads its own type; everything else gets the plain JSON.
      e.clipboardData.setData("obsidian/canvas", json);
      e.clipboardData.setData("text/plain", json);
      if (cut) deleteElements(doc, selectedIds, []);
    };
    const onCut = (e: ClipboardEvent) => onCopy(e, true);

    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target) || !e.clipboardData) return;
      const data = e.clipboardData;
      const at = lastPointer.current ?? centerOfView();
      const fragment =
        parseCanvasText(data.getData("obsidian/canvas")) ??
        parseCanvasText(data.getData("text/plain"));
      if (fragment) {
        e.preventDefault();
        insertFragment(fragment, at);
        return;
      }
      const image = [...data.files].find((f) => f.type.startsWith("image/"));
      if (image) {
        e.preventDefault();
        void uploadImage(image, at);
        return;
      }
      const text = data.getData("text/plain").trim();
      if (!text) return;
      e.preventDefault();
      if (/^https?:\/\/\S+$/.test(text)) add({ type: "link", url: text, w: 320, h: 90 }, at);
      else add({ type: "text", text: text.slice(0, CANVAS_LIMITS.maxCardText) }, at);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    const onBlur = () => setSpaceHeld(false);

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [
    add,
    atCap,
    cards,
    centerOfView,
    connectFrom,
    doc,
    edges,
    flow,
    insertFragment,
    selectedIds,
    tool,
    undo,
    uploadImage,
    view,
  ]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const images = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (images.length) {
        e.preventDefault();
        images.forEach((file, i) => void uploadImage(file, { x: at.x + i * 40, y: at.y + i * 40 }));
        return;
      }
      const url = e.dataTransfer.getData("text/uri-list").split("\n")[0]?.trim();
      if (url && /^https?:\/\//.test(url)) {
        e.preventDefault();
        add({ type: "link", url, w: 320, h: 90 }, at);
      }
    },
    [add, flow, uploadImage],
  );

  // ── Focus and reading order ───────────────────────────────────────────────

  // Read through a ref so `focusCard`, and the link context built on it,
  // stay the same while cards move; a context that changed every drag frame
  // would walk the whole canvas's tree each time.
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  /** Selects a card, brings it into view, and moves keyboard focus onto it. */
  const focusCard = useCallback(
    (id: string) => {
      const card = cardsRef.current.get(id);
      if (!card) return;
      view.patchLocal((current) => current.map((n) => ({ ...n, selected: n.id === id })));
      void flow
        .setCenter(card.x + card.w / 2, card.y + card.h / 2, {
          zoom: Math.max(flow.getZoom(), 0.8),
          duration: 250,
        })
        .then(() =>
          host.current
            ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
            ?.focus({ preventScroll: true }),
        );
    },
    [flow, view],
  );

  /** Tab walks the cards top-left to bottom-right, off-screen ones included. */
  const onHostKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Tab" || e.altKey || e.metaKey || e.ctrlKey) return;
      const node = (e.target as HTMLElement).closest<HTMLElement>(".react-flow__node");
      const id = node?.dataset.id;
      if (!id) return;
      const order = flattenOutline(canvasOutline([...cards.values()])).map((c) => c.id);
      const next = order[order.indexOf(id) + (e.shiftKey ? -1 : 1)];
      if (!next) return;
      e.preventDefault();
      focusCard(next);
    },
    [cards, focusCard],
  );

  const links = useCanvasLinks(cards.values(), attachments, focusCard);

  // ── Context for the cards ─────────────────────────────────────────────────

  const context = useMemo<CanvasEditorContextValue>(
    () => ({
      detail,
      attachments,
      readOnly: false,
      editingId,
      setEditingId,
      labelLayer,
      liveDrawing: view.liveDrawing,
      labelEditId,
      setLabelEditId,
      onResizeStart: () => {
        resizingRef.current = true;
        setResizing(true);
      },
      onResizeEnd: (id, box) => {
        resizingRef.current = false;
        setResizing(false);
        setCardFields(
          doc,
          new Map([
            [
              id,
              {
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height),
              },
            ],
          ]),
        );
      },
      onLabelChange: (kind, id, label) => {
        if (kind === "edge") setEdgeFields(doc, id, { label });
        else setCardFields(doc, new Map([[id, { label: label || undefined }]]));
      },
    }),
    [attachments, detail, doc, editingId, labelEditId, labelLayer, view],
  );

  const commands = useCanvasCommands({
    doc,
    view,
    cards,
    selectedIds,
    selectedEdges,
    insertFragment,
    onReplaceImage: (id, file) => void replaceImage(id, file),
  });
  const selectedCards = commands.selected;
  const hasSelection = selectedCards.length > 0 || selectedEdges.length > 0;
  const moving = viewportMoving || resizing || nodes.some((n) => n.dragging);
  const showBar =
    hasSelection &&
    !moving &&
    tool === "select" &&
    !spaceHeld &&
    connectFrom == null &&
    editingId == null &&
    labelEditId == null;
  const panning = tool === "hand" || spaceHeld;
  const placing = (tool === "text" || tool === "group") && !spaceHeld;

  const setInspector = (open: boolean) => {
    setInspectorOpen(open);
    rememberInspector(open);
  };
  const renameLabel = (id: string) => setLabelEditId(id);
  const colorCommit = () => undo.stopCapturing();

  const right =
    panel === "history" ? (
      <HistoryPanel
        canvasId={canvas.id}
        onClose={onClosePanel}
        editor={{
          onRestored: (update, vector) => {
            Y.applyUpdate(doc, update, SERVER);
            saver.acknowledge(vector);
          },
          flushBeforeRestore: saver.save,
          stateVector: () => Y.encodeStateVector(doc),
        }}
      />
    ) : wide && inspectorOpen && hasSelection ? (
      <Inspector
        commands={commands}
        cards={selectedCards}
        edges={selectedEdges}
        allCards={cards}
        allEdges={edges}
        onConnect={setConnectFrom}
        onRenameLabel={renameLabel}
        onColorCommit={colorCommit}
        onFocusCard={focusCard}
        onCollapse={() => setInspector(false)}
      />
    ) : null;

  return (
    <CanvasEditorContext value={context}>
      <CanvasLinksContext value={links}>
        <CanvasShell
          topLeft={chrome.topLeft}
          topRight={
            <Island aria-label="View">
              {chrome.toggles}
              {wide ? (
                <Button
                  variant={inspectorOpen ? "secondary" : "ghost"}
                  size="icon"
                  tooltip="Inspector"
                  aria-label="Inspector"
                  aria-pressed={inspectorOpen}
                  onClick={() => setInspector(!inspectorOpen)}
                >
                  <HugeiconsIcon icon={SidebarRight01Icon} size={16} />
                </Button>
              ) : null}
              <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
              <ZoomMenu />
            </Island>
          }
          left={
            panel === "outline" ? (
              <OutlinePanel
                cards={[...cards.values()]}
                edges={edges.map((e) => ({ from: e.source, to: e.target, label: e.data?.label }))}
                onFocus={focusCard}
                onClose={onClosePanel}
                files={chrome.files}
              />
            ) : null
          }
          right={right}
          dock={
            <ToolDock
              tool={tool}
              onTool={setTool}
              atCap={atCap}
              canUndo={undoCount > 0}
              canRedo={redoCount > 0}
              onUndo={() => undo.undo()}
              onRedo={() => undo.redo()}
              linkOpen={linkOpen}
              onLinkOpen={setLinkOpen}
              onAddLink={(url) => add({ type: "link", url, w: 320, h: 90 })}
              pickerOpen={pickerOpen}
              onPickerOpen={setPickerOpen}
              onAddEntity={(entity, url) => add({ type: "entity", entity, url, w: 300, h: 220 })}
              imageInput={imageInput}
              onAddImage={(file) => void uploadImage(file)}
            />
          }
          status={chrome.status}
          overlay={
            <>
              {showBar ? (
                <SelectionBar
                  commands={commands}
                  cards={selectedCards}
                  edges={selectedEdges}
                  allCards={cards}
                  onConnect={setConnectFrom}
                  onRenameLabel={renameLabel}
                  onColorCommit={colorCommit}
                />
              ) : null}
              {connectFrom ? (
                <div
                  role="status"
                  className="pointer-events-none absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-lg"
                >
                  Click the card to connect to. Esc cancels.
                </div>
              ) : null}
            </>
          }
        >
          <div
            ref={host}
            role="application"
            aria-label="Canvas editor"
            className="relative h-full w-full"
            onKeyDown={onHostKeyDown}
            onPointerMove={(e) => {
              lastPointer.current = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onDoubleClick={(e) => {
              const target = e.target as HTMLElement;
              if (
                target.classList.contains("react-flow__pane") ||
                target.hasAttribute("data-group-surface")
              ) {
                addText(flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
              }
            }}
          >
            <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onDelete={onDelete}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              onNodeClick={(_, node) => {
                if (!connectFrom) return;
                if (node.id !== connectFrom) addEdge(doc, { from: connectFrom, to: node.id });
                setConnectFrom(null);
              }}
              onPaneClick={() => setConnectFrom(null)}
              onNodeDragStart={(_, node) => {
                if (node.data.card.type === "group") {
                  const carried = new Map<string, { x: number; y: number }>();
                  for (const id of cardsInside(node.data.card, cards.values())) {
                    const card = cards.get(id);
                    if (card && !selectedIds.includes(id))
                      carried.set(id, { x: card.x, y: card.y });
                  }
                  groupDrag.current = { id: node.id, start: { ...node.position }, carried };
                }
              }}
              onNodeDragStop={() => {
                groupDrag.current = null;
                flushMoves();
              }}
              connectionMode={ConnectionMode.Loose}
              connectionLineStyle={{
                stroke: "var(--primary)",
                strokeWidth: 2,
                strokeDasharray: "6 4",
              }}
              deleteKeyCode={["Backspace", "Delete"]}
              minZoom={0.1}
              maxZoom={2.5}
              zoomOnDoubleClick={false}
              panOnScroll
              selectionOnDrag={!panning}
              panOnDrag={panning ? true : [1, 2]}
              nodesDraggable={!panning}
              onlyRenderVisibleElements
              elevateNodesOnSelect={false}
              fitView
              fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
              className="bg-background"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={GRID_GAP}
                size={2}
                color={GRID_DOT}
              />
              {panel === "history" ? null : (
                <MiniMap
                  pannable
                  zoomable
                  className="!m-3 overflow-hidden rounded-xl border border-border !bg-popover shadow-lg"
                  maskColor="color-mix(in srgb, var(--background) 70%, transparent)"
                />
              )}
            </ReactFlow>
            {placing ? <PlacementLayer onPlace={place} /> : null}
          </div>
        </CanvasShell>
      </CanvasLinksContext>
    </CanvasEditorContext>
  );
}

/**
 * The editor: React Flow over the canvas's Y.Doc, saved through `save`.
 * Lazy-loaded behind edit access; readers never download it.
 */
export default function CanvasEditor(props: {
  canvas: CanvasDetail;
  onStatus: (handle: CanvasEditorHandle) => void;
  panel: CanvasPanel;
  onClosePanel: () => void;
  chrome: CanvasChrome;
}) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}
