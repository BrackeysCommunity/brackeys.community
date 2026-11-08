import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import { createEditorSession, projectHistory } from "../../editor/session";
import { createKindRegistry, defineAssetKind, type DocLayout } from "../../project/kinds";
import { sceneKind } from "../../project/kinds/scene";
import type { ProjectOpBatch } from "../../project/ops";
import type { AssetEntry } from "../../project/types";
import { engine, engineYard, rng } from "../../scene/__tests__/fixtures/random-ops";
import { sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { layoutFromDoc, layoutToDoc } from "../layout";
import { logArray, readLog } from "../log";
import { applyProjectBatch } from "../project-apply";
import { readProject, seedProjectDoc } from "../project-doc";
import { readProjectLog } from "../project-log";
import { createProjectSession, memoryDocHost, type ProjectSession } from "../project-session";
import type { UndoneStep } from "../undo-coordinator";
import { ada, bo } from "./helpers";
import { SimProject } from "./sim-network";

const layout: DocLayout = { as: "map", rest: { as: "atomic" } };
const card = defineAssetKind({
  storage: "doc",
  kind: "card",
  title: "Card",
  description: "A card.",
  match: { suffixes: [".card.json"] },
  version: 1,
  schemaId: "urn:jams-engine:card:v1",
  schema: () => z.looseObject({ v: z.literal(1) }),
  layout,
  empty: () => ({ v: 1 }),
  refs: (value: { link?: unknown }) =>
    typeof value.link === "string" ? [{ pointer: "/link", id: value.link, kinds: ["card"] }] : [],
});
const kinds = createKindRegistry(null, [sceneKind, card]);
const CARDS = ["post", "gate", "flag"] as const;
const doc = (id: string) => `asset:p.${id}`;
const cy = { kind: "user", userId: "cy" } as const;

/** Each card holds a colour and a size; with `links`, gate and flag name post. */
function world(links = false) {
  const host = memoryDocHost();
  const entry = (id: string, kind: string, path: string): AssetEntry => ({
    key: id,
    id,
    kind,
    path,
    created: { at: 0, by: "seed" },
  });
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {
        ...Object.fromEntries(CARDS.map((id) => [id, entry(id, "card", `${id}.card.json`)])),
        yard: entry("yard", "scene", "yard.json"),
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  for (const id of CARDS)
    layoutToDoc(host.doc(doc(id)), layout, {
      v: 1,
      color: "grey",
      size: 1,
      ...(links && id !== "post" ? { link: "post" } : {}),
    });
  sceneToDoc(engineYard(), { doc: host.doc("scene:p.yard"), key: sequentialKeys("srv") });
  const join = (origin: typeof ada) =>
    createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin,
      registry: engine,
      kinds,
    });
  return { host, join };
}

const paint = (field: string, value: unknown, ids: readonly string[] = CARDS): ProjectOpBatch => ({
  v: 1,
  label: `Set ${field}`,
  ops: ids.map((id) => ({ op: "editAsset", id, edits: [{ set: `/${field}`, value }] })),
});

const fields = (s: ProjectSession, id: string) => layoutFromDoc(s.get(doc(id))!.doc, layout);

async function applied(s: ProjectSession, batch: ProjectOpBatch, origin = s.origin) {
  const r = await applyProjectBatch(s, batch, origin);
  if (!r.ok) throw new Error(r.issue.message);
  return r;
}

