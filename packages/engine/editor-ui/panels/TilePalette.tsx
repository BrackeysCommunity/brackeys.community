import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import type { TileBrush, TileToolId } from "../../editor/builtin/tile-tools";
import { setTileBrush, setTileRule, type EditorSession, type Ref } from "../../editor/index";
import { decodeCell, tileTraits } from "../../game/index";
import type { AssetId, ProjectRuntimeView } from "../../project/index";
import type { AutotileRule, TileDef, TilesetFile } from "../../project/kinds/tileset";
import type { EntityDef, SceneDefinition } from "../../scene/types";
import { Button, cx, Facts, MicroLabel, Text } from "../kit/index";
import { useEditorResolved, useEditorStore } from "../session/use-editor-store";
import { createToolHostCell, useToolHost, type ToolHostCell } from "./canvas-layer/tool-host";

export type TilePaletteProps = {
  session: EditorSession;
  /** The project's runtime view, where tileset docs and image sizes are read; null outside a project. */
  runtime: ProjectRuntimeView | null;
  /** A blob asset's URL for the tile images; without it tiles show their ids. */
  imageUrl?: ((id: AssetId) => string | null) | undefined;
  /** The editor's tool host, which a pick switches to a tile tool; without one the pick only sets the brush. */
  tools?: ToolHostCell | undefined;
};

/** The tools a picked stamp keeps; any other tool gives way to the brush. */
const STAMP_TOOLS: readonly string[] = ["tile-brush", "tile-rect", "tile-fill"];

/** A tile's side in the palette, px. */
const TILE_PX = 24;

type Rect = { c0: number; r0: number; c1: number; r1: number };

/** What the palette arms: the session's brush and autotile rule, and the active tool. */
type PaletteArm = {
  setBrush(brush: TileBrush): void;
  setRule(rule: string): void;
  setTool(tool: TileToolId): void;
};

const isTilemap = (e: EntityDef | undefined): e is EntityDef => e?.type === "tilemap";

/** The tilemap the palette edits: the selected one, else the hovered one, else the last or first in the scene. */
function pickTilemap(
  scene: SceneDefinition,
  selection: readonly Ref[],
  hover: Ref | null,
  last: Ref | null,
): EntityDef | null {
  const maps = (scene.entities ?? []).filter(isTilemap);
  const byId = (ref: Ref | null) => (ref === null ? undefined : maps.find((m) => m.id === ref));
  for (const ref of selection) {
    const hit = byId(ref);
    if (hit) return hit;
  }
  return byId(hover) ?? byId(last) ?? maps[0] ?? null;
}

const normal = (a: { c: number; r: number }, b: { c: number; r: number }): Rect => ({
  c0: Math.min(a.c, b.c),
  r0: Math.min(a.r, b.r),
  c1: Math.max(a.c, b.c),
  r1: Math.max(a.r, b.r),
});

/** The stamp a rectangle of the image picks: rows of cell values, a tile's id + 1. */
export function stampOf(rect: Rect, columns: number): TileBrush {
  const tiles: number[][] = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const row: number[] = [];
    for (let c = rect.c0; c <= rect.c1; c++) row.push(r * columns + c + 1);
    tiles.push(row);
  }
  return { tiles };
}

function rowsOf(set: TilesetFile, height: number | undefined): number {
  const [, th] = set.tile;
  const margin = set.margin ?? 0;
  const spacing = set.spacing ?? 0;
  if (height !== undefined && th > 0) {
    return Math.max(1, Math.floor((height - 2 * margin + spacing) / (th + spacing)));
  }
  let top = 0;
  for (const def of set.tiles ?? []) top = Math.max(top, def.id);
  for (const rule of set.rules ?? []) {
    top = Math.max(top, rule.fallback, ...Object.values(rule.tiles));
  }
  return Math.floor(top / Math.max(1, set.columns)) + 1;
}

/** The image a tileset cuts and its size: a texture, or an atlas's texture. */
function imageOf(
  runtime: ProjectRuntimeView | null,
  id: AssetId,
): { id: AssetId; size?: [number, number] } {
  const info = runtime?.asset(id);
  const texture = info?.texture ? runtime?.asset(info.texture) : undefined;
  const use = texture ?? info;
  return { id: use?.id ?? id, ...(use?.size ? { size: use.size } : {}) };
}

/** The tile ids a brush paints, as the palette highlights them. */
export function brushTileIds(brush: TileBrush): Set<number> {
  const ids = new Set<number>();
  for (const row of brush.tiles) {
    for (const value of row) {
      const cell = decodeCell(value);
      if (cell) ids.add(cell.id);
    }
  }
  return ids;
}

