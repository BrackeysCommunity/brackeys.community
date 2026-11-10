import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { NUDGE, testGame } from "../../__tests__/fixtures/test-game";
import { createRegistry } from "../../game/define";
import { stableJson } from "../../project/canonical";
import {
  createKindRegistry,
  parseAssetDoc,
  type DocKindDef,
  type DocLayout,
  type KindEnv,
} from "../../project/kinds";
import { rng } from "../../scene/__tests__/fixtures/random-ops";
import { readCell, type CellEdit, type GridCells } from "../../scene/grid";
import { SCENE_FORMAT_VERSION, type Prefab, type SceneDefinition } from "../../scene/types";
import { applyOpsToDoc } from "../apply";
import { docToScene, entitiesMap, gridRowKey, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { layoutFromDoc, layoutPatch, layoutToDoc } from "../layout";
import { docToPrefab, prefabPatch, prefabToDoc } from "../prefab-doc";
import type { DocOrigin } from "../types";
import { deckGame, deckKind } from "./fixtures/deck-kind";
import {
  genMap,
  genRoot,
  int,
  mutateRoot,
  pick,
  type MapLayout,
  type Rand,
} from "./fixtures/layout-gen";
import { must } from "./helpers";
import { SimNetwork } from "./sim-network";

type Obj = Record<string, unknown>;
const ATOMIC: DocLayout = { as: "atomic" };

// ─── Helpers ─────────────────────────────────────────────

const origins: DocOrigin[] = Array.from({ length: 6 }, (_, i) => ({
  kind: "user",
  userId: `u${i}`,
}));

function network(layout: MapLayout, value: Obj, clients: number, rand: Rand) {
  const seed = layoutToDoc(
    new Y.Doc(),
    layout,
    value,
    { kind: "disk" },
    { key: sequentialKeys("s") },
  );
  const net = new SimNetwork(clients, rand, seed);
  const keys = net.docs.map((_, i) => sequentialKeys(`c${i}-`));
  const write = (i: number, change: (v: Obj) => Obj) => {
    const doc = net.docs[i]!;
    const next = change(layoutFromDoc(doc, layout));
    layoutPatch(doc, layout, next, origins[i], { key: keys[i] });
    expect(layoutFromDoc(doc, layout)).toEqual(JSON.parse(JSON.stringify(next)));
  };
  const values = () => net.docs.map((d) => layoutFromDoc(d, layout));
  return { net, write, values };
}

function expectConverged(values: Obj[], label: string): void {
  const texts = values.map((v) => stableJson(v));
  for (let i = 1; i < texts.length; i++) expect(texts[i], `${label}, client ${i}`).toBe(texts[0]);
}

// ─── Tests ───────────────────────────────────────────────

describe("declarative layouts converge", () => {
  it("random edits over generated layouts, delivery order, partitions and reconnects", () => {
    let writes = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(seed * 7919);
      const layout = genMap(rand, 3);
      const clients = 2 + (seed % 3);
      const { net, values } = network(layout, genRoot(rand, layout), clients, rand);
      const keys = net.docs.map((_, i) => sequentialKeys(`c${i}-`));
      for (let step = 0; step < 50; step++) {
        const i = int(rand, clients);
        const doc = net.docs[i]!;
        const next = mutateRoot(rand, layout, layoutFromDoc(doc, layout));
        if (layoutPatch(doc, layout, next, origins[i], { key: keys[i] })) writes++;
        net.deliver(int(rand, 4));
        const roll = rand();
        if (roll < 0.06) net.partition([int(rand, clients)]);
        else if (roll < 0.12) net.heal();
      }
      net.settle();
      const converged = values();
      expectConverged(converged, `seed ${seed}`);
      for (const [i, doc] of net.docs.entries())
        expect(layoutPatch(doc, layout, converged[i], origins[i]), `seed ${seed} stable`).toBe(
          false,
        );
    }
    expect(writes).toBeGreaterThan(2000);
  }, 120_000);

  it("keeps every keyed item a client inserted and didn't delete, whatever else raced it", () => {
    const layout: MapLayout = {
      as: "map",
      fields: {
        table: ATOMIC,
        rows: { as: "keyed", item: { as: "map", fields: { note: { as: "text" } }, rest: ATOMIC } },
      },
    };
    for (let seed = 1; seed <= 30; seed++) {
      const rand = rng(seed * 31337);
      const clients = 2 + (seed % 3);
      const start = { table: "card", rows: [{ id: "base", cost: 1, note: "n" }] };
      const { net, write, values } = network(layout, start, clients, rand);
      const live = new Set<string>(["base"]);
      let n = 0;
      for (let step = 0; step < 80; step++) {
        const i = int(rand, clients);
        const mine = (rows: Obj[]) => rows.filter((r) => String(r.id).startsWith(`c${i}-`));
        write(i, (v) => {
          const rows = [...(v.rows as Obj[])];
          const r = rand();
          if (r < 0.35 || rows.length === 0) {
            const id = `c${i}-${n++}`;
            live.add(id);
            rows.splice(int(rand, rows.length + 1), 0, { id, cost: int(rand, 9), note: "" });
          } else if (r < 0.45 && mine(rows).length > 0) {
            const gone = pick(rand, mine(rows));
            live.delete(String(gone.id));
            rows.splice(rows.indexOf(gone), 1);
          } else if (r < 0.6) {
            const [moved] = rows.splice(int(rand, rows.length), 1);
            rows.splice(int(rand, rows.length + 1), 0, moved!);
          } else {
            const at = int(rand, rows.length);
            const row = rows[at]!;
            rows[at] =
              rand() < 0.5
                ? { ...row, cost: int(rand, 9) }
                : { ...row, note: `${String(row.note)}${pick(rand, ["a", "b"])}` };
          }
          return { ...v, rows };
        });
        net.deliver(int(rand, 5));
        const roll = rand();
        if (roll < 0.06) net.partition([int(rand, clients)]);
        else if (roll < 0.12) net.heal();
      }
      net.settle();
      const converged = values();
      expectConverged(converged, `seed ${seed}`);
      const ids = (converged[0]!.rows as Obj[]).map((r) => r.id as string);
      expect(new Set(ids), `seed ${seed}`).toEqual(live);
      expect(ids.length, `seed ${seed}: no item twice`).toBe(live.size);
    }
  }, 120_000);

  describe("merges by layout", () => {
    const layout: MapLayout = {
      as: "map",
      fields: {
        title: { as: "text" },
        style: { as: "map", rest: ATOMIC },
        steps: { as: "list", item: ATOMIC },
        rows: { as: "keyed", item: { as: "map", rest: ATOMIC } },
      },
      rest: ATOMIC,
    };
    const start = {
      title: "Deck",
      style: { fill: "#fff", line: 1 },
      steps: ["a", "b"],
      rows: [
        { id: "fireball", cost: 3, damage: 5 },
        { id: "heal", cost: 2, damage: 0 },
      ],
      mode: "easy",
    };
    const offline = (fn: (w: ReturnType<typeof network>["write"]) => void) => {
      const s = network(layout, start, 2, rng(1));
      s.net.partition([0]);
      fn(s.write);
      s.net.settle();
      const vs = s.values();
      expectConverged(vs, "two clients");
      return vs[0]!;
    };
    const rowsOf = (v: Obj) => v.rows as Obj[];

    it("map: concurrent edits of different keys both land", () => {
      const v = offline((write) => {
        write(0, (x) => ({ ...x, style: { ...(x.style as Obj), fill: "#000" } }));
        write(1, (x) => ({ ...x, style: { ...(x.style as Obj), line: 2 }, extra: true }));
      });
      expect(v.style).toEqual({ fill: "#000", line: 2 });
      expect(v.extra).toBe(true);
    });

    it("atomic: concurrent writes of one key end on one of them", () => {
      const v = offline((write) => {
        write(0, (x) => ({ ...x, mode: "hard" }));
        write(1, (x) => ({ ...x, mode: "normal" }));
      });
      expect(["hard", "normal"]).toContain(v.mode);
    });

    it("text: concurrent edits merge by character", () => {
      const v = offline((write) => {
        write(0, (x) => ({ ...x, title: "Red Deck" }));
        write(1, (x) => ({ ...x, title: "Deck 2" }));
      });
      expect(v.title).toBe("Red Deck 2");
    });

    it("list: concurrent inserts both land; an item edited on both sides is replaced by both", () => {
      const v = offline((write) => {
        write(0, (x) => ({ ...x, steps: ["a", "x", "b"] }));
        write(1, (x) => ({ ...x, steps: ["a", "b", "y"] }));
      });
      expect(v.steps).toEqual(["a", "x", "b", "y"]);
      const w = offline((write) => {
        write(0, (x) => ({ ...x, steps: ["a", "b1"] }));
        write(1, (x) => ({ ...x, steps: ["a", "b2"] }));
      });
      expect((w.steps as string[]).slice().sort()).toEqual(["a", "b1", "b2"]);
    });

    it("keyed: concurrent edits of different fields of one item both land", () => {
      const v = offline((write) => {
        write(0, (x) => ({ ...x, rows: [{ ...rowsOf(x)[0]!, cost: 4 }, rowsOf(x)[1]] }));
        write(1, (x) => ({ ...x, rows: [{ ...rowsOf(x)[0]!, damage: 6 }, rowsOf(x)[1]] }));
      });
      expect(rowsOf(v)[0]).toEqual({ id: "fireball", cost: 4, damage: 6 });
    });

    it("keyed: concurrent inserts, a reorder and a field edit all land", () => {
      const v = offline((write) => {
        write(0, (x) => ({
          ...x,
          rows: [rowsOf(x)[1], { id: "bolt", cost: 1 }, { ...rowsOf(x)[0]!, cost: 9 }],
        }));
        write(1, (x) => ({ ...x, rows: [...rowsOf(x), { id: "shield", cost: 2 }] }));
      });
      expect(rowsOf(v).map((r) => r.id)).toEqual(
        expect.arrayContaining(["heal", "bolt", "fireball", "shield"]),
      );
      expect(rowsOf(v)).toHaveLength(4);
      expect(rowsOf(v).find((r) => r.id === "fireball")!.cost).toBe(9);
      expect(rowsOf(v)[0]!.id).toBe("heal");
    });

    it("keyed: two concurrent creates with one id stay two", () => {
      const v = offline((write) => {
        write(0, (x) => ({ ...x, rows: [...rowsOf(x), { id: "bolt", cost: 1 }] }));
        write(1, (x) => ({ ...x, rows: [...rowsOf(x), { id: "bolt", cost: 7 }] }));
      });
      const bolts = rowsOf(v).filter((r) => r.id === "bolt");
      expect(bolts.map((b) => b.cost as number).sort((a, b) => a - b)).toEqual([1, 7]);
    });

    it("keyed: a delete racing a field edit removes the item everywhere", () => {
      const v = offline((write) => {
        write(0, (x) => ({ ...x, rows: [rowsOf(x)[1]] }));
        write(1, (x) => ({ ...x, rows: [{ ...rowsOf(x)[0]!, cost: 8 }, rowsOf(x)[1]] }));
      });
      expect(rowsOf(v)).toEqual([{ id: "heal", cost: 2, damage: 0 }]);
    });
  });
});