describe("cross-doc undo", () => {
  it("undoes a three-doc batch as one step for its author only, after others edited those docs, and redoes", async () => {
    const { host, join } = world();
    const a = await join(ada);
    const b = await join(bo);
    for (const id of CARDS) {
      await a.open(doc(id));
      await b.open(doc(id));
    }

    const wrote = await applied(a, paint("color", "red"));
    expect(wrote.entry?.docs.map((d) => d.doc)).toEqual(CARDS.map(doc));
    await applied(b, paint("size", 3));
    expect(a.undoLabel()).toBe("Set color");

    const step = a.undo();
    expect(step).toEqual({ label: "Set color", docs: CARDS.map(doc) });
    for (const s of [a, b])
      for (const id of CARDS) expect(fields(s, id)).toEqual({ v: 1, color: "grey", size: 3 });
    expect(a.canUndo()).toBe(false);
    expect(b.canUndo(), "bo's step is still his").toBe(true);
    expect(b.undoLabel()).toBe("Set size");

    expect(a.redo()).toEqual(step);
    for (const s of [a, b])
      for (const id of CARDS) expect(fields(s, id)).toEqual({ v: 1, color: "red", size: 3 });

    expect(b.undo()?.docs).toEqual(CARDS.map(doc));
    for (const id of CARDS) expect(fields(a, id)).toEqual({ v: 1, color: "red", size: 1 });
    for (const id of CARDS)
      expect(
        readLog(host.doc(doc(id))).map(({ label, kind, actor, keys }) => ({
          label,
          kind,
          actor,
          keys,
        })),
      ).toEqual([
        { label: "Set color", kind: undefined, actor: ada, keys: ["@content:color"] },
        { label: "Set size", kind: undefined, actor: bo, keys: ["@content:size"] },
        { label: "Undo Set color", kind: "undo", actor: ada, keys: ["@content:color"] },
        { label: "Redo Set color", kind: "redo", actor: ada, keys: ["@content:color"] },
        { label: "Undo Set size", kind: "undo", actor: bo, keys: ["@content:size"] },
      ]);
    const projectLog = readProjectLog(host.doc("project:p"));
    expect(projectLog.map((e) => [e.label, e.actor])).toEqual([
      ["Set color", ada],
      ["Set size", bo],
      ["Undo Set color", ada],
      ["Redo Set color", ada],
      ["Undo Set size", bo],
    ]);
    for (const entry of projectLog.slice(2))
      expect(entry.docs, entry.label).toEqual(
        CARDS.map((id) => ({
          doc: doc(id),
          entry: readLog(host.doc(doc(id))).find((e) => e.label === entry.label)!.id,
        })),
      );
    a.destroy();
    b.destroy();
  });

  it("keeps the docs a step wrote open, and an undo there names the doc it was in", async () => {
    const { join } = world();
    const a = await join(ada);
    await a.open("scene:p.yard");
    const undone: [UndoneStep, string][] = [];
    const scene = createEditorSession({
      doc: a.get("scene:p.yard")!.doc,
      origin: ada,
      name: "yard",
      registry: engine,
      history: projectHistory(a, "scene:p.yard", { onUndone: (s, how) => undone.push([s, how]) }),
    });

    scene.select(["crate"]);
    scene.dispatch({ label: "Move crate", ops: [{ op: "move", refs: ["crate"], by: [10, 0] }] });
    await applied(a, paint("color", "blue", ["post"]));
    expect(a.openDocs()).toContain(doc("post"));
    expect(a.pinned()).toEqual(["scene:p.yard", doc("post")]);
    expect(scene.store.state.undoLabel).toBe("Set color");

    expect(scene.undo()).toBe(true);
    expect(undone).toEqual([[{ label: "Set color", docs: [doc("post")] }, "undo"]]);
    expect(fields(a, "post").color).toBe("grey");

    scene.select([]);
    expect(scene.undo()).toBe(true);
    expect(undone[1]![0]).toMatchObject({
      label: "Move crate",
      docs: ["scene:p.yard"],
      selection: { doc: "scene:p.yard", after: [scene.keyOf("crate")] },
    });
    expect(scene.store.state.selection, "the scene's own step restores its selection").toEqual([
      "crate",
    ]);
    expect(scene.getDoc().entities!.find((e) => e.id === "crate")!.shape).toEqual([
      "circle",
      1200,
      940,
      20,
    ]);
    expect(scene.store.state.canUndo).toBe(false);
    expect(scene.redo()).toBe(true);
    expect(scene.store.state.redoLabel).toBe("Set color");
    scene.destroy();
    a.destroy();
  });

  it("undoes a change of id across the three docs it wrote as one step for its author only, and redoes", async () => {
    const { host, join } = world(true);
    const a = await join(ada);
    const b = await join(bo);
    for (const id of CARDS) await b.open(doc(id));
    const project = () => readProject(host.doc("project:p"));
    const links = () => CARDS.map((id) => layoutFromDoc(host.doc(doc(id)), layout).link);

    const r = await applied(a, {
      v: 1,
      label: "Rename post",
      ops: [{ op: "changeAssetId", id: "post", to: "pole" }],
    });
    expect(r.docs).toEqual([doc("flag"), doc("gate"), "project:p"]);
    expect(r.entry?.docs.map((d) => d.doc)).toEqual(r.docs);
    expect(project().assets.post!.id).toBe("pole");
    expect(links()).toEqual([undefined, "pole", "pole"]);

    await applied(b, paint("color", "blue", ["gate", "flag"]));
    await applied(b, { v: 1, ops: [{ op: "setLicence", id: "pole", licence: { author: "Bo" } }] });

    const step = a.undo();
    expect(step).toEqual({ label: "Rename post", docs: r.docs });
    expect(project().assets.post).toMatchObject({ id: "post", licence: { author: "Bo" } });
    expect(links()).toEqual([undefined, "post", "post"]);
    for (const id of ["gate", "flag"]) expect(fields(b, id).color, "bo's edit stays").toBe("blue");
    expect(a.canUndo()).toBe(false);
    expect(b.undoLabel()).toBe("setLicence");

    expect(a.redo()).toEqual(step);
    expect(project().assets.post!.id).toBe("pole");
    for (const id of ["gate", "flag"])
      expect(fields(b, id)).toEqual({ v: 1, color: "blue", size: 1, link: "pole" });

    const projectLog = readProjectLog(host.doc("project:p"));
    for (const how of ["Undo", "Redo"]) {
      const label = `${how} Rename post`;
      const rows = projectLog.filter((e) => e.label === label);
      expect(rows, label).toHaveLength(1);
      const [row] = rows;
      expect(row!.actor).toEqual(ada);
      expect(row!.docs.map((d) => d.doc)).toEqual(r.docs);
      expect(row!.docs.at(-1)!.entry, "the registry's part is the project entry itself").toBe(
        row!.id,
      );
      for (const id of ["gate", "flag"]) {
        const own = readLog(host.doc(doc(id))).filter((e) => e.label === label);
        expect(own, `${id}: ${label}`).toHaveLength(1);
        expect(own[0]).toMatchObject({
          actor: ada,
          kind: how.toLowerCase(),
          keys: ["@content:link"],
        });
        expect(row!.docs.find((d) => d.doc === doc(id))!.entry).toBe(own[0]!.id);
      }
    }
    a.destroy();
    b.destroy();
  });

  it("keeps an undo's history row off the undo stacks", async () => {
    const { host, join } = world();
    const a = await join(ada);
    await applied(a, paint("color", "red", ["post"]));
    expect(a.undo()?.label).toBe("Set color");
    expect(a.canRedo()).toBe(true);
    expect(readLog(host.doc(doc("post"))).map((e) => e.kind)).toEqual([undefined, "undo"]);
    expect(readProjectLog(host.doc("project:p")), "a one-doc step logs no project entry").toEqual(
      [],
    );
    expect(a.redo()?.label, "the history row didn't clear the redo stack").toBe("Set color");
    expect(fields(a, "post").color).toBe("red");
    expect(a.undo()?.label, "nor did it become a step of its own").toBe("Set color");
    expect(fields(a, "post").color).toBe("grey");
    expect(a.canUndo()).toBe(false);
    a.destroy();
  });

  it("writes each doc's undo and its history row as two transactions, and one project log entry", async () => {
    const { host, join } = world();
    const a = await join(ada);
    const b = await join(bo);
    for (const id of CARDS) {
      await a.open(doc(id));
      await b.open(doc(id));
    }
    await applied(a, paint("color", "red"));

    /** Each local transaction on a doc: whether the undo manager wrote it, and what it changed. */
    const record = (d: Y.Doc) => {
      const seen: { undo: boolean; log: boolean; content: boolean }[] = [];
      d.on("afterTransaction", (tr: Y.Transaction) => {
        if (!tr.local) return;
        const log = tr.changed.has(logArray(d));
        seen.push({
          undo: tr.origin instanceof Y.UndoManager,
          log,
          content: tr.changed.size > +log,
        });
      });
      return seen;
    };
    const peerUpdates = (d: Y.Doc) => {
      let n = 0;
      d.on("update", () => n++);
      return () => n;
    };
    for (const how of ["undo", "redo"] as const) {
      const cards = CARDS.map((id) => record(a.get(doc(id))!.doc));
      const root = record(a.projectDoc);
      const seenByBo = CARDS.map((id) => peerUpdates(b.get(doc(id))!.doc));
      const logged = readProjectLog(host.doc("project:p")).length;

      expect(a[how]()?.docs).toEqual(CARDS.map(doc));
      for (const seen of cards)
        expect(seen, how).toEqual([
          { undo: true, log: false, content: true },
          { undo: false, log: true, content: false },
        ]);
      expect(root, "the root doc only gains the project log entry").toEqual([
        { undo: false, log: true, content: false },
      ]);
      expect(readProjectLog(host.doc("project:p")).length).toBe(logged + 1);
      for (const n of seenByBo) expect(n(), "a peer sees the change and its row apart").toBe(2);
    }
    a.destroy();
    b.destroy();
  });
});

