import { beforeEach, describe, expect, it } from "vite-plus/test";

import type { ProjectDb } from "../project-sync";
import { ensureProjectContributors, fillProviderFields } from "../project-sync";

/**
 * A fake drizzle handle. The real schema and the real `eq`/`inArray` builders
 * are used — they only build SQL objects — so the only thing standing in is
 * the execution: `select` chains resolve to `rows`, and `insert`/`update`
 * record what they were asked to write.
 */
function fakeDb(rows: unknown[]) {
  const inserted: unknown[][] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
    insert: () => ({
      values: (values: unknown[]) => ({
        onConflictDoNothing: () => {
          inserted.push(values);
          return Promise.resolve();
        },
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          updates.push(patch);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db: db as unknown as ProjectDb, inserted, updates };
}

describe("ensureProjectContributors()", () => {
  it("adds credits that aren't there yet", async () => {
    const { db, inserted } = fakeDb([]);

    const added = await ensureProjectContributors(db, [
      { projectId: "p1", profileId: "u1", displayName: "Yasahiro", source: "placement" },
      { projectId: "p1", displayName: "Wokarol", source: "entry-contributors" },
    ]);

    expect(added).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual([
      expect.objectContaining({ projectId: "p1", profileId: "u1", displayName: "Yasahiro" }),
      expect.objectContaining({ projectId: "p1", profileId: null, displayName: "Wokarol" }),
    ]);
  });

  it("never re-adds a name that is already credited, whatever its casing", async () => {
    // The itch `contributors` jsonb and a free-text `team_members` entry name
    // the same person constantly.
    const { db, inserted } = fakeDb([
      { projectId: "p1", profileId: null, displayName: "  wokarol " },
    ]);

    const added = await ensureProjectContributors(db, [
      { projectId: "p1", displayName: "Wokarol", source: "entry-contributors" },
    ]);

    expect(added).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("never re-adds a profile that is already credited under another name", async () => {
    // The credit's display name is the promise the table makes — a rename on
    // the profile must not mint a second row.
    const { db, inserted } = fakeDb([
      { projectId: "p1", profileId: "u1", displayName: "old handle" },
    ]);

    const added = await ensureProjectContributors(db, [
      { projectId: "p1", profileId: "u1", displayName: "new handle", source: "placement" },
    ]);

    expect(added).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("dedupes within a single call, so one batch can't insert a name twice", async () => {
    const { db } = fakeDb([]);

    const added = await ensureProjectContributors(db, [
      { projectId: "p1", displayName: "Dev", source: "entry-contributors" },
      { projectId: "p1", displayName: "dev", source: "manual" },
      // A different project is a different credit.
      { projectId: "p2", displayName: "Dev", source: "entry-contributors" },
    ]);

    expect(added).toBe(2);
  });

  it("ignores blank names rather than crediting an empty string", async () => {
    const { db, inserted } = fakeDb([]);

    const added = await ensureProjectContributors(db, [
      { projectId: "p1", displayName: "   ", source: "entry-contributors" },
    ]);

    expect(added).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});

describe("fillProviderFields()", () => {
  const facts = {
    id: 4718343,
    title: "Spin to Survive (renamed on itch)",
    short_text: "a game",
    url: "https://dev.itch.io/spin",
    cover_url: "https://img.itch.zone/spin.png",
    published: false,
    published_at: "2026-06-01T00:00:00.000Z",
    classification: "tool",
    type: "html",
    release_status: "in_development",
  };

  function project(overrides: Record<string, unknown> = {}) {
    return {
      id: "p1",
      type: "game",
      description: null,
      url: null,
      imageUrl: null,
      imageKey: null,
      classification: null,
      embedType: null,
      releaseStatus: null,
      releasedAt: null,
      ...overrides,
    };
  }

  let filled: { patch: Record<string, unknown> | undefined; count: number };

  async function run(row: Record<string, unknown>) {
    const { db, updates } = fakeDb([row]);
    const count = await fillProviderFields(db, [{ projectId: "p1", facts }]);
    filled = { patch: updates[0], count };
    return filled;
  }

  beforeEach(() => {
    filled = { patch: undefined, count: 0 };
  });

  it("fills every canonical field the row hasn't answered yet", async () => {
    const { patch, count } = await run(project());

    expect(count).toBe(1);
    expect(patch).toMatchObject({
      description: "a game",
      url: "https://dev.itch.io/spin",
      imageUrl: "https://img.itch.zone/spin.png",
      classification: "tool",
      embedType: "html",
      releaseStatus: "in_development",
      releasedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
  });

  it("never overwrites a field the row already answers", async () => {
    // Fill-if-null is the whole edit-protection scheme until the snapshot
    // gate lands: we can't tell an owner's edit from a stale import.
    const { patch } = await run(
      project({
        description: "the owner's words",
        url: "https://elsewhere.example/spin",
        imageUrl: "https://img.itch.zone/old.png",
        classification: "game",
        embedType: "default",
        releaseStatus: "released",
        releasedAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    );

    expect(patch).toBeUndefined();
  });

  it("never mirrors provider `title` or `published`", async () => {
    // `title` is the field owners actually rename, and a staff hide
    // (`published: false`) must survive the next sweep.
    const { patch } = await run(project());

    expect(patch).not.toHaveProperty("title");
    expect(patch).not.toHaveProperty("published");
  });

  it("derives the curated type on the run that first learns a classification", async () => {
    const { patch } = await run(project());
    expect(patch).toMatchObject({ classification: "tool", type: "tool" });
  });

  it("leaves a curated type the owner already moved off the default", async () => {
    const { patch } = await run(project({ type: "audio" }));

    expect(patch).toMatchObject({ classification: "tool" });
    expect(patch).not.toHaveProperty("type");
  });

  it("leaves a project-scoped cover alone even when imageUrl is null", async () => {
    // An uploaded key always wins over the provider cover.
    const { patch } = await run(project({ imageKey: "project-images/p1/cover.png" }));

    expect(patch).not.toHaveProperty("imageUrl");
  });

  it("writes nothing when there is nothing to fill", async () => {
    const { db, updates } = fakeDb([]);
    await expect(fillProviderFields(db, [])).resolves.toBe(0);
    expect(updates).toHaveLength(0);
  });
});