describe("the engine's doc kinds and a game's converge", () => {
  const env: KindEnv = { registry: createRegistry(deckGame), project: null };
  const kinds = createKindRegistry(deckGame);
  const kind = (name: string) => {
    const def = kinds.get(name);
    if (def?.storage !== "doc" || def.layout === "custom")
      throw new Error(`no declarative ${name}`);
    return def as DocKindDef & { layout: MapLayout };
  };
  const START: Record<string, Obj> = {
    material: {
      kind: "material",
      v: 1,
      description: "Rubber.",
      physics: { friction: 0.4, restitution: 0.9 },
      render: { style: { fill: "#e05a5a" }, tint: "#ffffff" },
    },
    "game-settings": { kind: "game-settings", v: 1, engine: {}, game: { avatarSpeed: 200 } },
    "data-table": {
      kind: "data-table",
      v: 1,
      table: "card",
      rows: [
        { id: "fireball", cost: 3, damage: 5 },
        { id: "heal", cost: 2 },
      ],
    },
    "input-script": { v: 1, scene: "yard", steps: [{ wait: 10 }, { hold: ["right"], for: 20 }] },
    checks: {
      v: 1,
      checks: [
        { id: "valid", kind: "valid" },
        {
          id: "settles",
          kind: "reaches",
          script: { v: 1, steps: [{ wait: 60 }] },
          result: "script-end",
        },
      ],
    },
    [deckKind.kind]: {
      v: 1,
      title: "Red deck",
      style: { fill: "#f00", line: [1, 2] },
      tags: ["fast", "red"],
      cards: [{ id: "zap", note: "cheap", cost: 0 }, { id: "bolt" }],
    },
  };
  const declarative = kinds
    .list()
    .filter((k) => k.storage === "doc" && k.layout !== "custom")
    .map((k) => k.kind);

  it("has a start value for every declarative kind, the game's among them, each valid", () => {
    expect(declarative).toContain(deckKind.kind);
    expect(Object.keys(START).sort()).toEqual([...declarative].sort());
    for (const name of declarative)
      expect(parseAssetDoc(kind(name), START[name], env).ok).toBe(true);
  });

  for (const name of declarative) {
    it(`${name}: random edits on its layout converge`, { timeout: 30_000 }, () => {
      const { layout } = kind(name);
      for (let seed = 1; seed <= 12; seed++) {
        const rand = rng(seed * 104_729);
        const clients = 2 + (seed % 3);
        const { net, values } = network(layout, START[name]!, clients, rand);
        const keys = net.docs.map((_, i) => sequentialKeys(`c${i}-`));
        for (let step = 0; step < 40; step++) {
          const i = int(rand, clients);
          const doc = net.docs[i]!;
          layoutPatch(
            doc,
            layout,
            mutateRoot(rand, layout, layoutFromDoc(doc, layout)),
            origins[i],
            {
              key: keys[i],
            },
          );
          net.deliver(int(rand, 4));
          const roll = rand();
          if (roll < 0.1) net.partition([int(rand, clients)]);
          else if (roll < 0.2) net.heal();
        }
        net.settle();
        expectConverged(values(), `${name} seed ${seed}`);
      }
    });
  }

  const offline = (name: string, edits: ((v: Obj) => Obj)[]) => {
    const { layout } = kind(name);
    const s = network(layout, START[name]!, edits.length, rng(7));
    s.net.partition([0]);
    edits.forEach((edit, i) => s.write(i, edit));
    s.net.settle();
    const vs = s.values();
    expectConverged(vs, name);
    const merged = vs[0]!;
    const parsed = parseAssetDoc(kind(name), merged, env);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    return merged;
  };
  const rows = (v: Obj) => v.rows as Obj[];
  const items = (v: Obj, key: string) => v[key] as Obj[];

  it("material: concurrent edits of different fields both land", () => {
    const v = offline("material", [
      (x) => ({ ...x, description: "Hard rubber." }),
      (x) => ({ ...x, render: { style: { fill: "#00ff00" } } }),
    ]);
    expect(v.description).toBe("Hard rubber.");
    expect(v.render).toEqual({ style: { fill: "#00ff00" } });
  });

  it("material: concurrent edits of render.tint, render.blend and render.style merge per field", () => {
    const render = (x: Obj) => x.render as Obj;
    const v = offline("material", [
      (x) => ({ ...x, render: { ...render(x), tint: "#ff8800" } }),
      (x) => ({ ...x, render: { ...render(x), blend: "add" } }),
      (x) => ({ ...x, render: { ...render(x), style: { fill: "#123456" } } }),
    ]);
    expect(v.render).toEqual({ style: { fill: "#123456" }, tint: "#ff8800", blend: "add" });
  });

  it("material: unsetting render.tint while another client sets render.blend keeps the blend only", () => {
    const v = offline("material", [
      (x) => {
        const { tint: _, ...rest } = x.render as Obj;
        return { ...x, render: rest };
      },
      (x) => ({ ...x, render: { ...(x.render as Obj), blend: "multiply" } }),
    ]);
    expect(v.render).toEqual({ style: { fill: "#e05a5a" }, blend: "multiply" });
  });

  it("game-settings: concurrent edits of different game settings both land", () => {
    const v = offline("game-settings", [
      (x) => ({ ...x, game: { ...(x.game as Obj), avatarSpeed: 260 } }),
      (x) => ({ ...x, game: { ...(x.game as Obj), title: "Deck" } }),
    ]);
    expect(v.game).toEqual({ avatarSpeed: 260, title: "Deck" });
  });

  it("game-settings: concurrent engine.tickRate and engine.physics both survive", () => {
    const engine = (x: Obj) => x.engine as Obj;
    const v = offline("game-settings", [
      (x) => ({ ...x, engine: { ...engine(x), tickRate: 30 } }),
      (x) => ({ ...x, engine: { ...engine(x), physics: "none" } }),
    ]);
    expect(v.engine).toEqual({ tickRate: 30, physics: "none" });
    expect(v.game).toEqual({ avatarSpeed: 200 });
  });

  it("data-table: concurrent row inserts, a field edit and a reorder all land", () => {
    const v = offline("data-table", [
      (x) => ({ ...x, rows: [rows(x)[1], { ...rows(x)[0]!, cost: 4 }, { id: "bolt", cost: 1 }] }),
      (x) => ({ ...x, rows: [...rows(x), { id: "shield", cost: 2 }] }),
      (x) => ({ ...x, rows: [{ ...rows(x)[0]!, damage: 6 }, rows(x)[1]] }),
    ]);
    expect(rows(v).map((r) => r.id)).toEqual(
      expect.arrayContaining(["heal", "fireball", "bolt", "shield"]),
    );
    expect(rows(v)).toHaveLength(4);
    expect(rows(v).find((r) => r.id === "fireball")).toEqual({
      id: "fireball",
      cost: 4,
      damage: 6,
    });
    expect(rows(v)[0]!.id).toBe("heal");
  });

  it("input-script: concurrent step inserts both land", () => {
    const v = offline("input-script", [
      (x) => ({ ...x, steps: [{ press: "push" }, ...items(x, "steps")] }),
      (x) => ({ ...x, steps: [...items(x, "steps"), { wait: 5 }] }),
    ]);
    expect(v.steps).toEqual([
      { press: "push" },
      { wait: 10 },
      { hold: ["right"], for: 20 },
      { wait: 5 },
    ]);
  });

  it("input-script: concurrent inserts of command steps merge", () => {
    const nudge = (dx: number) => ({ command: NUDGE, args: { dx } });
    const v = offline("input-script", [
      (x) => ({ ...x, steps: [nudge(1), ...items(x, "steps")] }),
      (x) => ({ ...x, steps: [items(x, "steps")[0], nudge(2), ...items(x, "steps").slice(1)] }),
      (x) => ({ ...x, steps: [items(x, "steps")[0], nudge(3), ...items(x, "steps").slice(1)] }),
      (x) => ({ ...x, steps: [...items(x, "steps"), nudge(4)] }),
    ]);
    const steps = items(v, "steps");
    expect(steps).toHaveLength(6);
    expect(steps[0]).toEqual(nudge(1));
    expect(steps[1]).toEqual({ wait: 10 });
    expect(steps.slice(2, 4)).toEqual(expect.arrayContaining([nudge(2), nudge(3)]));
    expect(steps.slice(4)).toEqual([{ hold: ["right"], for: 20 }, nudge(4)]);
  });

  it("checks: concurrent edits of different checks and fields all land", () => {
    const v = offline("checks", [
      (x) => ({
        ...x,
        checks: [{ ...items(x, "checks")[0]!, physical: true }, items(x, "checks")[1]],
      }),
      (x) => ({
        ...x,
        checks: [items(x, "checks")[0], { ...items(x, "checks")[1]!, result: "timeout" }],
      }),
      (x) => ({
        ...x,
        checks: [...items(x, "checks"), { id: "strict", kind: "valid", max: "warn" }],
      }),
    ]);
    expect(v.checks).toEqual([
      { id: "valid", kind: "valid", physical: true },
      {
        id: "settles",
        kind: "reaches",
        script: { v: 1, steps: [{ wait: 60 }] },
        result: "timeout",
      },
      { id: "strict", kind: "valid", max: "warn" },
    ]);
  });

  it(`${deckKind.kind}: concurrent title edits, style keys, tags and card edits all land`, () => {
    const cards = (v: Obj) => v.cards as Obj[];
    const v = offline(deckKind.kind, [
      (x) => ({ ...x, title: `Big ${String(x.title)}` }),
      (x) => ({
        ...x,
        title: `${String(x.title)}!`,
        style: { ...(x.style as Obj), stroke: "#000" },
      }),
      (x) => ({
        ...x,
        tags: [...items(x, "tags"), "rare"],
        cards: [{ ...cards(x)[0]!, note: "cheaper" }, cards(x)[1], { id: "nova" }],
      }),
      (x) => ({ ...x, cards: [cards(x)[0], { ...cards(x)[1]!, cost: 2 }] }),
    ]);
    expect(v.title).toBe("Big Red deck!");
    expect(v.style).toEqual({ fill: "#f00", line: [1, 2], stroke: "#000" });
    expect(v.tags).toEqual(["fast", "red", "rare"]);
    expect(v.cards).toEqual([
      { id: "zap", note: "cheaper", cost: 0 },
      { id: "bolt", cost: 2 },
      { id: "nova" },
    ]);
  });
});