/** The tileset's image cut into tiles, its rules, and the picked tile's data. */
export function TilePalette({ session, runtime, imageUrl, tools }: TilePaletteProps) {
  const scene = useEditorResolved(session);
  const selection = useEditorStore(session, (s) => s.selection);
  const hover = useEditorStore(session, (s) => s.hover);
  const tool = useEditorStore(session, (s) => s.tool);
  const brush = useEditorStore(session, (s) => s.tileBrush);
  const armedRule = useEditorStore(session, (s) => s.tileRule);
  const [noTools] = useState(createToolHostCell);
  const toolHost = useToolHost(tools ?? noTools);
  const arm = useMemo<PaletteArm>(
    () => ({
      setBrush: (next) => setTileBrush(session.store, next),
      setRule: (rule) => setTileRule(session.store, rule),
      setTool: (id) => void toolHost?.setTool(id),
    }),
    [session, toolHost],
  );

  const [last, setLast] = useState<Ref | null>(null);
  const map = pickTilemap(scene, selection, hover, last);
  const mapId = map?.id ?? null;
  if (mapId !== null && mapId !== last) setLast(mapId);
  const tilesetId = typeof map?.tileset === "string" ? map.tileset : null;
  const set = tilesetId ? runtime?.doc?.<TilesetFile>("tileset", tilesetId) : undefined;

  if (!map) {
    return (
      <Text as="p" size="xs" variant="muted" className="je-panel-empty">
        Add or select a tilemap to paint its tiles.
      </Text>
    );
  }
  if (!tilesetId || !set) {
    return (
      <Text as="p" size="xs" variant="muted" className="je-panel-empty">
        {tilesetId
          ? `The tileset “${tilesetId}” isn't in the project.`
          : `${map.id} has no tileset.`}
      </Text>
    );
  }
  return (
    <TilesetView
      key={tilesetId}
      mapId={map.id}
      tilesetId={tilesetId}
      set={set}
      runtime={runtime}
      imageUrl={imageUrl}
      arm={arm}
      brush={brush}
      tool={tool}
      armedRule={armedRule}
    />
  );
}

const stampSize = (brush: TileBrush): string =>
  `${Math.max(1, ...brush.tiles.map((r) => r.length))}×${Math.max(1, brush.tiles.length)}`;

