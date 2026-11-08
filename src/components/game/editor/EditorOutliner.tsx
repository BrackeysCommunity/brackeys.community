import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ArrowDown01Icon, ArrowRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { selectionsByKey } from "@jams/engine/collab";
import {
  attachBatch,
  attachFieldOf,
  buildOutline,
  geometryOfRef,
  isBulkRef,
  isFollowerType,
  lookupRef,
  outlineOrder,
  type EditorSession,
  type OpBatch,
  type OutlineRow,
  type PeerPresence,
  type Ref,
  type Registry,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
} from "@jams/engine/editor";
import { defaultLayer, type PrefabLibrary } from "@jams/engine/scene";
import { useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { MicroLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { PeerFaces } from "./peer-faces";
import { useEditorDoc, useEditorStore } from "./use-editor-store";

const COLLAPSE_KEY = "game-editor:outline-collapsed";
const VIEW_KEY = "game-editor:outline-view";

/** A layer row's title: its name title-cased, `far-hills` as "Far Hills". */
const layerTitle = (name: string) =>
  name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ") || name;

type View = "type" | "layer";

/** A row of either view: the engine's type outline, plus layer and group rows for the layer view. */
type Row =
  | OutlineRow
  | {
      key: string;
      depth: number;
      kind: "layer" | "group";
      label: string;
      count: number;
      layer: string;
      /** The layer's description, for a layer row. */
      hint?: string;
      group?: string;
      ref?: undefined;
    };

type EntityRow = OutlineRow & { kind: "entity" };

const isEntityRow = (row: Row): row is EntityRow => row.kind === "entity";

function readStored<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : fallback;
    return valid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private windows, blocked site data); outliner state is a convenience.
  }
}

const isRecord = (v: unknown): v is Record<string, boolean> => !!v && typeof v === "object";
const isView = (v: unknown): v is View => v === "type" || v === "layer";

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
  const out = new Map<Ref, { layer: string; stored?: string; group?: string }>();
  for (const e of def.entities ?? []) {
    if (out.has(e.id)) continue;
    out.set(e.id, {
      layer: on(e.layer, () => defaultLayer(registry.types.get(e.type), false, registry.layers)),
      ...(e.layer !== undefined ? { stored: e.layer } : {}),
      ...(typeof e.group === "string" ? { group: e.group } : {}),
    });
  }
  for (const i of def.instances ?? []) {
    if (out.has(i.id)) continue;
    out.set(i.id, {
      layer: on(i.layer, () => defaultLayer(undefined, false, registry.layers)),
      ...(i.layer !== undefined ? { stored: i.layer } : {}),
      ...(typeof i.group === "string" ? { group: i.group } : {}),
    });
  }
  return out;
}

/**
 * The layer view: every registry layer, bottom to top (empty ones too, so
 * they take drops), its groups with their entities, its bulk buckets, then
 * its ungrouped entities. Bulk entries have no fields, so they sit in their
 * type's default layer.
 */
