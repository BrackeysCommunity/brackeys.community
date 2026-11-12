import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { withProject } from "../../game/define";
import { createKindRegistry, defineAssetKind, type DocLayout } from "../../project/kinds";
import { sceneKind } from "../../project/kinds/scene";
import type { ProjectOpBatch } from "../../project/ops";
import type { AssetEntry } from "../../project/types";
import { projectView } from "../../project/view";
import { engine, engineYard, rng } from "../../scene/__tests__/fixtures/random-ops";
import { sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { layoutFromDoc, layoutToDoc } from "../layout";
import { applyProjectBatch } from "../project-apply";
import { readProject, seedProjectDoc } from "../project-doc";
import {
  buildHashes,
  createProjectSession,
  memoryDocHost,
  type MemoryDocClient,
  type ProjectSession,
  type ProjectSessionEvent,
} from "../project-session";
import { ada, bo } from "./helpers";
import { SimProject } from "./sim-network";

const layout: DocLayout = { as: "map", rest: { as: "atomic" } };

/** The card kind as one build defines it; `size` stands for a schema change between builds. */
const cardKind = (size: string) =>
  defineAssetKind({
    storage: "doc",
    kind: "card",
    title: "Card",
    description: "A card.",
    match: { suffixes: [".card.json"] },
    version: 1,
    schemaId: "urn:jams-engine:card:v1",
    schema: () => z.looseObject({ v: z.literal(1), size: z.number().describe(size).optional() }),
    layout,
    empty: () => ({ v: 1 }),
  });
const build = (size: string) => createKindRegistry(null, [sceneKind, cardKind(size)]);
const OLD = build("Size in tiles.");
const NEW = build("Size in pixels.");
const NEWER = build("Size in metres.");

function world() {
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
        post: entry("post", "card", "post.card.json"),
        yard: entry("yard", "scene", "yard.json"),
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  layoutToDoc(host.doc("asset:p.post"), layout, { v: 1, size: 1 });
  sceneToDoc(engineYard(), { doc: host.doc("scene:p.yard"), key: sequentialKeys("srv") });
  return host;
}

const join = (
  client: MemoryDocClient,
  kinds: typeof OLD,
  buildAt: number,
  origin = ada,
  clientID?: number,
) =>
  createProjectSession({
    project: "p",
    openDoc: async (name) => {
      const opened = await client.openDoc(name);
      if (clientID !== undefined) opened.doc.clientID = clientID;
      return opened;
    },
    origin,
    registry: engine,
    kinds,
    buildAt,
  });

const resize: ProjectOpBatch = {
  v: 1,
  ops: [{ op: "editAsset", id: "post", edits: [{ set: "/size", value: 2 }] }],
};
const moveCrate: ProjectOpBatch = {
  v: 1,
  ops: [{ op: "editScene", id: "yard", ops: [{ op: "move", refs: ["crate"], by: [1, 0] }] }],
};

describe("code skew", () => {
  it("makes an older build read-only on docs of a kind whose schema changed, and only those", async () => {
    const host = world();
    const old = await join(host.client(), OLD, 100);
    await old.open("asset:p.post");
    await old.open("scene:p.yard");
    expect(old.skew()).toEqual([]);
    expect(readProject(host.doc("project:p")).build).toEqual({
      card: { hash: old.hashes.card, buildAt: 100, engine: expect.any(String) },
      scene: { hash: old.hashes.scene, buildAt: 100, engine: expect.any(String) },
    });
    const events: ProjectSessionEvent[] = [];
    old.subscribe((e) => events.push(e));

    const fresh = await join(host.client(), NEW, 200, bo);
    expect(fresh.hashes.card).not.toBe(old.hashes.card);
    expect(fresh.hashes.scene).toBe(old.hashes.scene);
    expect((await fresh.open("asset:p.post")).readOnly).toBe(false);
    expect(readProject(host.doc("project:p")).build.card).toMatchObject({
      hash: fresh.hashes.card,
      buildAt: 200,
    });

    const post = old.get("asset:p.post")!;
    expect(post.readOnly).toBe(true);
    expect(post.issue).toMatchObject({
      code: "code-skew",
      severity: "warn",
      detail: { kind: "card", mine: old.hashes.card, project: fresh.hashes.card },
    });
    expect(events).toEqual([
      { type: "access", doc: "asset:p.post", readOnly: true, issue: post.issue },
    ]);
    expect(old.get("scene:p.yard")!.readOnly).toBe(false);
    expect(old.skew()).toEqual([post.issue]);

    const refused = await applyProjectBatch(old, resize, ada);
    expect(refused.ok || [refused.issue.code, refused.issue.severity]).toEqual([
      "code-skew",
      "error",
    ]);
    expect(layoutFromDoc(host.doc("asset:p.post"), layout)).toEqual({ v: 1, size: 1 });
    const create = await applyProjectBatch(
      old,
      { v: 1, ops: [{ op: "createAsset", kind: "card", path: "new.card.json" }] },
      ada,
    );
    expect(create.ok || [create.issue.code, create.issue.path]).toEqual([
      "code-skew",
      "/ops/0/kind",
    ]);
    expect(readProject(host.doc("project:p")).assets).not.toHaveProperty("new");
    expect((await applyProjectBatch(old, moveCrate, ada)).ok).toBe(true);
    expect((await applyProjectBatch(fresh, resize, bo)).ok).toBe(true);

    const late = await join(host.client(), OLD, 150);
    expect((await late.open("asset:p.post")).readOnly, "a build older than the stamp").toBe(true);
    expect(readProject(host.doc("project:p")).build.card!.buildAt).toBe(200);
    for (const s of [old, fresh, late]) s.destroy();
  });

  it("hashes a registry carrying the project's materials as its game's, so content never skews a build", async () => {
    const host = world();
    const plain = await join(host.client(), OLD, 100);
    const view = projectView({
      ...readProject(host.doc("project:p")),
      assets: {
        rubber: {
          key: "rubber",
          id: "rubber",
          kind: "material",
          path: "rubber.json",
          created: { at: 0, by: "seed" },
        },
      },
    });
    const rubber = {
      kind: "material",
      v: 1,
      description: "Rubber.",
      physics: { friction: 0.4, restitution: 0.9 },
    };
    const withRubber = withProject(engine, view, new Map([["rubber", rubber]]));
    expect(withRubber.materials.has("rubber")).toBe(true);
    const hashOf = (registry: typeof engine) => OLD.schemaHashes({ registry, project: null });
    expect((await hashOf(withRubber)).scene, "the materials are in the scene schema").not.toBe(
      (await hashOf(engine)).scene,
    );
    expect(await buildHashes(OLD, withRubber)).toEqual(await buildHashes(OLD, engine));

    const overlaid = await createProjectSession({
      project: "p",
      openDoc: host.client().openDoc,
      origin: bo,
      registry: withRubber,
      kinds: OLD,
      buildAt: 200,
    });
    expect(overlaid.hashes).toEqual(plain.hashes);
    await plain.open("scene:p.yard");
    expect((await overlaid.open("scene:p.yard")).readOnly).toBe(false);
    expect(plain.get("scene:p.yard")!.readOnly).toBe(false);
    for (const s of [plain, overlaid]) s.destroy();
  });

  it(
    "converges on the newest build when two new builds stamp at once",
    { timeout: 30_000 },
    async () => {
      // The larger client id wins the concurrent write, so alternating it covers the newest
      // build's stamp landing first and being overwritten, under either reconnect order.
      for (let round = 0; round < 4; round++) {
        const host = world();
        const old = await join(host.client(), OLD, 100);
        await old.open("asset:p.post");

        const one = host.client();
        const two = host.client();
        const [low, high] = [1_000_001, 1_000_002];
        const first = await join(one, NEW, 300, ada, round % 2 === 0 ? low : high);
        const second = await join(two, NEWER, 300, bo, round % 2 === 0 ? high : low);
        one.setOnline(false);
        two.setOnline(false);
        expect((await first.open("asset:p.post")).readOnly).toBe(false);
        expect((await second.open("asset:p.post")).readOnly).toBe(false);
        const oneFirst = Math.floor(round / 2) % 2 === 0;
        (oneFirst ? one : two).setOnline(true);
        (oneFirst ? two : one).setOnline(true);

        const winner = first.hashes.card! > second.hashes.card! ? first : second;
        const loser = winner === first ? second : first;
        for (const s of [old, first, second])
          expect(readProject(s.projectDoc).build.card, `round ${round}`).toMatchObject({
            hash: winner.hashes.card,
            buildAt: 300,
          });
        expect(winner.get("asset:p.post")!.readOnly, `round ${round}`).toBe(false);
        expect(loser.get("asset:p.post")!.readOnly, `round ${round}`).toBe(true);
        expect(old.get("asset:p.post")!.readOnly, `round ${round}`).toBe(true);
        for (const s of [old, first, second]) s.destroy();
      }
    },
  );
});

describe("code skew on a simulated network", () => {
  const BUILDS = [
    { kinds: OLD, buildAt: 100 },
    { kinds: NEW, buildAt: 300 },
    { kinds: NEWER, buildAt: 300 },
    { kinds: OLD, buildAt: 150 },
  ];

  it(
    "every client ends on the newest build's stamp, read-only exactly where its schema differs",
    { timeout: 30_000 },
    async () => {
      let partitions = 0;
      for (let seed = 1; seed <= 16; seed++) {
        const host = world();
        const names = ["project:p", "asset:p.post", "scene:p.yard"];
        const sim = new SimProject(
          BUILDS.length,
          rng(seed * 104_729),
          Object.fromEntries(names.map((n) => [n, host.doc(n)])),
        );
        const order = BUILDS.map((_, i) => i).sort(() => sim.rand() - 0.5);
        const sessions: ProjectSession[] = [];
        for (const i of order) {
          const { kinds, buildAt } = BUILDS[i]!;
          const s = await createProjectSession({
            project: "p",
            openDoc: sim.openDoc(i),
            origin: { kind: "user", userId: `u${i}` },
            registry: engine,
            kinds,
            buildAt,
          });
          sessions[i] = s;
          await s.open("asset:p.post");
          await s.open("scene:p.yard");
          for (let step = 0; step < 3; step++) {
            // Registry writes between the stamps leave updates waiting on others as they arrive.
            const writer =
              sessions[order[Math.floor(sim.rand() * sessions.filter(Boolean).length)]!]!;
            const ok = await applyProjectBatch(
              writer,
              {
                v: 1,
                ops: [{ op: "setLicence", id: "yard", licence: { author: `a${seed}-${step}` } }],
              },
              writer.origin,
            );
            expect(ok.ok).toBe(true);
            sim.weather(0.25, 0.15);
          }
        }
        partitions += sim.partitions;
        sim.settle();

        const stamps = sessions.map((s) => readProject(s.projectDoc).build);
        for (const [i, stamp] of stamps.entries())
          expect(stamp, `seed ${seed}, client ${i}`).toEqual(stamps[0]);
        const newest = [sessions[1]!, sessions[2]!].sort((x, y) =>
          x.hashes.card! < y.hashes.card! ? 1 : -1,
        )[0]!;
        expect(stamps[0]!.card, `seed ${seed}`).toMatchObject({
          hash: newest.hashes.card,
          buildAt: 300,
        });
        expect(stamps[0]!.scene!.hash).toBe(sessions[0]!.hashes.scene);
        for (const s of sessions) {
          expect(s.get("asset:p.post")!.readOnly, `seed ${seed}, build ${s.buildAt}`).toBe(
            s !== newest,
          );
          expect(s.get("scene:p.yard")!.readOnly).toBe(false);
        }

        const refused = await applyProjectBatch(sessions[0]!, resize, ada);
        expect(refused.ok).toBe(false);
        expect((await applyProjectBatch(newest, resize, bo)).ok).toBe(true);
        expect((await applyProjectBatch(sessions[3]!, moveCrate, ada)).ok).toBe(true);
        sim.settle();
        for (const i of BUILDS.keys())
          expect(layoutFromDoc(sim.doc("asset:p.post", i), layout)).toEqual({ v: 1, size: 2 });
        for (const s of sessions) s.destroy();
      }
      expect(partitions, "the runs must cut clients off").toBeGreaterThan(5);
    },
  );
});
