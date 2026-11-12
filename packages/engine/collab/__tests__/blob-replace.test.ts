import { describe, expect, it } from "vite-plus/test";

import { formatSaveFile, parseSaveFile, type SaveFile } from "../../game/save-file";
import { stableJson } from "../../project/canonical";
import { memoryContentStore, type ContentStore } from "../../project/content-store";
import { sha256 } from "../../project/hash";
import type { ProjectOpBatch } from "../../project/ops";
import { rng } from "../../scene/__tests__/fixtures/random-ops";
import { applyProjectBatch } from "../project-apply";
import { readProject } from "../project-doc";
import {
  consistent,
  fixture,
  join,
  ok,
  replace,
  users,
  world as raceWorld,
} from "./fixtures/blob-race";

const PNG = fixture("texture.png");
/** The same 12×10 header with different bytes: a re-export whose meta doesn't change. */
const PNG_RESAVED = new Uint8Array([...PNG, 0]);
const HERO = fixture("hero.png");
const JPEG = fixture("texture.jpg");
const GIF = fixture("texture.gif");
const RUN = fixture("run.recording.json");
const SAVE = fixture("level-2.save.json");

/** The save fixture recaptured, changed by `edit`: another depth or game version. */
function resaved(edit: (file: SaveFile) => SaveFile): Uint8Array {
  const parsed = parseSaveFile(new TextDecoder().decode(SAVE));
  if (!parsed.ok) throw new Error("the save fixture doesn't parse");
  return new TextEncoder().encode(formatSaveFile(edit(parsed.file)));
}

const world = (store: ContentStore) =>
  raceWorld(store, [
    { key: "crate", kind: "texture", path: "art/crate.png", bytes: PNG },
    { key: "run", kind: "recording", path: "runs/run.recording.json", bytes: RUN },
    { key: "slot", kind: "save", path: "fixtures/level-2.save.json", bytes: SAVE },
  ]);

describe("binary replace races", () => {
  for (const [winner, ids] of [
    ["the client with the higher id", [1, 2]],
    ["the client with the lower id", [2, 1]],
  ] as const)
    it(`two concurrent replaces end on one hash, whose size and meta come with it (${winner} first)`, async () => {
      const store = memoryContentStore();
      const host = await world(store);
      const a = await join(host, users[0]!, store, ids[0]);
      const b = await join(host, users[1]!, store, ids[1]);
      await store.put(PNG_RESAVED);
      await store.put(HERO);

      a.setOnline(false);
      b.setOnline(false);
      ok(await replace(a.session, "crate", PNG_RESAVED));
      ok(await replace(b.session, "crate", HERO));
      a.setOnline(true);
      b.setOnline(true);

      const end = readProject(host.doc("project:p"));
      expect(stableJson(readProject(a.session.projectDoc))).toBe(stableJson(end));
      expect(stableJson(readProject(b.session.projectDoc))).toBe(stableJson(end));
      const crate = end.assets.crate!;
      expect([await sha256(PNG_RESAVED), await sha256(HERO)]).toContain(crate.sha256);
      await consistent(store, crate);
      expect(new Set(end.history.crate!.map((h) => h.sha256))).toEqual(
        new Set([await sha256(PNG), await sha256(PNG_RESAVED), await sha256(HERO)]),
      );
      for (const h of end.history.crate!) expect(await store.has(h.sha256)).toBe(true);
      a.session.destroy();
      b.session.destroy();
    });

  it("two concurrent recaptures of a save fixture end on one save, whose meta comes with it", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const a = await join(host, users[0]!, store, 1);
    const b = await join(host, users[1]!, store, 2);
    const progress = resaved(({ world: _world, ...file }) => ({ ...file, depth: "progress" }));
    const later = resaved((file) => ({ ...file, gameVersion: 2 }));
    await store.put(progress);
    await store.put(later);

    a.setOnline(false);
    b.setOnline(false);
    ok(await replace(a.session, "slot", progress));
    ok(await replace(b.session, "slot", later));
    a.setOnline(true);
    b.setOnline(true);

    const end = readProject(host.doc("project:p"));
    expect(stableJson(readProject(a.session.projectDoc))).toBe(stableJson(end));
    expect(stableJson(readProject(b.session.projectDoc))).toBe(stableJson(end));
    const slot = end.assets.slot!;
    expect([await sha256(progress), await sha256(later)]).toContain(slot.sha256);
    await consistent(store, slot);
    expect(new Set(end.history.slot!.map((h) => h.sha256))).toEqual(
      new Set([await sha256(SAVE), await sha256(progress), await sha256(later)]),
    );
    expect(slot.meta).toEqual(
      slot.sha256 === (await sha256(later))
        ? { game: "tactics", gameVersion: 2, depth: "world", scene: "level-2" }
        : { game: "tactics", gameVersion: 1, depth: "progress", scene: "level-2" },
    );
    a.session.destroy();
    b.session.destroy();
  });

  it(
    "random replaces across partitions converge on one consistent hash, keeping every blob",
    { timeout: 30_000 },
    async () => {
      const pool = [PNG, PNG_RESAVED, HERO, JPEG, GIF];
      let retained = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const rand = rng(seed);
        const store = memoryContentStore();
        const host = await world(store);
        const clients = await Promise.all(users.map((u, i) => join(host, u, store, 10 + i)));
        const offered = new Set([await sha256(PNG)]);
        const moved = new Set<string>();
        for (let round = 0; round < 12; round++) {
          const c = clients[Math.floor(rand() * clients.length)]!;
          if (rand() < 0.3) c.setOnline(rand() < 0.5);
          const bytes = pool[Math.floor(rand() * pool.length)]!;
          const hash = await store.put(bytes);
          const from = readProject(c.session.projectDoc).assets.crate!.sha256!;
          const r = await replace(c.session, "crate", bytes);
          expect(r.ok, `seed ${seed} round ${round}`).toBe(true);
          offered.add(hash);
          if (from !== hash) moved.add(from).add(hash);
        }
        for (const c of clients) c.setOnline(true);

        const end = readProject(host.doc("project:p"));
        for (const c of clients)
          expect(stableJson(readProject(c.session.projectDoc)), `seed ${seed}`).toBe(
            stableJson(end),
          );
        const crate = end.assets.crate!;
        expect(offered.has(crate.sha256!)).toBe(true);
        await consistent(store, crate);
        const held = new Set(end.history.crate!.map((h) => h.sha256));
        for (const hash of moved)
          expect(held.has(hash), `seed ${seed}: ${hash} stays in the history`).toBe(true);
        retained += moved.size;
        for (const hash of held) expect(await store.has(hash)).toBe(true);
        if (moved.size === 0) expect(crate.sha256).toBe(await sha256(PNG));
        else
          expect(held.has(crate.sha256!), `seed ${seed}: the current hash is in the history`).toBe(
            true,
          );
        for (const c of clients) c.session.destroy();
      }
      expect(retained, "some replace moved the crate off a hash").toBeGreaterThan(0);
    },
  );
});

