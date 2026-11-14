import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { selectionsByKey } from "../../collab/index";
import {
  buildOutline,
  geometryOfRef,
  isBulkRef,
  outlineOrder,
  setHover,
  type EditorSession,
  type OpBatch,
  type OutlineRow,
  type PeerPresence,
  type Ref,
  type Registry,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
} from "../../editor/index";
import {
  buildTreeOutline,
  treeDragRoots,
  treeDropBatch,
  treeDropRefusal,
  type TreeDrop,
} from "../../editor/outline";
import { defaultLayer } from "../../scene/index";
import { canBeInTree } from "../../scene/validate";
import { useCanvasReveal } from "../frame/EditorFrame";
import { STORAGE_PREFIX, type EditorNotify } from "../host";
import {
  Badge,
  Button,
  Hint,
  Icon,
  Input,
  MicroLabel,
  SegmentedControl,
  Text,
  useKit,
} from "../kit/index";
import { useBrowserState } from "../kit/ssr";
import { useBusy } from "../pending/use-pending";
import { openPrefabScope } from "../session/live-scene-editor";
import { readStored, storedFlags, writeStored } from "../session/stored";
import { useEditorDoc, useEditorPrefabs, useEditorStore } from "../session/use-editor-store";
import { distinctPeople, PeerFaces } from "./peer-faces";

const COLLAPSE_KEY = `${STORAGE_PREFIX}outline-collapsed`;
const VIEW_KEY = `${STORAGE_PREFIX}outline-view`;
const NONE_COLLAPSED: Record<string, boolean> = {};

/** A layer row's title: its name title-cased, `far-hills` as "Far Hills". */
const layerTitle = (name: string) =>
  name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ") || name;

type View = "tree" | "type" | "layer";

/** A row of any view: the engine's tree or type outline, plus layer rows for the layer view. */
type Row =
  | OutlineRow
  | {
      key: string;
      depth: number;
      kind: "layer";
      label: string;
      count: number;
      layer: string;
      /** The layer's description, for a layer row. */
      hint?: string;
      ref?: undefined;
    };

type EntityRow = OutlineRow & { kind: "entity" };

const isEntityRow = (row: Row): row is EntityRow => row.kind === "entity";

const isView = (v: unknown): v is View => v === "tree" || v === "type" || v === "layer";
const storedView = (v: unknown): View | null => (isView(v) ? v : null);

/** Buckets start closed, since one can hold hundreds of rows; instances start open. */
const collapsedByDefault = (row: Row) => row.kind === "bucket";

/** The keys of rows with deeper rows right under them: the ones that open and close. */
function parentKeys(rows: readonly Row[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < rows.length; i++) {
    if (rows[i + 1]!.depth > rows[i]!.depth) out.add(rows[i]!.key);
  }
  return out;
}

/**
 * Where each entity and instance sits: its `layer` when the registry has
 * it, else its default (an unknown name is a validation issue, not a reason
 * to drop the row). Instances default as a loading, non-bulk entity does.
 */
function placements(def: SceneDefinition, registry: Registry) {
  const known = new Set(registry.layers.map((l) => l.name));
  const on = (layer: string | undefined, fallback: () => string) =>
    layer !== undefined && known.has(layer) ? layer : fallback();
  const out = new Map<Ref, { layer: string; stored?: string }>();
  for (const e of def.entities ?? []) {
    if (out.has(e.id)) continue;
    out.set(e.id, {
      layer: on(e.layer, () => defaultLayer(registry.types.get(e.type), false, registry.layers)),
      ...(e.layer !== undefined ? { stored: e.layer } : {}),
    });
  }
  for (const i of def.instances ?? []) {
    if (out.has(i.id)) continue;
    out.set(i.id, {
      layer: on(i.layer, () => defaultLayer(undefined, false, registry.layers)),
      ...(i.layer !== undefined ? { stored: i.layer } : {}),
    });
  }
  return out;
}

/**
 * The layer view: every registry layer, bottom to top, empty ones too so
 * they take drops. Bulk entries have no fields, so their buckets sit in
 * their type's default layer.
 */
