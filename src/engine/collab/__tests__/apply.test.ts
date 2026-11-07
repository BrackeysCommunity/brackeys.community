import { describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import {
  engine,
  engineYard,
  fake,
  fakeYard,
  randomOp,
  rng,
  yardPrefabs,
} from "../../scene/__tests__/fixtures/random-ops";
import { formatScene } from "../../scene/format";
import { sceneHash } from "../../scene/hash";
import { applyOps } from "../../scene/ops";
import { formatPrefabs } from "../../scene/prefab";
import type { OpBatch, SceneDefinition } from "../../scene/types";
import { applyOpsToDoc } from "../apply";
import { docPrefabs, docToScene, readDoc, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import { readLog } from "../log";
import type { SceneOrigin } from "../types";

const text = (def: SceneDefinition) => formatScene(def).text;
const user: SceneOrigin = { kind: "user", userId: "u1", name: "Ada" };

describe("applyOpsToDoc", () => {
  for (const [label, reg, yard] of [
    ["engine-yard", engine, engineYard],
    ["the fake game's yard", fake, fakeYard],
  ] as const) {
    it(`writes what applyOps computes, byte for byte, for random batches: ${label}`, () => {
      const rand = rng(0xd0c);
      const doc = sceneToDoc(yard(), {
        key: sequentialKeys("seed"),
        prefabs: yardPrefabs(yard().game),
      });
      const key = sequentialKeys("new");
      let applied = 0;
      for (let i = 0; i < 300; i++) {
        const before = docToScene(doc);
        const prefabs = docPrefabs(doc);
        const ops = Array.from({ length: 1 + Math.floor(rand() * 4) }, () =>
          randomOp(reg, before, rand, prefabs),
        );
        const batch: OpBatch = { ops };
        const expected = applyOps(before, { ...batch, base: sceneHash(before) }, reg, {
          validate: "none",
          prefabs,
        });
        const vector = Y.encodeStateVector(doc);
        let transactions = 0;
        const count = () => transactions++;
        doc.on("afterTransaction", count);
        const got = applyOpsToDoc(doc, batch, user, reg, { validate: "none", key });
        doc.off("afterTransaction", count);

        expect(got.ok).toBe(expected.ok);
        if (!expected.ok || !got.ok) {
          expect(transactions).toBe(0);
          expect(Y.encodeStateVector(doc)).toEqual(vector);
          continue;
        }
        applied++;
        expect(transactions).toBe(1);
        expect(text(docToScene(doc))).toBe(text(expected.def));
        expect(Object.fromEntries(formatPrefabs(docPrefabs(doc)))).toEqual(
          Object.fromEntries(formatPrefabs(expected.prefabs ?? prefabs)),
        );
        expect(got.hash).toBe(sceneHash(docToScene(doc)));
        for (const ref of [...got.touched, ...got.created])
          if (!expected.diff.some((c) => c.kind === "removed" && c.ref === ref))
            expect(got.refKeys[ref], ref).toBeDefined();
      }
      expect(applied).toBeGreaterThan(100);
    }, 60_000);
  }

  it("keeps keys across renames, shifts, promotes and demotes", () => {
    const doc = sceneToDoc(engineYard(), { key: sequentialKeys() });
    const keyOf = (ref: string) => {
      const view = readDoc(doc);
      if (!ref.startsWith("~"))
        return view.entityKeys[view.def.entities!.findIndex((e) => e.id === ref)];
      const [, bulk, index] = /^~(.+):(\d+)$/.exec(ref)!;
      return view.bulkKeys.get(bulk!)![Number(index)];
    };
    const ledge = keyOf("ledge");
    const third = keyOf("~solid:2");
    const r1 = applyOpsToDoc(
      doc,
      { ops: [{ op: "rename", from: "ledge", to: "shelf" }] },
      user,
      engine,
    );
    expect(r1.ok).toBe(true);
    expect(keyOf("shelf")).toBe(ledge);
    applyOpsToDoc(doc, { ops: [{ op: "remove", refs: ["~solid:0"] }] }, user, engine);
    expect(keyOf("~solid:1")).toBe(third);
    applyOpsToDoc(doc, { ops: [{ op: "promote", ref: "~solid:1", id: "wall" }] }, user, engine);
    expect(keyOf("wall")).toBe(third);
    applyOpsToDoc(doc, { ops: [{ op: "demote", id: "wall" }] }, user, engine);
    expect(keyOf("~solid:1")).toBe(third);
  });

  it("resolves bulk refs against the doc as it is, with no base", () => {
    const doc = sceneToDoc(engineYard());
    const r = applyOpsToDoc(
      doc,
      { ops: [{ op: "move", refs: ["~solid:1"], by: [5, 0] }] },
      user,
      engine,
    );
    expect(r.ok).toBe(true);
    expect((docToScene(doc).solid as unknown[][])[1]).toEqual(["box", 25, 500, 20, 500]);
  });

  it("still checks a base the batch brings", () => {
    const doc = sceneToDoc(engineYard());
    const r = applyOpsToDoc(
      doc,
      { base: "0000000000000000", ops: [{ op: "remove", refs: ["~solid:0"] }] },
      user,
      engine,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issue.code).toBe("stale-base");
  });

  it("writes only the fields that changed", () => {
    const doc = sceneToDoc(engineYard());
    const changed: string[] = [];
    doc.getMap("entities").observeDeep((events) => {
      for (const ev of events) for (const k of ev.changes.keys.keys()) changed.push(k);
    });
    applyOpsToDoc(
      doc,
      { ops: [{ op: "update", ref: "lift", set: { "path.speed": 90 } }] },
      user,
      engine,
    );
    expect(changed).toEqual(["speed"]);
  });

  it("logs each batch with its actor, keys and before state", () => {
    const doc = sceneToDoc(engineYard());
    const agent: SceneOrigin = { kind: "agent", agentId: "claude", onBehalfOf: "u1" };
    applyOpsToDoc(
      doc,
      { label: "Nudge", ops: [{ op: "move", refs: ["crate"], by: [10, 0] }] },
      agent,
      engine,
    );
    const [entry] = readLog(doc);
    expect(entry).toMatchObject({ actor: agent, label: "Nudge", ops: ["move"] });
    expect(entry!.keys).toHaveLength(1);
    expect(entry!.before![entry!.keys[0]!]).toMatchObject({
      id: "crate",
      shape: ["circle", 1200, 940, 20],
    });
  });
});