/** The world's docs as a `SimProject`'s initial state. */
function simWorld(clients: number, seed: number, links = false) {
  const { host } = world(links);
  const names = ["project:p", ...CARDS.map(doc), "scene:p.yard"];
  const sim = new SimProject(
    clients,
    rng(seed),
    Object.fromEntries(names.map((n) => [n, host.doc(n)])),
  );
  const join = (i: number, origin: typeof ada) =>
    createProjectSession({
      project: "p",
      openDoc: sim.openDoc(i),
      origin,
      registry: engine,
      kinds,
    });
  return { sim, join };
}

describe("cross-doc undo on a simulated network", () => {
  it(
    "undoes a change of id as one step for its author only, through random delivery and partitions",
    { timeout: 30_000 },
    async () => {
      let partitions = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const { sim, join } = simWorld(3, seed * 7919, true);
        const [a, b, c] = await Promise.all([join(0, ada), join(1, bo), join(2, cy)]);
        for (const s of [b, c]) for (const id of CARDS) await s.open(doc(id));
        const docs = () =>
          [0, 1, 2].map((i) => ({
            project: readProject(sim.doc("project:p", i)),
            cards: CARDS.map((id) => layoutFromDoc(sim.doc(doc(id), i), layout)),
          }));
        const pick = <T>(list: readonly T[]) => list[Math.floor(sim.rand() * list.length)]!;

        const r = await applied(a, {
          v: 1,
          label: "Rename post",
          ops: [{ op: "changeAssetId", id: "post", to: "pole" }],
        });
        expect(r.docs).toEqual([doc("flag"), doc("gate"), "project:p"]);
        const colours: Record<string, string> = {};
        const sizes: Record<string, number> = {};
        for (let step = 0; step < 8; step++) {
          sim.weather(0.2, 0.15);
          const id = pick(["gate", "flag"]);
          colours[id] = `c${step}`;
          await applied(b, paint("color", colours[id], [id]));
          sim.weather(0.2, 0.15);
          const sized = pick(CARDS);
          sizes[sized] = step + 2;
          await applied(c, paint("size", sizes[sized], [c.state().assets[sized]!.id]));
        }
        if (sim.rand() < 0.5) sim.partition([0]);
        const step = a.undo();
        expect(step, `seed ${seed}`).toEqual({ label: "Rename post", docs: r.docs });
        expect(a.canUndo()).toBe(false);
        for (let i = 0; i < 4; i++) sim.weather(0.2, 0.15);
        partitions += sim.partitions;
        sim.settle();

        const all = docs();
        for (const [i, d] of all.entries()) expect(d, `seed ${seed}, client ${i}`).toEqual(all[0]);
        expect(all[0]!.project.assets.post!.id, `seed ${seed}`).toBe("post");
        expect(
          all[0]!.cards.map((card, n) => ({ ...card, id: CARDS[n] })),
          `seed ${seed}: others' edits stay`,
        ).toEqual(
          CARDS.map((id) => ({
            v: 1,
            id,
            color: colours[id] ?? "grey",
            size: sizes[id] ?? 1,
            ...(id === "post" ? {} : { link: "post" }),
          })),
        );
        expect(b.undoLabel()).toBe("Set color");
        expect(c.undoLabel()).toBe("Set size");

        expect(a.redo()).toEqual(step);
        sim.settle();
        for (let i = 0; i < 3; i++) {
          expect(readProject(sim.doc("project:p", i)).assets.post!.id).toBe("pole");
          for (const id of ["gate", "flag"])
            expect(layoutFromDoc(sim.doc(doc(id), i), layout)).toMatchObject({
              link: "pole",
              color: colours[id] ?? "grey",
            });
        }
        for (const s of [a, b, c]) s.destroy();
      }
      expect(partitions, "the runs must cut clients off").toBeGreaterThan(5);
    },
  );
});