function layerOutline(def: SceneDefinition, registry: Registry, byType: OutlineRow[]): Row[] {
  const rows = new Map(byType.flatMap((r, i) => (r.ref ? [[r.ref, i] as const] : [])));
  const placed = placements(def, registry);
  /** The row at `i` at `depth`, with the rows under it in the type view a level deeper each. */
  const subtree = (i: number, depth: number): Row[] => {
    const head = byType[i]!;
    const out: Row[] = [{ ...head, depth }];
    for (let j = i + 1; j < byType.length && byType[j]!.depth > head.depth; j++)
      out.push({ ...byType[j]!, depth: byType[j]!.depth - head.depth + depth });
    return out;
  };
  const out: Row[] = [];
  for (const { name: layer, description } of registry.layers) {
    const loose: number[] = [];
    const buckets: Row[] = [];
    for (let i = 0; i < byType.length; i++) {
      const row = byType[i]!;
      if (row.kind === "bucket") {
        const home = defaultLayer(registry.types.get(row.type ?? ""), true, registry.layers);
        if (home !== layer) continue;
        buckets.push({ ...row, depth: 1 });
        for (let j = i + 1; byType[j]?.depth === 2; j++) buckets.push(byType[j]!);
      }
    }
    for (const [id, e] of placed) {
      const at = rows.get(id);
      if (e.layer !== layer || at === undefined || !isEntityRow(byType[at]!)) continue;
      loose.push(at);
    }
    const count = loose.length + buckets.filter(isEntityRow).length;
    out.push({
      key: `layer:${layer}`,
      depth: 0,
      kind: "layer",
      label: layerTitle(layer),
      count,
      layer,
      ...(description ? { hint: description } : {}),
    });
    out.push(...buckets, ...loose.flatMap((at) => subtree(at, 1)));
  }
  return out;
}

function visibleRows(rows: Row[], collapsed: Record<string, boolean>): Row[] {
  const out: Row[] = [];
  let hiddenBelow: number | null = null;
  for (const row of rows) {
    if (hiddenBelow !== null && row.depth > hiddenBelow) continue;
    hiddenBelow = null;
    out.push(row);
    if (collapsed[row.key] ?? collapsedByDefault(row)) hiddenBelow = row.depth;
  }
  return out;
}

// ─── Filtering ───────────────────────────────────────────

type OutlineFilter = { types: string[]; shapes: string[]; problems: boolean; text: string[] };

/** `type:<t>`, `shape:<tag>` and `has:problems` chips, and free words matched against ids and names. */
function parseFilter(query: string): OutlineFilter {
  const out: OutlineFilter = { types: [], shapes: [], problems: false, text: [] };
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const [head, value] = word.split(/:(.*)/s) as [string, string | undefined];
    if (value && head === "type") out.types.push(value);
    else if (value && head === "shape") out.shapes.push(value);
    else if (word === "has:problems") out.problems = true;
    else out.text.push(word);
  }
  return out;
}

const FILTER_SYNTAX =
  "Words match ids and names; type:sensor, shape:box and has:problems narrow the rows. Esc clears.";

const filterChips = (f: OutlineFilter) => [
  ...f.types.map((t) => `type:${t}`),
  ...f.shapes.map((s) => `shape:${s}`),
  ...(f.problems ? ["has:problems"] : []),
];

const isEmpty = (f: OutlineFilter) =>
  f.types.length + f.shapes.length + f.text.length === 0 && !f.problems;

type MatchCtx = { def: SceneDefinition; registry: Registry; problems: Set<string> };

function matches(row: EntityRow, f: OutlineFilter, ctx: MatchCtx): boolean {
  const ref = row.ref;
  if (!ref) return false;
  if (f.types.length > 0) {
    const base = row.type ? ctx.registry.types.get(row.type)?.base : undefined;
    if (!f.types.some((t) => t === row.type || t === base)) return false;
  }
  if (f.shapes.length > 0) {
    const tag = geometryOfRef(ctx.def, ctx.registry, ref)?.local?.type;
    if (!tag || !f.shapes.includes(tag)) return false;
  }
  if (f.problems && !ctx.problems.has(ref)) return false;
  const hay = `${ref} ${row.label}`.toLowerCase();
  return f.text.every((w) => hay.includes(w));
}

/** The matching entity rows and every row above one (a container, a parent, an instance), ignoring collapse. */
function filteredRows(rows: Row[], f: OutlineFilter, ctx: MatchCtx): Row[] {
  const keep = new Set<Row>();
  const above: Row[] = [];
  for (const row of rows) {
    while (above.length > 0 && above[above.length - 1]!.depth >= row.depth) above.pop();
    if (isEntityRow(row) && matches(row, f, ctx)) {
      for (const a of above) keep.add(a);
      keep.add(row);
    }
    above.push(row);
  }
  return rows.filter((r) => keep.has(r));
}