describe("blob ops need their bytes in the store", () => {
  it("a replace or an import naming bytes the store lacks is hash-mismatch and writes nothing", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { session } = await join(host, users[0]!, store);
    const before = stableJson(readProject(host.doc("project:p")));
    const absent = await replace(session, "crate", HERO);
    expect(absent.ok || absent.issue.code).toBe("hash-mismatch");
    const imported = await applyProjectBatch(
      session,
      {
        v: 1,
        ops: [
          {
            op: "importAsset",
            path: "art/hero.png",
            sha256: await sha256(HERO),
            bytes: HERO.length,
          },
        ],
      },
      session.origin,
    );
    expect(imported.ok || [imported.issue.code, imported.opIndex]).toEqual(["hash-mismatch", 0]);
    expect(stableJson(readProject(host.doc("project:p")))).toBe(before);

    await store.put(HERO);
    ok(await replace(session, "crate", HERO));
    expect(readProject(host.doc("project:p")).assets.crate).toMatchObject({
      sha256: await sha256(HERO),
      bytes: HERO.length,
      meta: { format: "png", width: 32, height: 8 },
    });
    session.destroy();
  });

  it("bytes the kind can't read are import-failed and write nothing", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { session } = await join(host, users[0]!, store);
    const junk = new TextEncoder().encode("not a png at all");
    await store.put(junk);
    const before = stableJson(readProject(host.doc("project:p")));
    const r = await replace(session, "crate", junk);
    expect(r.ok || r.issue.code).toBe("import-failed");
    const batch: ProjectOpBatch = {
      v: 1,
      ops: [{ op: "importAsset", path: "art/junk.png", sha256: await sha256(junk), bytes: 16 }],
    };
    const imported = await applyProjectBatch(session, batch, session.origin);
    expect(imported.ok || imported.issue.code).toBe("import-failed");
    expect(stableJson(readProject(host.doc("project:p")))).toBe(before);
    session.destroy();
  });

  it("a recording's content is never replaced (asset-kind), even with its bytes in the store", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { session } = await join(host, users[0]!, store);
    const value = JSON.parse(new TextDecoder().decode(RUN)) as { ticks: number };
    const again = new TextEncoder().encode(`${JSON.stringify({ ...value, ticks: value.ticks })}\n`);
    await store.put(again);
    const before = stableJson(readProject(host.doc("project:p")));
    const r = await replace(session, "run", again);
    expect(r.ok || [r.issue.code, r.issue.entityIds]).toEqual(["asset-kind", ["run"]]);
    expect(stableJson(readProject(host.doc("project:p")))).toBe(before);
    session.destroy();
  });

  it("a replace is one undo step that puts back the old hash, size and meta", async () => {
    const store = memoryContentStore();
    const host = await world(store);
    const { session } = await join(host, users[0]!, store);
    await store.put(HERO);
    const before = readProject(host.doc("project:p")).assets.crate!;
    ok(await replace(session, "crate", HERO));
    expect(session.undo()?.label).toBe("replaceContent");
    const after = readProject(host.doc("project:p"));
    expect(after.assets.crate).toEqual(before);
    session.destroy();
  });
});
