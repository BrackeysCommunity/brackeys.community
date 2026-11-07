import { bulkBehavior, bulkId } from "./expand";
import { sceneHash } from "./hash";
import { jsonPointer, lineAt, makeIssue } from "./issues";
import { aabb, aabbUnion, isConvex, translateShape } from "./shape-geometry";
import { parseShape } from "./shapes";
import {
  SHAPE_BULK_KEYS,
  type Aabb,
  type Behavior,
  type EntityDef,
  type IssueCode,
  type OpBatch,
  type Pt,
  type Ref,
  type SceneDefinition,
  type SceneIssue,
  type SceneOp,
  type ShapeTuple,
} from "./types";

export type ValidateOptions = { lines?: ReadonlyMap<string, number> };

/** Player collision box, for spawn checks; a spawn is the box's bottom centre. */
const PLAYER_W = 60;
const PLAYER_H = 60;

/**
 * Fields that hold references to other entities, per behavior, and which
 * behaviors each may target. Format v1 has none; `dangling-ref` and
 * `ref-type` run over this table so a new field only needs a row here.
 */
export type ReferenceField = { field: string; targets: readonly Behavior[] };
export const REFERENCE_FIELDS: Readonly<Partial<Record<Behavior, readonly ReferenceField[]>>> =
  Object.freeze({});

type Item = {
  ref: Ref;
  pointer: string;
  b: Behavior;
  shape?: ShapeTuple;
  at?: Pt;
  entity?: EntityDef;
};

function items(def: SceneDefinition): Item[] {
  const list: Item[] = [];
  for (const key of SHAPE_BULK_KEYS) {
    const { b } = bulkBehavior(key);
    (def[key] ?? []).forEach((shape, i) =>
      list.push({ ref: bulkId(key, i), pointer: jsonPointer([key, i]), b, shape }),
    );
  }
  (def.anchor ?? []).forEach((at, i) =>
    list.push({ ref: bulkId("anchor", i), pointer: jsonPointer(["anchor", i]), b: "anchor", at }),
  );
  (def.entities ?? []).forEach((e, i) => {
    const item: Item = { ref: e.id, pointer: jsonPointer(["entities", i]), b: e.b, entity: e };
    if ("shape" in e) item.shape = e.shape;
    if ("at" in e) item.at = e.at;
    list.push(item);
  });
  return list;
}

const isInt = (n: number) => Number.isInteger(n);
const SEVERITY_RANK = { error: 0, warn: 1, info: 2 } as const;

function dedupe(pts: readonly Pt[], closed: boolean): Pt[] {
  const out = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  while (
    closed &&
    out.length > 1 &&
    out[0][0] === out[out.length - 1][0] &&
    out[0][1] === out[out.length - 1][1]
  )
    out.pop();
  return out;
}

function firstRepeat(pts: readonly Pt[], closed: boolean): number {
  for (let i = 1; i < pts.length; i++)
    if (pts[i][0] === pts[i - 1][0] && pts[i][1] === pts[i - 1][1]) return i;
  if (closed && pts.length > 1) {
    const last = pts[pts.length - 1];
    if (last[0] === pts[0][0] && last[1] === pts[0][1]) return pts.length - 1;
  }
  return -1;
}

function roundTuple(t: ShapeTuple): ShapeTuple {
  const [tag, ...nums] = t;
  const positive =
    tag === "box" ? [2, 3] : tag === "circle" ? [2] : tag === "capsule" ? [2, 3] : [];
  return [
    tag,
    ...nums.map((n, i) => (positive.includes(i) ? Math.max(1, Math.round(n)) : Math.round(n))),
  ] as ShapeTuple;
}

const roundPt = ([x, y]: Pt): Pt => [Math.round(x), Math.round(y)];