function layerOutline(def: SceneDefinition, registry: Registry, byType: OutlineRow[]): Row[] {
  const rows = new Map(byType.flatMap((r) => (r.ref ? [[r.ref, r] as const] : [])));
  const placed = placements(def, registry);
  const out: Row[] = [];
  for (const { name: layer, description } of registry.layers) {
    const groups = new Map<string, EntityRow[]>();
    const loose: EntityRow[] = [];
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
      const row = rows.get(id);
      if (e.layer !== layer || !row || !isEntityRow(row)) continue;
      if (typeof e.group === "string") {
        groups.set(e.group, [...(groups.get(e.group) ?? []), row]);
      } else loose.push(row);
    }
    const count =
      loose.length +
      [...groups.values()].reduce((n, g) => n + g.length, 0) +
      buckets.filter(isEntityRow).length;
    out.push({
      key: `layer:${layer}`,
      depth: 0,
      kind: "layer",
      label: layerTitle(layer),
      count,
      layer,
      ...(description ? { hint: description } : {}),
    });
    for (const [group, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      out.push({
        key: `group:${layer}:${group}`,
        depth: 1,
        kind: "group",
        label: group,
        count: members.length,
        layer,
        group,
      });
      out.push(...members.map((r) => ({ ...r, depth: 2 })));
    }
    out.push(...buckets, ...loose);
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

/** The matching entity rows and every container above one, ignoring collapse. */
function filteredRows(rows: Row[], f: OutlineFilter, ctx: MatchCtx): Row[] {
  const keep = new Set<Row>();
  const above: Row[] = [];
  for (const row of rows) {
    while (above.length > 0 && above[above.length - 1]!.depth >= row.depth) above.pop();
    if (!isEntityRow(row)) {
      above.push(row);
      continue;
    }
    if (!matches(row, f, ctx)) continue;
    for (const a of above) keep.add(a);
    keep.add(row);
  }
  return rows.filter((r) => keep.has(r));
}

// ─── Peers ───────────────────────────────────────────────

/**
 * Who has each row selected, by row key: an entity row its own selectors, a
 * container everyone with something inside it selected.
 */
function peersByRow(
  rows: readonly Row[],
  byKey: Map<string, PeerPresence[]>,
  session: EditorSession,
): Map<string, PeerPresence[]> {
  const out = new Map<string, PeerPresence[]>();
  if (byKey.size === 0) return out;
  const containers: Row[] = [];
  for (const row of rows) {
    while (containers.length > 0 && containers[containers.length - 1]!.depth >= row.depth)
      containers.pop();
    if (!isEntityRow(row)) {
      containers.push(row);
      continue;
    }
    const key = row.ref ? session.keyOf(row.ref) : undefined;
    const by = key ? byKey.get(key) : undefined;
    if (!by) continue;
    for (const target of [row, ...containers])
      out.set(target.key, [...(out.get(target.key) ?? []), ...by]);
  }
  return out;
}

// ─── Dropping ────────────────────────────────────────────

type DropTarget = { layer: string; group?: string };

/** What a row takes drops for: a layer or group move, attaching to a follower, or detaching from its type row. */
type DropData =
  | { kind: "place"; target: DropTarget }
  | { kind: "attach"; follower: Ref }
  | { kind: "detach"; type: string };

/**
 * One batch moving entities and instances onto a layer row (their `layer`)
 * or a group row (their `group`, and that row's layer). Bulk entries have no
 * fields and instance children follow their instance, so both are left out;
 * null when nothing changes.
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
    if (target.group !== undefined && e.group !== target.group) set.group = target.group;
    if (Object.keys(set).length === 0) continue;
    ops.push({ op: "update", ref, set });
    moved.push(ref);
  }
  if (ops.length === 0) return null;
  const n = moved.length === 1 ? moved[0]! : `${moved.length} entities`;
  const label =
    target.group !== undefined
      ? `Group ${n} into ${target.group}`
      : `Move ${n} to ${layerTitle(target.layer)}`;
  return { label, ops };
}

/**
 * One batch attaching each of `refs` to `follower`, or detaching each of
 * them of `type` when `follower` is null; null when nothing changes.
 */
function attachAll(
  def: SceneDefinition,
  registry: Registry,
  prefabs: PrefabLibrary | undefined,
  refs: readonly Ref[],
  follower: Ref | null,
  type?: string,
): OpBatch | null {
  const batches = refs.flatMap((ref) => {
    const hit = lookupRef(def, ref);
    if (follower === null && (hit?.kind !== "entity" || hit.entity.type !== type)) return [];
    const b = attachBatch(def, ref, follower, registry, prefabs);
    return b ? [b] : [];
  });
  const [first] = batches;
  if (!first) return null;
  if (batches.length === 1) return first;
  const n = `${batches.length} entities`;
  return {
    label: follower === null ? `Detach ${n}` : `Attach ${n} to ${follower}`,
    ops: batches.flatMap((b) => b.ops),
  };
}

const DROP_OVER = "bg-primary/10 ring-1 ring-primary";

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
    <li ref={setNodeRef} aria-level={level} className={cn("rounded-md", isOver && DROP_OVER)}>
      {children}
    </li>
  );
}

