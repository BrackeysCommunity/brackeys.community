import { describe, expect, it } from "vite-plus/test";

import { engine, engineYard, randomOp, rng } from "../../scene/__tests__/fixtures/random-ops";
import { applyOpsToDoc } from "../apply";
import { docToScene } from "../convert";
import { ada, apply, bo, entity, link, pair, sync, text } from "./helpers";

describe("offline", () => {
  it("edits made while disconnected merge on reconnect", () => {
    const [a, b] = pair(engineYard());
    let unlink = link(a, b);
    apply(a, { ops: [{ op: "move", refs: ["crate"], by: [10, 0] }] }, ada, engine);
    expect(entity(b, "crate")!.shape).toEqual(["circle", 1210, 940, 20]);

    unlink();
    apply(a, { ops: [{ op: "update", ref: "crate", set: { density: 7 } }] }, ada, engine);
    apply(
      a,
      { ops: [{ op: "add", entity: { id: "offline-a", type: "marker", at: [1, 1] } }] },
      ada,
      engine,
    );
    apply(b, { ops: [{ op: "remove", refs: ["zone"] }] }, bo, engine);
    apply(
      b,
      { ops: [{ op: "add", entity: { id: "offline-b", type: "marker", at: [2, 2] } }] },
      bo,
      engine,
    );
    expect(entity(b, "offline-a")).toBeUndefined();

    sync(a, b);
    unlink = link(a, b);
    expect(text(a)).toBe(text(b));
    expect(entity(a, "crate")).toMatchObject({ density: 7 });
    expect(entity(a, "zone")).toBeUndefined();
    expect(entity(a, "offline-a")).toBeDefined();
    expect(entity(a, "offline-b")).toBeDefined();
    unlink();
  });

  it("a long offline session of random batches on both sides converges on reconnect", () => {
    const rand = rng(404);
    const [a, b] = pair(engineYard());
    for (let i = 0; i < 80; i++) {
      const doc = i % 2 === 0 ? a : b;
      const ops = [randomOp(engine, docToScene(doc), rand)];
      applyOpsToDoc(doc, { ops }, i % 2 === 0 ? ada : bo, engine, { validate: "none" });
    }
    sync(a, b);
    expect(text(a)).toBe(text(b));
  });
});