function center(b: Aabb): Pt {
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/**
 * Structural checks over a parsed scene: ids, spawns, geometry, paths,
 * integer pixels and bounds. No physics. Each issue names the entity (bulk
 * entries by their `~key:index` reference) and carries a `fix` batch when
 * one is mechanical; fixes that use a `~` reference carry `base`.
 */
export function validateScene(def: SceneDefinition, opts: ValidateOptions = {}): SceneIssue[] {
  const issues: SceneIssue[] = [];
  let hash: string | undefined;
  const base = () => (hash ??= sceneHash(def));

  const batch = (label: string, ops: SceneOp[], refs: Ref[]): OpBatch =>
    refs.some((r) => r.startsWith("~")) ? { label, base: base(), ops } : { label, ops };

  const push = (code: IssueCode, fields: Partial<SceneIssue> & { message: string }) => {
    const issue = makeIssue(code, fields);
    if (opts.lines && issue.path !== undefined) {
      const line = lineAt(opts.lines, issue.path);
      if (line !== undefined) issue.line = line;
    }
    issues.push(issue);
  };

  const all = items(def);
  const [minX, minY, maxX, maxY] = def.bounds;

  // ids
  const seen = new Map<string, number>();
  const ids = new Set((def.entities ?? []).map((e) => e.id));
  (def.entities ?? []).forEach((e, i) => {
    const first = seen.get(e.id);
    if (first === undefined) {
      seen.set(e.id, i);
      return;
    }
    let n = 2;
    while (ids.has(`${e.id}-${n}`)) n++;
    push("dup-id", {
      message: `two entities have the id "${e.id}"`,
      path: jsonPointer(["entities", i, "id"]),
      entityIds: [e.id],
      hint: `Give the later "${e.id}" a new id, e.g. "${e.id}-${n}".`,
    });
  });

  // references
  for (const [i, e] of (def.entities ?? []).entries()) {
    for (const { field, targets } of REFERENCE_FIELDS[e.b] ?? []) {
      const value = (e as Record<string, unknown>)[field];
      const refs = Array.isArray(value) ? value : value === undefined ? [] : [value];
      refs.forEach((target, k) => {
        const path = jsonPointer(
          Array.isArray(value) ? ["entities", i, field, k] : ["entities", i, field],
        );
        const hit = (def.entities ?? []).find((t) => t.id === target);
        const remove: SceneOp = Array.isArray(value)
          ? { op: "update", ref: e.id, set: { [field]: value.filter((_, j) => j !== k) } }
          : { op: "update", ref: e.id, unset: [field] };
        if (!hit) {
          push("dangling-ref", {
            message: `${e.id}.${field} names "${String(target)}", which doesn't exist`,
            path,
            entityIds: [e.id],
            fix: batch(`Remove ${e.id}.${field} reference`, [remove], [e.id]),
          });
        } else if (!targets.includes(hit.b)) {
          push("ref-type", {
            message: `${e.id}.${field} targets ${hit.id}, a ${hit.b}; it can target ${targets.join(" or ")}`,
            path,
            entityIds: [e.id, hit.id],
            expected: targets.join(" | "),
            got: hit.b,
            fix: batch(`Remove ${e.id}.${field} reference`, [remove], [e.id]),
          });
        }
      });
    }
  }

  // spawns
  if (def.spawn.length === 0) {
    push("spawn-missing", { message: "the scene has no spawn point", path: "/spawn" });
  }
  def.spawn.forEach((s, j) => {
    for (let i = 0; i < j; i++) {
      const o = def.spawn[i];
      if (Math.abs(s[0] - o[0]) < PLAYER_W && Math.abs(s[1] - o[1]) < PLAYER_H) {
        push("spawn-overlap", {
          message: `spawn ${j} at [${s[0]}, ${s[1]}] overlaps spawn ${i} at [${o[0]}, ${o[1]}]`,
          path: jsonPointer(["spawn", j]),
          at: [s[0], s[1]],
        });
      }
    }
  });

  // per item
  for (const item of all) {
    const { ref, pointer, b, entity } = item;
    const shape = item.shape ? parseShape(item.shape) : undefined;
    const obj = shape?.ok ? shape.shape : undefined;

    if (obj?.type === "poly" && !isConvex(obj.pts)) {
      const canChain = b === "solid" || b === "sensor";
      const chain: ShapeTuple = ["chain", ...obj.pts.flat(), ...obj.pts[0]];
      push("poly-invalid", {
        message: `${ref}'s poly isn't a simple convex polygon (non-convex, self-intersecting or zero area)`,
        path: `${pointer}${entity ? "/shape" : ""}`,
        entityIds: [ref],
        at: center(aabb(obj)),
        hint: canChain
          ? "Convert it to a chain of the same outline, or split it into convex polys."
          : `Split it into convex polys; chain isn't allowed on ${b}.`,
        fix: canChain
          ? batch(
              `Convert ${ref} to a chain`,
              [{ op: "update", ref, set: { shape: chain } }],
              [ref],
            )
          : undefined,
      });
    }

    if (obj?.type === "chain") {
      const k = firstRepeat(obj.pts, false);
      if (k >= 0) {
        const pts = dedupe(obj.pts, false);
        push("chain-invalid", {
          message: `${ref}'s chain repeats point ${k} at [${obj.pts[k][0]}, ${obj.pts[k][1]}], a zero-length segment`,
          path: `${pointer}${entity ? "/shape" : ""}`,
          entityIds: [ref],
          at: [obj.pts[k][0], obj.pts[k][1]],
          fix:
            pts.length >= 2
              ? batch(
                  `Drop the repeated point in ${ref}`,
                  [{ op: "update", ref, set: { shape: ["chain", ...pts.flat()] } }],
                  [ref],
                )
              : undefined,
        });
      }
    }

    if (entity?.b === "mover") {
      const { path } = entity;
      const pathPointer = `${pointer}/path`;
      if (path.pts.length < 2 || !(path.speed > 0)) {
        push("path-invalid", {
          message:
            path.pts.length < 2
              ? `${ref}'s path has ${path.pts.length} point${path.pts.length === 1 ? "" : "s"}; it needs at least 2`
              : `${ref}'s path speed is ${path.speed}; it must be > 0 px/s`,
          path: path.pts.length < 2 ? `${pathPointer}/pts` : `${pathPointer}/speed`,
          entityIds: [ref],
          expected: path.pts.length < 2 ? ">= 2 points" : "> 0",
          got: path.pts.length < 2 ? String(path.pts.length) : String(path.speed),
        });
      }
      const closed = path.mode === "loop";
      const k = firstRepeat(path.pts, closed);
      if (k >= 0) {
        const pts = dedupe(path.pts, closed);
        push("path-degenerate", {
          message: `${ref}'s path repeats [${path.pts[k][0]}, ${path.pts[k][1]}] at point ${k}; the mover skips it`,
          path: `${pathPointer}/pts/${k}`,
          entityIds: [ref],
          at: [path.pts[k][0], path.pts[k][1]],
          fix:
            pts.length >= 2
              ? batch(
                  `Drop the repeated point in ${ref}'s path`,
                  [{ op: "update", ref, set: { "path.pts": pts } }],
                  [ref],
                )
              : undefined,
        });
      }
    }

    // integer pixels
    const set: Record<string, unknown> = {};
    let firstBad: string | undefined;
    const flag = (field: string, bad: string, value: unknown) => {
      firstBad ??= bad;
      set[field] = value;
    };
    if (item.shape) {
      const k = item.shape.findIndex((n, i) => i > 0 && typeof n === "number" && !isInt(n));
      if (k > 0) flag("shape", `${pointer}${entity ? "/shape" : ""}/${k}`, roundTuple(item.shape));
    }
    if (item.at && !(isInt(item.at[0]) && isInt(item.at[1]))) {
      flag("at", `${pointer}${entity ? "/at" : ""}/${isInt(item.at[0]) ? 1 : 0}`, roundPt(item.at));
    }
    if (entity?.b === "mover") {
      const k = entity.path.pts.findIndex((p) => !(isInt(p[0]) && isInt(p[1])));
      if (k >= 0) flag("path.pts", `${pointer}/path/pts/${k}`, entity.path.pts.map(roundPt));
    }
    if (firstBad !== undefined) {
      push("non-integer", {
        message: `${ref} has a coordinate that isn't a whole pixel (${Object.keys(set).join(", ")})`,
        path: firstBad,
        entityIds: [ref],
        fix: batch(`Round ${ref} to whole pixels`, [{ op: "update", ref, set }], [ref]),
      });
    }

    // bounds
    if (b !== "note") {
      let box: Aabb | undefined;
      if (entity?.b === "mover" && obj) {
        for (const p of entity.path.pts) {
          const moved = aabb(translateShape(obj, p));
          box = box ? aabbUnion(box, moved) : moved;
        }
      } else if (obj) box = aabb(obj);
      else if (item.at)
        box = { minX: item.at[0], minY: item.at[1], maxX: item.at[0], maxY: item.at[1] };
      if (box && (box.minX < minX || box.minY < minY || box.maxX > maxX || box.maxY > maxY)) {
        const grown = aabbUnion({ minX, minY, maxX, maxY }, box);
        push("out-of-bounds", {
          message: `${ref} reaches outside the scene bounds [${minX}, ${minY}, ${maxX}, ${maxY}]`,
          path: pointer,
          entityIds: [ref],
          at: center(box),
          fix: batch(
            `Grow bounds to fit ${ref}`,
            [
              {
                op: "setScene",
                set: {
                  bounds: [
                    Math.floor(grown.minX),
                    Math.floor(grown.minY),
                    Math.ceil(grown.maxX),
                    Math.ceil(grown.maxY),
                  ],
                },
              },
            ],
            [],
          ),
        });
      }
    }

    if (entity?.b === "construct" && entity.type === "wind_zone" && (entity.rot ?? 0) % 360 !== 0) {
      push("wind-rotation", {
        message: `${ref} is a wind zone rotated ${entity.rot}°, but the player ignores wind rotation`,
        path: `${pointer}/rot`,
        entityIds: [ref],
        at: [entity.at[0], entity.at[1]],
        fix: batch(`Unrotate ${ref}`, [{ op: "update", ref, unset: ["rot"] }], [ref]),
      });
    }
  }

  def.spawn.forEach((s, i) => {
    const path = jsonPointer(["spawn", i]);
    if (!(isInt(s[0]) && isInt(s[1]))) {
      push("non-integer", {
        message: `spawn ${i} at [${s[0]}, ${s[1]}] isn't on whole pixels`,
        path,
        at: [s[0], s[1]],
        fix: { label: `Round spawn ${i}`, ops: [{ op: "setSpawn", index: i, at: roundPt(s) }] },
      });
    }
    if (s[0] < minX || s[0] > maxX || s[1] - PLAYER_H < minY || s[1] > maxY) {
      const grown = aabbUnion(
        { minX, minY, maxX, maxY },
        { minX: s[0] - PLAYER_W / 2, minY: s[1] - PLAYER_H, maxX: s[0] + PLAYER_W / 2, maxY: s[1] },
      );
      push("out-of-bounds", {
        message: `spawn ${i} at [${s[0]}, ${s[1]}] is outside the scene bounds`,
        path,
        at: [s[0], s[1]],
        fix: {
          label: `Grow bounds to fit spawn ${i}`,
          ops: [
            {
              op: "setScene",
              set: {
                bounds: [
                  Math.floor(grown.minX),
                  Math.floor(grown.minY),
                  Math.ceil(grown.maxX),
                  Math.ceil(grown.maxY),
                ],
              },
            },
          ],
        },
      });
    }
  });

  // playability
  const live = (def.entities ?? []).filter((e) => !e.off);
  if (!live.some((e) => e.b === "sensor" && (e.kind === "goal" || e.kind === "exit"))) {
    push("no-goal", {
      message: "the scene has no goal or exit sensor, so a run can't finish",
      path: "",
    });
  }
  const killPlane = live.some((e) => {
    if (e.b !== "sensor" || e.kind !== "hazard") return false;
    const s = parseShape(e.shape);
    if (!s.ok) return false;
    const box = aabb(s.shape);
    return box.minX <= minX && box.maxX >= maxX;
  });
  if (!killPlane) {
    push("no-kill-plane", {
      message: "no hazard sensor spans the bounds' full width, so a fall never ends",
      path: "/bounds",
    });
  }

  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => SEVERITY_RANK[a.issue.severity] - SEVERITY_RANK[b.issue.severity] || a.i - b.i)
    .map(({ issue }) => issue);
}