// ─── Peers ───────────────────────────────────────────────

type PeerMarks = {
  /** Who has the row's own entity selected. */
  own: Map<string, PeerPresence[]>;
  /** Who has something below the row selected: shown while the row is closed. */
  inside: Map<string, PeerPresence[]>;
};

/** Who has each row selected, and who has something under it selected, by row key. */
function peersByRow(
  rows: readonly Row[],
  byKey: Map<string, PeerPresence[]>,
  session: EditorSession,
): PeerMarks {
  const out: PeerMarks = { own: new Map(), inside: new Map() };
  if (byKey.size === 0) return out;
  const above: Row[] = [];
  for (const row of rows) {
    while (above.length > 0 && above[above.length - 1]!.depth >= row.depth) above.pop();
    const key = isEntityRow(row) && row.ref ? session.keyOf(row.ref) : undefined;
    const by = key ? byKey.get(key) : undefined;
    if (by) {
      out.own.set(row.key, by);
      for (const a of above) out.inside.set(a.key, [...(out.inside.get(a.key) ?? []), ...by]);
    }
    above.push(row);
  }
  return out;
}

// ─── Dropping ────────────────────────────────────────────

type DropTarget = { layer: string };

/** What a row takes drops for: a layer move in the layer view; in the tree, a new parent or a place among siblings. */
type DropData = { kind: "place"; target: DropTarget } | TreeDrop;

/** The empty space below the tree's rows: a drop there puts rows at the root. */
const ROOT_DROP = "tree-root";
/** The strip under the tree's list, which takes root drops while dragging even when the rows fill the list. */
const ROOT_STRIP = "tree-root-strip";
const isRootDrop = (id: unknown) => id === ROOT_DROP || id === ROOT_STRIP;
const ROOT_DATA = { kind: "reparent", parent: null } satisfies DropData;

/** The rows under the pointer, else the list around them. */
const rowsFirst: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const rows = hits.filter((h) => !isRootDrop(h.id));
  return rows.length > 0 ? rows : hits;
};

/**
 * How much of a row's height, from its top, is a drop before it (and from
 * its bottom, after it) rather than onto it; a row that can't take children
 * splits into halves.
 */
const EDGE_BAND = 1 / 3;

/** What a tree drop would do: its batch, or why it's refused. */
type Judged = { drop: TreeDrop; batch: OpBatch | null; refused: SceneIssue | null };

/** Where a tree drag would land; `above` puts the refusal over the row when one under it would leave the list. */
type Aim = Judged & { at: string; above: boolean };

const dropKey = (d: TreeDrop) =>
  d.kind === "reparent"
    ? `onto:${d.parent ?? ""}`
    : "before" in d
      ? `before:${d.before}`
      : `after:${d.after}`;

/**
 * One batch moving entities and instances onto a layer row (their `layer`).
 * Bulk entries have no fields and instance children follow their instance,
 * so both are left out; null when nothing changes.
 */
function dropBatch(
  def: SceneDefinition,
  registry: Registry,
  refs: readonly Ref[],
  target: DropTarget,
): OpBatch | null {
  const byId = placements(def, registry);
  const ops: SceneOp[] = [];
  const moved: Ref[] = [];
  for (const ref of refs) {
    const e = byId.get(ref);
    if (!e) continue;
    const set: Record<string, unknown> = {};
    if (e.layer !== target.layer || (e.stored ?? target.layer) !== target.layer)
      set.layer = target.layer;
    if (Object.keys(set).length === 0) continue;
    ops.push({ op: "update", ref, set });
    moved.push(ref);
  }
  if (ops.length === 0) return null;
  const n = moved.length === 1 ? moved[0]! : `${moved.length} entities`;
  return { label: `Move ${n} to ${layerTitle(target.layer)}`, ops };
}

function DropRow({
  id,
  data,
  enabled,
  level,
  children,
}: {
  id: string;
  data: DropData;
  enabled: boolean;
  level: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data, disabled: !enabled });
  return (
    <li
      ref={setNodeRef}
      aria-level={level}
      className="je-outliner-item"
      data-drop-over={isOver ? "" : undefined}
    >
      {children}
    </li>
  );
}

/** How a row shows the drag over it: taking it onto the row, before or after the row, or refusing it. */
type DropMark = "over" | "before" | "after" | "refused";