describe("prefab docs converge", () => {
  const BASE_OVERRIDES = { "pole.off": true, "cap.at": [0, -140] };
  const VARIANT: Prefab = {
    kind: "prefab",
    v: SCENE_FORMAT_VERSION,
    id: "tall-post",
    base: "post",
    overrides: BASE_OVERRIDES,
    params: { height: { description: "Pole height", targets: ["pole.shape"] } },
    entities: [{ id: "lamp", type: "marker", at: [0, -150] }],
  };

  function variantNetwork(clients: number, rand: Rand) {
    const seed = prefabToDoc(VARIANT, { key: sequentialKeys("s") });
    const net = new SimNetwork(clients, rand, seed);
    const keys = net.docs.map((_, i) => sequentialKeys(`c${i}-`));
    const write = (i: number, change: (p: Prefab) => Prefab) => {
      const doc = net.docs[i]!;
      const next = change(docToPrefab(doc));
      for (const k of ["overrides", "params"] as const)
        if (next[k] && Object.keys(next[k]).length === 0) delete next[k];
      prefabPatch(doc, next, origins[i]!, { key: keys[i] });
      expect(docToPrefab(doc)).toEqual(JSON.parse(JSON.stringify(next)));
    };
    const values = () => net.docs.map((d) => docToPrefab(d) as unknown as Obj);
    return { net, write, values };
  }

  it("a variant's overrides merge per key", () => {
    const { net, write, values } = variantNetwork(3, rng(3));
    net.partition([0]);
    net.partition([1]);
    write(0, (p) => ({ ...p, overrides: { ...p.overrides, "cap.at": [4, -150] } }));
    write(1, (p) => ({ ...p, overrides: { ...p.overrides, "cap.tags": ["lit"] } }));
    write(2, (p) => {
      const { "pole.off": _off, ...rest } = p.overrides!;
      return { ...p, overrides: { ...rest, "lamp.tags": ["on"] } };
    });
    net.settle();
    const vs = values();
    expectConverged(vs, "variant overrides");
    expect(vs[0]!.overrides).toEqual({
      "cap.at": [4, -150],
      "cap.tags": ["lit"],
      "lamp.tags": ["on"],
    });
    expect(vs[0]!.base).toBe("post");
  });

  it("a base change and an override edit both land; parameters merge per name", () => {
    const { net, write, values } = variantNetwork(2, rng(5));
    net.partition([0]);
    write(0, (p) => ({
      ...p,
      base: "short-post",
      params: { ...p.params, label: { description: "Cap tags", targets: ["cap.tags"] } },
    }));
    write(1, (p) => ({
      ...p,
      overrides: { ...p.overrides, "cap.tags": ["lit"] },
      params: { height: { ...p.params!.height!, default: 90 } },
    }));
    net.settle();
    const vs = values();
    expectConverged(vs, "variant base and params");
    expect(vs[0]!.base).toBe("short-post");
    expect(vs[0]!.overrides).toEqual({ ...BASE_OVERRIDES, "cap.tags": ["lit"] });
    expect(vs[0]!.params).toEqual({
      height: { description: "Pole height", targets: ["pole.shape"], default: 90 },
      label: { description: "Cap tags", targets: ["cap.tags"] },
    });
  });

  it("random override, parameter and base edits converge", () => {
    const paths = ["pole.off", "cap.at", "cap.tags", "lamp.tags", "lamp.at"];
    for (let seed = 1; seed <= 10; seed++) {
      const rand = rng(seed * 7919);
      const clients = 2 + (seed % 3);
      const { net, write, values } = variantNetwork(clients, rand);
      for (let step = 0; step < 30; step++) {
        const i = int(rand, clients);
        const roll = rand();
        write(i, (p) => {
          if (roll < 0.6) {
            const overrides = { ...p.overrides };
            const path = pick(rand, paths);
            if (rand() < 0.3) delete overrides[path];
            else overrides[path] = int(rand, 100);
            return { ...p, overrides };
          }
          if (roll < 0.9) {
            const params = { ...p.params };
            const name = pick(rand, ["height", "label", "tint"]);
            if (rand() < 0.3) delete params[name];
            else params[name] = { description: name, targets: [pick(rand, paths)] };
            return { ...p, params };
          }
          return rand() < 0.5 ? { ...p, base: pick(rand, ["post", "short-post"]) } : p;
        });
        net.deliver(int(rand, 4));
        const r = rand();
        if (r < 0.1) net.partition([int(rand, clients)]);
        else if (r < 0.2) net.heal();
      }
      net.settle();
      expectConverged(values(), `variant seed ${seed}`);
    }
  });
});

