import { describe, expect, it } from "bun:test";

import { MemorySceneStore } from "./store.ts";

const edit = { editorId: "alice", now: new Date(0) };
const bytes = (...values: number[]) => new Uint8Array(values);

describe("MemorySceneStore", () => {
  it("runs one scene's writes in turn, each merging into the last", async () => {
    const store = new MemorySceneStore();
    store.create("g.s");
    const seen: (number[] | null)[] = [];
    const write = (value: number, delayMs: number) =>
      store.write(
        "g.s",
        async (stored) => {
          seen.push(stored ? [...stored] : null);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return { state: bytes(...(stored ?? []), value), schemaVersion: 1 };
        },
        edit,
      );
    await Promise.all([write(1, 30), write(2, 0), write(3, 10)]);
    expect(seen).toEqual([null, [1], [1, 2]]);
    expect([...store.rows.get("g.s")!.state!]).toEqual([1, 2, 3]);
  });

  it("reports a write that changes nothing, a refusal and a missing scene", async () => {
    const store = new MemorySceneStore();
    store.create("g.s");
    await store.write("g.s", async () => ({ state: bytes(1), schemaVersion: 1 }), edit);
    const writes = store.writes;
    expect(await store.write("g.s", async (s) => ({ state: s!, schemaVersion: 1 }), edit)).toEqual({
      kind: "unchanged",
    });
    expect(
      await store.write("g.s", async () => ({ refused: "too-large", bytes: 9, entities: 1 }), edit),
    ).toEqual({ kind: "refused", refused: "too-large", bytes: 9, entities: 1 });
    expect(store.writes).toBe(writes);
    expect(
      await store.write("g.gone", async () => ({ state: bytes(1), schemaVersion: 1 }), edit),
    ).toEqual({
      kind: "gone",
    });
  });

  it("still writes an unchanged state when it brings a snapshot", async () => {
    const store = new MemorySceneStore();
    store.create("g.s");
    await store.write("g.s", async () => ({ state: bytes(1), schemaVersion: 1 }), edit);
    const outcome = await store.write(
      "g.s",
      async (s) => ({ state: s!, schemaVersion: 1, snapshot: { text: "{}", hash: "h" } }),
      edit,
    );
    expect(outcome).toEqual({ kind: "stored", bytes: 1 });
    expect(store.rows.get("g.s")).toMatchObject({
      snapshot: "{}",
      sceneHash: "h",
      lastEditedById: "alice",
    });
  });

  it("keeps going after a merge throws", async () => {
    const store = new MemorySceneStore();
    store.create("g.s");
    const failed = store.write("g.s", async () => Promise.reject(new Error("boom")), edit);
    const next = store.write("g.s", async () => ({ state: bytes(5), schemaVersion: 1 }), edit);
    await expect(failed).rejects.toThrow("boom");
    expect(await next).toEqual({ kind: "stored", bytes: 1 });
  });
});