const markAttrs = (mark: DropMark | undefined) => ({
  "data-drop-over": mark === "over" ? "" : undefined,
  "data-drop-before": mark === "before" ? "" : undefined,
  "data-drop-after": mark === "after" ? "" : undefined,
  "data-drop-refused": mark === "refused" ? "" : undefined,
});

/** Why a held tree drop is refused, beside where it's aimed; announced without taking focus. */
function Refusal({ message, above }: { message: string; above?: boolean }) {
  return (
    <Text
      as="p"
      role="status"
      size="xs"
      variant="danger"
      className="je-outliner-refusal"
      data-side={above ? "above" : undefined}
    >
      {message}
    </Text>
  );
}

/** The tree's list, which takes a drop on its empty space as a move to the root. */
function TreeList({
  enabled,
  mark,
  listRef,
  children,
}: {
  enabled: boolean;
  mark: DropMark | undefined;
  listRef: { current: HTMLUListElement | null };
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: ROOT_DROP, data: ROOT_DATA, disabled: !enabled });
  return (
    <ul
      ref={(el) => {
        setNodeRef(el);
        listRef.current = el;
      }}
      className="je-outliner-list"
      {...markAttrs(mark)}
    >
      {children}
    </ul>
  );
}

/**
 * The root drop in reach however full the list is. Its space stays in the
 * Tree view when idle, so starting a drag doesn't shrink the list under the pointer.
 */
function RootStrip({
  idle,
  mark,
  refusal,
}: {
  idle: boolean;
  mark: DropMark | undefined;
  refusal?: string | undefined;
}) {
  const { setNodeRef } = useDroppable({ id: ROOT_STRIP, data: ROOT_DATA, disabled: idle });
  return (
    <div
      ref={setNodeRef}
      className="je-outliner-root"
      data-idle={idle ? "" : undefined}
      aria-hidden={idle || undefined}
      {...markAttrs(mark)}
    >
      <Text size="sm" variant="muted">
        Drop here to move to the root
      </Text>
      {refusal ? <Refusal message={refusal} /> : null}
    </div>
  );
}

/** One stack for a row's own selectors and, while it's closed, those of rows under it. */
function RowPeers({
  own,
  inside,
}: {
  own: PeerPresence[] | undefined;
  inside: PeerPresence[] | undefined;
}) {
  const peers = distinctPeople([...(own ?? []), ...(inside ?? [])]);
  if (peers.length === 0) return null;
  const label = !inside
    ? "Selected by"
    : !own
      ? "Selected inside by"
      : "Selected here or inside by";
  return <PeerFaces peers={peers} label={label} size={14} />;
}

