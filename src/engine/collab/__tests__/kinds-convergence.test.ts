import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

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
import { sequentialKeys } from "../keys";
import { layoutFromDoc, layoutPatch, layoutToDoc } from "../layout";
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
      render: { style: { fill: "#e05a5a" } },
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
    it(`${name}: random edits on its layout converge`, () => {
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

  it("game-settings: concurrent edits of different game settings both land", () => {
    const v = offline("game-settings", [
      (x) => ({ ...x, game: { ...(x.game as Obj), avatarSpeed: 260 } }),
      (x) => ({ ...x, game: { ...(x.game as Obj), title: "Deck" } }),
    ]);
    expect(v.game).toEqual({ avatarSpeed: 260, title: "Deck" });
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