function TilesetView({
  mapId,
  tilesetId,
  set,
  runtime,
  imageUrl,
  arm,
  brush,
  tool,
  armedRule,
}: {
  mapId: Ref;
  tilesetId: AssetId;
  set: TilesetFile;
  runtime: ProjectRuntimeView | null;
  imageUrl: TilePaletteProps["imageUrl"];
  arm: PaletteArm;
  brush: TileBrush;
  tool: string;
  armedRule: string | null;
}) {
  const image = imageOf(runtime, set.image);
  const columns = Math.max(1, set.columns);
  const rows = rowsOf(set, image.size?.[1]);
  const url = imageUrl?.(image.id) ?? null;
  const [tw, th] = set.tile;
  const scale = TILE_PX / Math.max(1, tw);

  const picked = useMemo(() => brushTileIds(brush), [brush]);
  const [focus, setFocus] = useState({ c: 0, r: 0 });
  const anchor = useRef<{ c: number; r: number } | null>(null);
  const dragging = useRef(false);
  const grid = useRef<HTMLDivElement>(null);

  const choose = (rect: Rect) => {
    arm.setBrush(stampOf(rect, columns));
    if (!STAMP_TOOLS.includes(tool)) arm.setTool("tile-brush");
  };
  const pick = (at: { c: number; r: number }, extend: boolean) => {
    if (!extend || !anchor.current) anchor.current = at;
    choose(normal(anchor.current, at));
  };

  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const moveFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = step[e.key];
    if (d) {
      e.preventDefault();
      const next = {
        c: Math.min(columns - 1, Math.max(0, focus.c + d[0])),
        r: Math.min(rows - 1, Math.max(0, focus.r + d[1])),
      };
      setFocus(next);
      grid.current
        ?.querySelector<HTMLElement>(`[data-tile="${next.r * columns + next.c}"]`)
        ?.focus();
      if (e.shiftKey) pick(next, true);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(focus, e.shiftKey);
    }
  };

  const margin = set.margin ?? 0;
  const spacing = set.spacing ?? 0;
  const tileStyle = (c: number, r: number): CSSProperties => ({
    width: TILE_PX,
    height: Math.round(th * scale),
    ...(url
      ? {
          backgroundImage: `url("${url}")`,
          backgroundPosition: `${-(margin + c * (tw + spacing)) * scale}px ${-(margin + r * (th + spacing)) * scale}px`,
          ...(image.size
            ? { backgroundSize: `${image.size[0] * scale}px ${image.size[1] * scale}px` }
            : {}),
        }
      : {}),
  });

  const defs = useMemo(() => new Map((set.tiles ?? []).map((d) => [d.id, d])), [set.tiles]);
  const first = picked.values().next().value ?? null;
  const size = stampSize(brush);

  return (
    <div className="je-tile-palette" data-tilemap={mapId}>
      <div className="je-tile-palette-head">
        <Text size="xs" ellipsis>
          {tilesetId}
        </Text>
        <Text size="xs" variant="muted" tabular>
          {size !== "1×1" ? `${size} stamp` : `${tw}×${th} px`}
        </Text>
      </div>
      <div
        ref={grid}
        role="grid"
        aria-label={`Tiles of ${tilesetId}`}
        aria-multiselectable="true"
        className="je-tile-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, ${TILE_PX}px)` }}
        onKeyDown={moveFocus}
      >
        {Array.from({ length: rows }, (_, r) => (
          <div role="row" key={r} className="je-tile-row">
            {Array.from({ length: columns }, (_, c) => {
              const id = r * columns + c;
              return (
                <div
                  key={c}
                  role="gridcell"
                  aria-selected={picked.has(id)}
                  aria-label={`Tile ${id}`}
                  data-tile={id}
                  tabIndex={focus.c === c && focus.r === r ? 0 : -1}
                  className={cx("je-tile", url ? null : "je-tile-blank")}
                  style={tileStyle(c, r)}
                  onFocus={() => setFocus({ c, r })}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    dragging.current = true;
                    setFocus({ c, r });
                    pick({ c, r }, e.shiftKey);
                  }}
                  onPointerEnter={() => {
                    if (dragging.current) pick({ c, r }, true);
                  }}
                >
                  {url ? null : id}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {(set.rules ?? []).length > 0 ? (
        <RuleList
          rules={set.rules ?? []}
          armed={tool === "tile-auto" ? armedRule : null}
          onArm={(rule) => {
            arm.setRule(rule);
            arm.setTool("tile-auto");
          }}
        />
      ) : null}
      {first !== null ? <TileData id={first} def={defs.get(first)} /> : null}
    </div>
  );
}

function RuleList({
  rules,
  armed,
  onArm,
}: {
  rules: readonly AutotileRule[];
  armed: string | null;
  onArm: (rule: string) => void;
}) {
  return (
    <section className="je-tile-section" aria-label="Autotile rules">
      <MicroLabel as="div">Rules</MicroLabel>
      <ul className="je-tile-rules">
        {rules.map((rule) => (
          <li key={rule.id}>
            <Button
              variant="ghost"
              size="xs"
              className="je-tile-rule"
              aria-pressed={armed === rule.id}
              tooltip={`Paint ${rule.terrain} with the autotile brush`}
              onClick={() => onArm(rule.id)}
            >
              <Text size="xs" ellipsis>
                {rule.id}
              </Text>
              <Text size="xs" variant="muted">
                {rule.terrain} · {rule.kind}
              </Text>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A tile's data, read-only: editing goes through the tileset's own panel. */
function TileData({ id, def }: { id: number; def: TileDef | undefined }) {
  const traits = tileTraits(def);
  const rows: [string, string][] = [["Id", String(id)]];
  if (traits.solid) rows.push(["Solid", "yes"]);
  if (traits.oneWay) rows.push(["One-way", traits.oneWay]);
  if (traits.cost !== null) rows.push(["Cost", String(traits.cost)]);
  if (def?.material) rows.push(["Material", def.material]);
  if (def?.tags?.length) rows.push(["Tags", def.tags.join(", ")]);
  if (traits.shapes) rows.push(["Shapes", String(traits.shapes.length)]);
  if (def?.animation?.length) rows.push(["Frames", String(def.animation.length)]);
  if (def?.data) {
    for (const [key, value] of Object.entries(def.data)) rows.push([key, JSON.stringify(value)]);
  }
  return (
    <section className="je-tile-section" aria-label="Tile data">
      <MicroLabel as="div">Tile</MicroLabel>
      <Facts rows={rows} />
      {def ? null : (
        <Text as="p" size="xs" variant="muted">
          No data; it draws only.
        </Text>
      )}
    </section>
  );
}