function EntityItem({
  row,
  draggable,
  drop,
  mark,
  refusal,
  refusalAbove,
  onMove,
  expanded,
  onToggle,
  selected,
  hovered,
  selectedBy,
  insideBy,
  indent,
  onSelect,
  onHover,
  onOpenPrefab,
}: {
  row: EntityRow;
  draggable: boolean;
  /** Set on a row with rows nested under it: whether they show. */
  expanded?: boolean;
  onToggle?: () => void;
  selected: boolean;
  /** The pointer is over this entity, here or in the scene view. */
  hovered: boolean;
  selectedBy: PeerPresence[] | undefined;
  /** Who has something under the row selected, shown while it is closed. */
  insideBy?: PeerPresence[] | undefined;
  /** Set on a row that takes tree drops. */
  drop?: DropData | undefined;
  mark?: DropMark | undefined;
  /** Why a drop aimed at this row is refused. */
  refusal?: string | undefined;
  refusalAbove?: boolean;
  /** Set on a tree row the keyboard can move among its siblings: -1 up, 1 down. */
  onMove?: ((step: -1 | 1) => void) | undefined;
  indent: CSSProperties;
  onSelect: (mode: "replace" | "range" | "toggle") => void;
  onHover: (ref: Ref | null) => void;
  onOpenPrefab?: (prefab: string, from: Ref) => void;
}) {
  const ref = row.ref;
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: row.key,
    data: { ref },
    disabled: !draggable,
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: row.key,
    ...(drop ? { data: drop } : {}),
    disabled: !drop,
  });
  const prefab = row.prefab;
  const opening = useBusy(ref ? openPrefabScope(ref) : "") !== undefined;
  // Capture, so the editor's keymap sees the press as handled and doesn't also nudge.
  const onMoveKey = (e: KeyboardEvent) => {
    if (!onMove || !e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (step === 0) return;
    e.preventDefault();
    onMove(step);
  };
  return (
    <li
      ref={setDropRef}
      aria-level={row.depth + 1}
      className="je-outliner-item je-outliner-entity"
      {...markAttrs(mark)}
    >
      {expanded !== undefined && onToggle ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${row.label}`}
          onClick={onToggle}
          className="je-outliner-twisty"
          style={{ left: `${row.depth * 12 - 8}px` }}
        >
          <Icon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} size={12} />
        </button>
      ) : null}
      <button
        ref={setNodeRef}
        type="button"
        disabled={!ref}
        aria-pressed={ref ? selected : undefined}
        {...listeners}
        onKeyDownCapture={onMove ? onMoveKey : undefined}
        aria-keyshortcuts={onMove ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
        data-row-key={row.key}
        onClick={(e) => {
          if (!ref) return;
          onSelect(e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace");
        }}
        onPointerEnter={() => ref && onHover(ref)}
        onPointerLeave={() => onHover(null)}
        className="je-outliner-row"
        data-selected={selected ? "" : undefined}
        data-hover={hovered ? "" : undefined}
        data-busy={opening ? "" : undefined}
        aria-busy={opening || undefined}
        data-dragging={isDragging ? "" : undefined}
        style={indent}
      >
        <span
          className="je-sp-truncate"
          data-overrides={!row.prefab && row.overrides ? "" : undefined}
        >
          {row.label}
        </span>
        {row.prefab ? (
          <Badge size="label" variant="outline">
            prefab
          </Badge>
        ) : null}
        <RowPeers own={selectedBy} inside={expanded === false ? insideBy : undefined} />
        {row.detail ? <span className="je-outliner-detail">{row.detail}</span> : null}
      </button>
      {prefab && ref && onOpenPrefab ? (
        <Button
          size="xs"
          variant="ghost"
          tooltip={`Open ${prefab} on its own`}
          aria-label={`Open prefab ${prefab}`}
          className="je-outliner-open"
          busyScope={openPrefabScope(ref)}
          onClick={() => onOpenPrefab(prefab, ref)}
        >
          Open
        </Button>
      ) : null}
      {refusal ? <Refusal message={refusal} above={refusalAbove} /> : null}
    </li>
  );
}

/**
 * The scene's rows as a tree (default), by type or by layer, filtered by
 * chips and text. Dragging reparents or reorders in the tree, or moves
 * layer in the layer view, as one batch; Alt+Up/Down moves a tree row among
 * its siblings. A refused move says why.
 */
export function EditorOutliner({
  session,
  physical,
  notify,
  onHover,
  onOpenPrefab,
}: {
  session: EditorSession;
  physical?: readonly SceneIssue[];
  /** Where a refused tree move is reported once it's let go. */
  notify?: EditorNotify;
  onHover?: (ref: Ref | null) => void;
  /** Opens an instance's prefab on its own, from the instance's row. */
  onOpenPrefab?: (prefab: string, from: Ref) => void;
}) {
  const { storage, cue } = useKit();
  const reveal = useCanvasReveal();
  const doc = useEditorDoc(session);
  const sceneName = useEditorStore(session, (s) => s.sceneName);
  const selection = useEditorStore(session, (s) => s.selection);
  const hover = useEditorStore(session, (s) => s.hover);
  const peers = useEditorStore(session, (s) => s.peers);
  const issues = useEditorStore(session, (s) => s.issues);
  const [collapsed, setCollapsed] = useBrowserState(
    () => readStored(storage, COLLAPSE_KEY, {}, storedFlags),
    NONE_COLLAPSED,
  );
  const [view, setView] = useBrowserState<View>(
    () => readStored(storage, VIEW_KEY, "tree", storedView),
    "tree",
  );
  const [query, setQuery] = useState("");
  const [aim, setAim] = useState<Aim | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragged = useRef<Ref[]>([]);
  const listRef = useRef<HTMLUListElement | null>(null);
  /** The row a keyboard move should keep focused once the list re-renders. */
  const refocus = useRef<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const prefabs = useEditorPrefabs(session);
  const outline = useMemo(
    () =>
      view === "tree"
        ? buildTreeOutline(doc, session.registry, prefabs)
        : buildOutline(doc, session.registry, prefabs),
    [view, doc, session.registry, prefabs],
  );
  const rows = useMemo<Row[]>(
    () => (view === "layer" ? layerOutline(doc, session.registry, outline) : outline),
    [view, doc, session.registry, outline],
  );
  const filter = useMemo(() => parseFilter(query), [query]);
  const problems = useMemo(
    () => new Set([...issues, ...(physical ?? [])].flatMap((i) => i.entityIds)),
    [issues, physical],
  );
  const shown = useMemo(
    () =>
      isEmpty(filter)
        ? visibleRows(rows, collapsed)
        : filteredRows(rows, filter, { def: doc, registry: session.registry, problems }),
    [rows, collapsed, filter, doc, session.registry, problems],
  );
  const peerMarks = useMemo(
    () => peersByRow(rows, selectionsByKey(peers), session),
    [rows, peers, session],
  );
  const order = useMemo(() => outlineOrder(shown.filter(isEntityRow)), [shown]);
  const parents = useMemo(() => parentKeys(rows), [rows]);
  /** The scene's own entities and instances: the rows the tree drags and orders among. */
  const own = useMemo(
    () => new Set([...(doc.entities ?? []), ...(doc.instances ?? [])].map((d) => d.id)),
    [doc],
  );
  const registry = session.registry;
  const selected = new Set(selection);
  const filtering = !isEmpty(filter);
  const tree = view === "tree";

  // Moving a focused row's DOM node blurs it.
  useEffect(() => {
    const key = refocus.current;
    if (key === null) return;
    refocus.current = null;
    const rowButtons = listRef.current?.querySelectorAll<HTMLElement>("[data-row-key]") ?? [];
    const button = [...rowButtons].find((b) => b.dataset.rowKey === key);
    if (button && document.activeElement !== button) button.focus();
  });

  const hoverRow = (ref: Ref | null) => {
    setHover(session.store, ref);
    onHover?.(ref);
  };

  const toggle = (row: Row) => {
    const next = { ...collapsed, [row.key]: !(collapsed[row.key] ?? collapsedByDefault(row)) };
    setCollapsed(next);
    writeStored(storage, COLLAPSE_KEY, next);
  };

  const removeChip = (chip: string) =>
    setQuery(
      query
        .split(/\s+/)
        .filter((w) => w && w.toLowerCase() !== chip)
        .join(" "),
    );

  /** Whether a row's entity can have children, so its middle takes drops onto it. */
  const takesChildren = (row: Row) =>
    !isEntityRow(row) || row.type === undefined || canBeInTree(registry.types.get(row.type));

  /** Opens the row of `parent` and every row above it, so what was dropped under it shows. */
  const openTo = (parent: Ref) => {
    const at = rows.findIndex((r) => r.ref === parent);
    if (at < 0) return;
    const opened: Record<string, boolean> = {};
    for (let i = at, depth = Infinity; i >= 0; i--) {
      const r = rows[i]!;
      if (r.depth >= depth) continue;
      depth = r.depth;
      if (collapsed[r.key] ?? collapsedByDefault(r)) opened[r.key] = false;
    }
    if (Object.keys(opened).length === 0) return;
    const next = { ...collapsed, ...opened };
    setCollapsed(next);
    writeStored(storage, COLLAPSE_KEY, next);
  };

  /** What moving `ref` moves: the selection's roots when it's selected. */
  const movedWith = (ref: Ref): Ref[] =>
    selected.has(ref)
      ? treeDragRoots(session.getDoc(), registry, session.getPrefabs(), selection)
      : [ref];

  const onDragStart = ({ active }: DragStartEvent) => {
    const ref = active.data.current?.ref as Ref | undefined;
    if (!ref || !tree) return;
    setDragging(true);
    dragged.current = movedWith(ref);
  };

  const judge = (refs: readonly Ref[], drop: TreeDrop): Judged => {
    const current = session.getDoc();
    const prefabLib = session.getPrefabs();
    const batch = treeDropBatch(current, registry, prefabLib, refs, drop);
    const refused = batch ? treeDropRefusal(current, registry, prefabLib, batch) : null;
    return { drop, batch, refused };
  };

  const land = ({ drop, batch, refused }: Judged) => {
    if (batch && refused) {
      const label = batch.label ?? "Move";
      const title = `Couldn't ${label[0]!.toLowerCase()}${label.slice(1)}`;
      if (notify) notify.error(title, { description: refused.message });
      else cue("error");
      return;
    }
    if (!batch || !session.dispatch(batch).ok) return;
    if (drop.kind === "reparent" && drop.parent !== null) openTo(drop.parent);
    cue("drop");
  };

  /** The nearest of the scene's own rows beside the tree row at `i` under the same parent: before it (-1) or after it (1). */
  const siblingOf = (i: number, step: -1 | 1): Ref | null => {
    const depth = rows[i]!.depth;
    for (let j = i + step; j >= 0 && j < rows.length; j += step) {
      const r = rows[j]!;
      if (r.depth < depth) return null;
      if (r.depth === depth && r.ref && own.has(r.ref)) return r.ref;
    }
    return null;
  };

  const moveAmongSiblings = (row: EntityRow, step: -1 | 1) => {
    const ref = row.ref;
    const sibling = siblingOf(
      rows.findIndex((r) => r.key === row.key),
      step,
    );
    if (!ref || !sibling) return;
    refocus.current = row.key;
    land(
      judge(
        movedWith(ref),
        step < 0 ? { kind: "reorder", before: sibling } : { kind: "reorder", after: sibling },
      ),
    );
  };

  /** Before a row on its top edge, after it on its bottom edge where no open children follow it; null is onto it. */
  const rowDrop = (key: string, ref: Ref, y: number, rect: { top: number; height: number }) => {
    const i = shown.findIndex((r) => r.key === key);
    const row = shown[i];
    if (!row || !own.has(ref) || rect.height <= 0) return null;
    const band = takesChildren(row) ? EDGE_BAND : 0.5;
    const t = (y - rect.top) / rect.height;
    if (t < band) return { kind: "reorder", before: ref } satisfies TreeDrop;
    const next = shown[i + 1];
    if (t >= 1 - band && (!next || next.depth <= row.depth))
      return { kind: "reorder", after: ref } satisfies TreeDrop;
    return null;
  };

  /** Where the pointer would drop the dragged rows in the tree, or null over nothing that takes them. */
  const aimAt = ({ active, over, activatorEvent, delta }: DragMoveEvent): Aim | null => {
    const data = over?.data.current as DropData | undefined;
    if (!tree || !over || !data || data.kind === "place" || over.id === active.id) return null;
    const at = String(over.id);
    let drop: TreeDrop = data;
    const parent = data.kind === "reparent" ? data.parent : null;
    if (parent !== null && activatorEvent && "clientY" in activatorEvent) {
      const y = (activatorEvent as PointerEvent).clientY + delta.y;
      drop = rowDrop(at, parent, y, over.rect) ?? data;
    }
    if (aim && aim.at === at && dropKey(aim.drop) === dropKey(drop)) return aim;
    const list = listRef.current?.getBoundingClientRect();
    const above = !!list && over.rect.top + over.rect.height / 2 > list.top + list.height / 2;
    return { ...judge(dragged.current, drop), at, above };
  };

  const onDragMove = (e: DragMoveEvent | DragOverEvent) => {
    const next = aimAt(e);
    if (next !== aim) setAim(next);
  };

  const endDrag = () => {
    setAim(null);
    setDragging(false);
  };

  const onDragEnd = (e: DragEndEvent) => {
    endDrag();
    const ref = e.active.data.current?.ref as Ref | undefined;
    const drop = e.over?.data.current as DropData | undefined;
    if (!ref || !drop) return;
    if (drop.kind !== "place") {
      const landed = aimAt(e);
      if (landed) land(landed);
      return;
    }
    const moved = selected.has(ref) ? selection.filter((r) => !isBulkRef(r)) : [ref];
    const batch = dropBatch(session.getDoc(), registry, moved, drop.target);
    if (batch && session.dispatch(batch).ok) cue("drop");
  };

  const markOf = (key: string): DropMark | undefined =>
    aim?.at !== key || !aim.batch
      ? undefined
      : aim.refused
        ? "refused"
        : aim.drop.kind === "reparent"
          ? "over"
          : "before" in aim.drop
            ? "before"
            : "after";

  const refusalAt = (key: string): string | undefined =>
    aim?.at === key ? aim.refused?.message : undefined;
  const rootRefusal = refusalAt(ROOT_DROP) ?? refusalAt(ROOT_STRIP);

  return (
    <nav
      aria-label="Outliner"
      className="je-outliner"
      // The pointer left the scene view for here, so what it last hovered there no longer is.
      onPointerEnter={() => setHover(session.store, null)}
    >
      <div className="je-panel-toolbar je-outliner-head">
        <span className="je-sp-truncate je-outliner-scene">{sceneName}</span>
        <SegmentedControl
          size="xs"
          aria-label="Outline view"
          value={view}
          onChange={(v) => {
            if (!isView(v)) return;
            setView(v);
            writeStored(storage, VIEW_KEY, v);
          }}
        >
          <SegmentedControl.Item
            value="tree"
            tooltip="Rows under their parents; drag to reparent or reorder"
          >
            Tree
          </SegmentedControl.Item>
          <SegmentedControl.Item value="type" tooltip="Rows by entity type">
            Type
          </SegmentedControl.Item>
          <SegmentedControl.Item
            value="layer"
            tooltip="Rows by layer; drag rows onto one to move them"
          >
            Layer
          </SegmentedControl.Item>
        </SegmentedControl>
      </div>
      <div className="je-outliner-filter">
        <Hint content={FILTER_SYNTAX} side="bottom">
          <Input
            type="search"
            aria-label="Filter rows"
            placeholder="Filter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
          />
        </Hint>
        {filterChips(filter).length > 0 ? (
          <div className="je-outliner-chips">
            {filterChips(filter).map((chip) => (
              <Button
                key={chip}
                size="xs"
                variant="secondary"
                aria-label={`Remove filter ${chip}`}
                onClick={() => removeChip(chip)}
              >
                {chip}
                <Icon icon={Cancel01Icon} size={12} />
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={rowsFirst}
        onDragStart={onDragStart}
        onDragOver={onDragMove}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={endDrag}
      >
        <TreeList enabled={tree} mark={markOf(ROOT_DROP)} listRef={listRef}>
          {filtering && shown.length === 0 ? (
            <li className="je-outliner-none">Nothing matches.</li>
          ) : null}
          {shown.map((row) => {
            const indent = { paddingLeft: `${row.depth * 12 + 8}px` };
            if (isEntityRow(row)) {
              const ref = row.ref;
              const opens = !filtering && parents.has(row.key);
              const draggable = tree
                ? !!ref && own.has(ref)
                : view === "layer" && !!ref && !isBulkRef(ref);
              return (
                <EntityItem
                  key={row.key}
                  row={row}
                  draggable={draggable}
                  drop={tree && ref ? { kind: "reparent", parent: ref } : undefined}
                  mark={markOf(row.key)}
                  refusal={refusalAt(row.key)}
                  refusalAbove={aim?.above}
                  onMove={tree && draggable ? (step) => moveAmongSiblings(row, step) : undefined}
                  {...(opens
                    ? {
                        expanded: !(collapsed[row.key] ?? collapsedByDefault(row)),
                        onToggle: () => toggle(row),
                      }
                    : {})}
                  selected={!!ref && selected.has(ref)}
                  hovered={!!ref && hover === ref}
                  selectedBy={peerMarks.own.get(row.key)}
                  insideBy={peerMarks.inside.get(row.key)}
                  indent={indent}
                  onSelect={(mode) => {
                    if (!ref) return;
                    session.select([ref], mode, order);
                    if (session.store.state.selection.includes(ref)) reveal?.([ref]);
                  }}
                  onHover={hoverRow}
                  onOpenPrefab={onOpenPrefab}
                />
              );
            }
            const open = filtering || !(collapsed[row.key] ?? collapsedByDefault(row));
            const inside = open ? undefined : peerMarks.inside.get(row.key);
            const button = (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(row)}
                className="je-outliner-row je-outliner-container"
                style={indent}
              >
                <Icon
                  icon={open ? ArrowDown01Icon : ArrowRight01Icon}
                  size={12}
                  className="je-outliner-chevron"
                />
                {row.kind === "type" || row.kind === "layer" ? (
                  <MicroLabel>{row.label}</MicroLabel>
                ) : (
                  <span>{row.label}</span>
                )}
                {inside ? <PeerFaces peers={inside} label="Selected inside by" size={14} /> : null}
                <span className="je-outliner-count">{row.count}</span>
              </button>
            );
            const header =
              row.kind === "layer" && row.hint ? (
                <Hint content={row.hint} side="right">
                  {button}
                </Hint>
              ) : (
                button
              );
            if (row.kind === "layer") {
              return (
                <DropRow
                  key={row.key}
                  id={row.key}
                  data={{ kind: "place", target: { layer: row.layer } }}
                  enabled={view === "layer"}
                  level={row.depth + 1}
                >
                  {header}
                </DropRow>
              );
            }
            return (
              <li key={row.key} aria-level={row.depth + 1} className="je-outliner-item">
                {header}
              </li>
            );
          })}
        </TreeList>
        {tree ? (
          <RootStrip idle={!dragging} mark={markOf(ROOT_STRIP)} refusal={rootRefusal} />
        ) : null}
      </DndContext>
    </nav>
  );
}