function EntityItem({
  row,
  draggable,
  follower,
  expanded,
  onToggle,
  selected,
  selectedBy,
  indent,
  onSelect,
  onHover,
  onOpenPrefab,
}: {
  row: EntityRow;
  draggable: boolean;
  /** Whether rows can be dropped on this one to ride it. */
  follower: boolean;
  /** Set on a row with rows nested under it: whether they show. */
  expanded?: boolean;
  onToggle?: () => void;
  selected: boolean;
  selectedBy: PeerPresence[] | undefined;
  indent: CSSProperties;
  onSelect: (mode: "replace" | "range" | "toggle") => void;
  onHover?: (ref: Ref | null) => void;
  onOpenPrefab?: (prefab: string, from: Ref) => void;
}) {
  const ref = row.ref;
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: row.key,
    data: { ref },
    disabled: !draggable,
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `attach:${row.key}`,
    data: ref ? ({ kind: "attach", follower: ref } satisfies DropData) : undefined,
    disabled: !follower || !ref,
  });
  const prefab = row.prefab;
  return (
    <li
      ref={setDropRef}
      aria-level={row.depth + 1}
      className={cn("group/row relative rounded-md", isOver && DROP_OVER)}
    >
      {expanded !== undefined && onToggle ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${row.label}`}
          onClick={onToggle}
          className="absolute top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
          style={{ left: `${row.depth * 12 - 8}px` }}
        >
          <HugeiconsIcon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} className="size-3" />
        </button>
      ) : null}
      <button
        ref={setNodeRef}
        type="button"
        disabled={!ref}
        aria-pressed={ref ? selected : undefined}
        {...listeners}
        onClick={(e) => {
          if (!ref) return;
          onSelect(e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace");
        }}
        onPointerEnter={() => ref && onHover?.(ref)}
        onPointerLeave={() => onHover?.(null)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-xs disabled:cursor-default",
          selected ? "bg-primary/15 text-foreground" : "hover:bg-muted",
          isDragging && "opacity-50",
        )}
        style={indent}
      >
        <span
          className={cn("truncate", !row.prefab && row.overrides ? "font-semibold" : undefined)}
        >
          {row.label}
        </span>
        {row.prefab ? (
          <Badge size="label" variant="outline">
            prefab
          </Badge>
        ) : null}
        {selectedBy ? <PeerFaces peers={selectedBy} label="Selected by" size={14} /> : null}
        {row.detail ? (
          <span className="ml-auto shrink-0 text-muted-foreground">{row.detail}</span>
        ) : null}
      </button>
      {prefab && ref && onOpenPrefab ? (
        <Button
          size="xs"
          variant="ghost"
          tooltip={`Open ${prefab} on its own`}
          aria-label={`Open prefab ${prefab}`}
          className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
          onClick={() => onOpenPrefab(prefab, ref)}
        >
          Open
        </Button>
      ) : null}
    </li>
  );
}

/**
 * The scene's rows by type or by layer, filtered by `type:`, `shape:`,
 * `has:problems` chips and free text, with an instance's children nested
 * under it as a tree. In the layer view, dragging entity rows onto a layer or
 * group row moves them there as one batch. In either view, dragging rows
 * whose type has an `attachField` onto a follower's row attaches them to it,
 * and in the type view dropping them on their type's row detaches them. `physical`
 * adds physical issues to `has:problems`; `onHover` reports the row under
 * the pointer for the canvas to highlight.
 */
export function EditorOutliner({
  session,
  physical,
  onHover,
  onOpenPrefab,
}: {
  session: EditorSession;
  physical?: readonly SceneIssue[];
  onHover?: (ref: Ref | null) => void;
  /** Opens an instance's prefab on its own, from the instance's row. */
  onOpenPrefab?: (prefab: string, from: Ref) => void;
}) {
  const doc = useEditorDoc(session);
  const sceneName = useEditorStore(session, (s) => s.sceneName);
  const selection = useEditorStore(session, (s) => s.selection);
  const peers = useEditorStore(session, (s) => s.peers);
  const issues = useEditorStore(session, (s) => s.issues);
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSE_KEY, {}, isRecord));
  const [view, setView] = useState<View>(() => readStored(VIEW_KEY, "type", isView));
  const [query, setQuery] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const prefabs = useSyncExternalStore(
    (changed) => session.prefabs.subscribe(changed),
    () => session.getPrefabs(),
  );
  const byType = useMemo(
    () => buildOutline(doc, session.registry, prefabs),
    [doc, session.registry, prefabs],
  );
  const rows = useMemo<Row[]>(
    () => (view === "layer" ? layerOutline(doc, session.registry, byType) : byType),
    [view, doc, session.registry, byType],
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
  const registry = session.registry;
  const attachable = (row: EntityRow) =>
    !!row.ref &&
    !!row.type &&
    lookupRef(doc, row.ref)?.kind === "entity" &&
    attachFieldOf(registry, row.type) !== null;
  const followerRow = (row: EntityRow) =>
    !!row.ref && !isBulkRef(row.ref) && !!row.type && isFollowerType(registry, row.type);
  const selected = new Set(selection);
  const filtering = !isEmpty(filter);

  const toggle = (row: Row) => {
    const next = { ...collapsed, [row.key]: !(collapsed[row.key] ?? collapsedByDefault(row)) };
    setCollapsed(next);
    writeStored(COLLAPSE_KEY, next);
  };

  const removeChip = (chip: string) =>
    setQuery(
      query
        .split(/\s+/)
        .filter((w) => w && w.toLowerCase() !== chip)
        .join(" "),
    );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const ref = active.data.current?.ref as Ref | undefined;
    const drop = over?.data.current as DropData | undefined;
    if (!ref || !drop) return;
    const dragged = selected.has(ref) ? selection.filter((r) => !isBulkRef(r)) : [ref];
    const current = session.getDoc();
    const batch =
      drop.kind === "place"
        ? dropBatch(current, registry, dragged, drop.target)
        : drop.kind === "attach"
          ? attachAll(current, registry, prefabs, dragged, drop.follower)
          : attachAll(current, registry, prefabs, dragged, null, drop.type);
    if (batch) session.dispatch(batch);
  };

  return (
    <nav aria-label="Outliner" className="flex min-h-0 w-full flex-col gap-1 p-1">
      <div className="flex items-center gap-2 px-2 pt-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{sceneName}</span>
        <SegmentedControl
          size="xs"
          aria-label="Group rows by"
          value={view}
          onChange={(v) => {
            if (!isView(v)) return;
            setView(v);
            writeStored(VIEW_KEY, v);
          }}
        >
          <SegmentedControl.Item
            value="type"
            tooltip="Rows by entity type; drag a row onto a follower to attach it, or onto its type to detach it"
          >
            Type
          </SegmentedControl.Item>
          <SegmentedControl.Item
            value="layer"
            tooltip="Rows by layer and group; drag rows onto one to move them"
          >
            Layer
          </SegmentedControl.Item>
        </SegmentedControl>
      </div>
      <div className="flex flex-col gap-1 px-1">
        <Input
          type="search"
          aria-label="Filter rows"
          placeholder="Filter: type:sensor shape:box has:problems"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
          className="h-7"
        />
        {filterChips(filter).length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {filterChips(filter).map((chip) => (
              <Button
                key={chip}
                size="xs"
                variant="secondary"
                aria-label={`Remove filter ${chip}`}
                onClick={() => removeChip(chip)}
              >
                {chip}
                <HugeiconsIcon icon={Cancel01Icon} />
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {filtering && shown.length === 0 ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">Nothing matches.</li>
          ) : null}
          {shown.map((row) => {
            const indent = { paddingLeft: `${row.depth * 12 + 8}px` };
            if (isEntityRow(row)) {
              const ref = row.ref;
              const opens = !filtering && parents.has(row.key);
              return (
                <EntityItem
                  key={row.key}
                  row={row}
                  draggable={(view === "layer" && !!ref && !isBulkRef(ref)) || attachable(row)}
                  follower={followerRow(row)}
                  {...(opens
                    ? {
                        expanded: !(collapsed[row.key] ?? collapsedByDefault(row)),
                        onToggle: () => toggle(row),
                      }
                    : {})}
                  selected={!!ref && selected.has(ref)}
                  selectedBy={peerMarks.get(row.key)}
                  indent={indent}
                  onSelect={(mode) => ref && session.select([ref], mode, order)}
                  onHover={onHover}
                  onOpenPrefab={onOpenPrefab}
                />
              );
            }
            const open = filtering || !(collapsed[row.key] ?? collapsedByDefault(row));
            const inside = open ? undefined : peerMarks.get(row.key);
            const button = (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(row)}
                className="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left hover:bg-muted"
                style={indent}
              >
                <HugeiconsIcon
                  icon={open ? ArrowDown01Icon : ArrowRight01Icon}
                  className="size-3 text-muted-foreground"
                />
                {row.kind === "type" || row.kind === "layer" ? (
                  <MicroLabel>{row.label}</MicroLabel>
                ) : (
                  <span className="text-xs">{row.label}</span>
                )}
                {inside ? <PeerFaces peers={inside} label="Selected inside by" size={14} /> : null}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {row.count}
                </span>
              </button>
            );
            const header =
              row.kind === "layer" && row.hint ? (
                <SimpleTooltip content={row.hint} side="right">
                  {button}
                </SimpleTooltip>
              ) : (
                button
              );
            if (row.kind === "layer" || row.kind === "group") {
              const target = { layer: row.layer, ...(row.group ? { group: row.group } : {}) };
              return (
                <DropRow
                  key={row.key}
                  id={row.key}
                  data={{ kind: "place", target }}
                  enabled={view === "layer"}
                  level={row.depth + 1}
                >
                  {header}
                </DropRow>
              );
            }
            const type = row.kind === "type" ? row.type : undefined;
            return (
              <DropRow
                key={row.key}
                id={row.key}
                data={{ kind: "detach", type: type ?? "" }}
                enabled={!!type && attachFieldOf(registry, type) !== null}
                level={row.depth + 1}
              >
                {header}
              </DropRow>
            );
          })}
        </ul>
      </DndContext>
    </nav>
  );
}