describe("scene docs converge", () => {
  const game = createRegistry(testGame);
  const PAINTED: SceneDefinition = {
    v: SCENE_FORMAT_VERSION,
    game: "test-game",
    name: "paint-yard",
    bounds: [0, 0, 4096, 4096],
    settings: { grid: { kind: "square", cell: [16, 16] } },
    entities: [
      { id: "floor", type: "paint", at: [0, 0], cells: { "0,0": ["1*4"], "1,0": ["", "2*2"] } },
    ],
  };

  function sceneNetwork(clients: number, rand: Rand) {
    const net = new SimNetwork(clients, rand, sceneToDoc(PAINTED, { key: sequentialKeys("s") }));
    const paint = (i: number, cells: CellEdit[]) =>
      must(
        applyOpsToDoc(
          net.docs[i]!,
          { ops: [{ op: "paintCells", ref: "floor", field: "cells", cells }] },
          origins[i]!,
          game,
        ),
      );
    const cellsOf = (doc: Y.Doc) =>
      (docToScene(doc).entities?.find((e) => e.id === "floor")?.cells ?? {}) as GridCells;
    const values = () => net.docs.map((d) => docToScene(d) as unknown as Obj);
    return { net, paint, cellsOf, values };
  }

  const floorKeys = (doc: Y.Doc) => {
    const floor = [...entitiesMap(doc).values()].find((m) => m.get("id") === "floor")!;
    return [...floor.keys()].filter((k) => k.startsWith("cells@"));
  };

  it("two clients painting different chunks converge, both paints kept", () => {
    const { net, paint, cellsOf, values } = sceneNetwork(2, rng(11));
    net.partition([0]);
    paint(0, [
      [3, 0, 3],
      [5, 2, 1],
    ]);
    paint(1, [
      [-1, 0, 2],
      [40, 33, 3],
    ]);
    net.settle();
    expectConverged(values(), "different chunks");
    const cells = cellsOf(net.docs[0]!);
    expect([0, 1, 2, 3].map((c) => readCell(cells, c, 0))).toEqual([1, 1, 1, 3]);
    expect(readCell(cells, 5, 2)).toBe(1);
    expect(readCell(cells, -1, 0)).toBe(2);
    expect(readCell(cells, 40, 33)).toBe(3);
    expect(readCell(cells, 33, 1)).toBe(2);
    expect(floorKeys(net.docs[1]!).sort()).toEqual(
      [
        gridRowKey("cells", "0,0", 0),
        gridRowKey("cells", "0,0", 2),
        gridRowKey("cells", "1,0", 1),
        gridRowKey("cells", "-1,0", 0),
        gridRowKey("cells", "1,1", 1),
      ].sort(),
    );
  });

  it("two first paints into one empty chunk both land", () => {
    const { net, paint, cellsOf, values } = sceneNetwork(2, rng(12));
    net.partition([0]);
    paint(0, [[64, 64, 1]]);
    paint(1, [[65, 70, 2]]);
    net.settle();
    expectConverged(values(), "one empty chunk");
    const cells = cellsOf(net.docs[0]!);
    expect([readCell(cells, 64, 64), readCell(cells, 65, 70)]).toEqual([1, 2]);
  });

  it("different rows of one chunk merge", () => {
    const { net, paint, cellsOf, values } = sceneNetwork(3, rng(13));
    net.partition([0]);
    net.partition([1]);
    paint(0, [[2, 0, 3]]);
    paint(1, [[7, 1, 2]]);
    paint(2, [
      [0, 31, 1],
      [31, 31, 1],
    ]);
    net.settle();
    expectConverged(values(), "different rows");
    const cells = cellsOf(net.docs[0]!);
    expect(cells["0,0"]).toEqual([
      "1*2,3,1",
      "0*7,2",
      ...Array.from({ length: 29 }, () => ""),
      "1,0*30,1",
    ]);
    expect(cells["1,0"]).toEqual(["", "2*2"]);
  });

  it("one row is last writer wins: both clients end on one of the two rows, whole", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { net, paint, cellsOf, values } = sceneNetwork(2, rng(seed * 101));
      net.partition([0]);
      paint(0, [[0, 0, 3]]);
      paint(1, [[3, 0, 2]]);
      net.settle();
      expectConverged(values(), `one row, seed ${seed}`);
      const row = cellsOf(net.docs[0]!)["0,0"];
      expect([["3,1*3"], ["1*3,2"]], `seed ${seed}`).toContainEqual(row);
    }
  });

  it("random paints across chunks and rows converge over delivery order, partitions and reconnects", () => {
    let painted = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rand = rng(seed * 6007);
      const clients = 2 + (seed % 3);
      const { net, paint, values } = sceneNetwork(clients, rand);
      for (let step = 0; step < 40; step++) {
        const i = int(rand, clients);
        const edits: CellEdit[] = Array.from({ length: 1 + int(rand, 4) }, () => [
          int(rand, 96) - 32,
          int(rand, 64) - 16,
          int(rand, 4),
        ]);
        paint(i, edits);
        painted++;
        net.deliver(int(rand, 4));
        const roll = rand();
        if (roll < 0.1) net.partition([int(rand, clients)]);
        else if (roll < 0.2) net.heal();
      }
      net.settle();
      expectConverged(values(), `paint seed ${seed}`);
    }
    expect(painted).toBe(480);
  });
});
