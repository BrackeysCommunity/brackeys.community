import { describe, expect, it } from "vite-plus/test";

import { PREFAB_SCENE_OPS } from "../../project/ops";
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
import type { SceneOp } from "../../scene/types";
import { applyOpsToDoc } from "../apply";
import { docLayout, docPrefabs, docToScene, sceneToDoc } from "../convert";
import { sequentialKeys } from "../keys";
import type { SceneOrigin } from "../types";
import { SimNetwork } from "./sim-network";

describe("convergence fuzz", () => {
  for (const [label, reg, yard] of [
    ["engine-yard", engine, engineYard],
    ["the fake game's yard", fake, fakeYard],
  ] as const) {
    // Prefab ops write prefab docs of their own; prefab-doc.test.ts covers how those merge.
    it(`random batches, delivery order, partitions and reconnects converge: ${label}`, () => {
      let batches = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const rand = rng(seed * 7919);
        const clients = 2 + (seed % 4);
        const seed0 = sceneToDoc(yard(), { key: sequentialKeys("s") });
        const prefabs = yardPrefabs(yard().game);
        const sceneOp = (def: ReturnType<typeof docToScene>): SceneOp => {
          for (;;) {
            const op = randomOp(reg, def, rand, prefabs);
            if (!PREFAB_SCENE_OPS.includes(op.op)) return op;
          }
        };
        const net = new SimNetwork(clients, rand, seed0);
        const origins: SceneOrigin[] = net.docs.map((_, i) => ({ kind: "user", userId: `u${i}` }));
        const keys = net.docs.map((_, i) => sequentialKeys(`c${i}-`));

        for (let step = 0; step < 60; step++) {
          const i = Math.floor(rand() * clients);
          const doc = net.docs[i]!;
          const ops = Array.from({ length: 1 + Math.floor(rand() * 3) }, () =>
            sceneOp(docToScene(doc)),
          );
          const r = applyOpsToDoc(doc, { ops }, origins[i]!, reg, {
            validate: "none",
            key: keys[i],
            prefabs,
          });
          if (r.ok) batches++;
          net.deliver(Math.floor(rand() * 4));
          const roll = rand();
          if (roll < 0.05) net.partition([Math.floor(rand() * clients)]);
          else if (roll < 0.1) net.heal();
        }
        net.settle();

        for (const doc of net.docs) {
          expect(docLayout(doc), `seed ${seed}: layout 2`).toBe(2);
          expect(docPrefabs(doc).size, "layout 2 holds no prefabs").toBe(0);
        }
        const texts = net.docs.map((d) => formatScene(docToScene(d)).text);
        const hashes = net.docs.map((d) => sceneHash(docToScene(d)));
        for (let i = 1; i < clients; i++) {
          expect(texts[i], `seed ${seed}, client ${i}`).toBe(texts[0]);
          expect(hashes[i]).toBe(hashes[0]);
        }
      }
      expect(batches).toBeGreaterThan(400);
    }, 120_000);
  }
});
