// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  createProjectSession,
  layoutPatch,
  layoutToDoc,
  memoryDocHost,
  seedProjectDoc,
  writeEntry,
  type ProjectSession,
} from "../../collab/index";
import { createRegistry, defineGame } from "../../game/index";
import {
  createKindRegistry,
  dataTableKind,
  gameSettingsKind,
  synthKind,
  type AssetEntry,
  type DocLayout,
} from "../../project/index";
import {
  editorIdentity,
  projectRegistry,
  type ProjectRegistry,
} from "../session/live-scene-editor";

const CARD_TABLE = "card";
const AVATAR_SPEED = 300;

/** A game with a card table and an `avatarSpeed` setting, and nothing to play. */
const cardGame = defineGame({
  id: "card-game",
  types: [],
  actions: [],
  tables: {
    [CARD_TABLE]: {
      description: "Cards a deck holds.",
      row: {
        cost: z.number().int().min(0).describe("What playing it costs."),
        damage: z.number().int().min(0).default(0).describe("What it deals; default 0."),
      },
    },
  },
  projectSettings: {
    avatarSpeed: z.number().positive().default(AVATAR_SPEED).describe("Walking speed, px/s."),
  },
  createRuntime: () => ({ snapshot: () => null }),
});

const code = createRegistry(cardGame);
const kinds = createKindRegistry(cardGame);
const tableLayout = dataTableKind.layout as DocLayout;
const settingsLayout = gameSettingsKind.layout as DocLayout;
const synthLayout = synthKind.layout as DocLayout;
const ZAP = { kind: "synth", v: 1, wave: "square", freq: 440, sustainMs: 60, decayMs: 120 };

const CARDS = {
  kind: "data-table",
  v: 1,
  table: CARD_TABLE,
  rows: [
    { id: "fireball", cost: 3, damage: 5 },
    { id: "heal", cost: 2 },
  ],
};
const SETTINGS = { kind: "game-settings", v: 1, engine: {}, game: { avatarSpeed: 450 } };

const entry = (key: string, kind: string, path: string): AssetEntry => ({
  key,
  id: key,
  kind,
  path,
  created: { at: 0, by: "seed" },
});

function seed() {
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {
        cards: entry("cards", "data-table", "data/cards.json"),
        settings: entry("settings", "game-settings", "game-settings.json"),
        zap: entry("zap", "synth", "zap.synth.json"),
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  layoutToDoc(host.doc("asset:p.cards"), tableLayout, CARDS);
  layoutToDoc(host.doc("asset:p.settings"), settingsLayout, SETTINGS);
  layoutToDoc(host.doc("asset:p.zap"), synthLayout, ZAP);
  return host;
}

const opened: { watch: ProjectRegistry; session: ProjectSession }[] = [];

afterEach(() => {
  for (const o of opened.splice(0)) {
    o.watch.destroy();
    o.session.destroy();
  }
});

async function join(host: ReturnType<typeof seed>) {
  const session = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: editorIdentity("Ada").origin,
    registry: code,
    kinds,
  });
  const watch = projectRegistry(session);
  opened.push({ watch, session });
  await watch.ready();
  return { session, watch };
}

describe("the editor's project data", () => {
  it("gives game code the project's settings and table rows from their docs", async () => {
    const { session, watch } = await join(seed());
    expect(watch.project().settings).toEqual({ avatarSpeed: 450 });
    expect(watch.project().table(CARD_TABLE)).toEqual([
      { id: "fireball", cost: 3, damage: 5 },
      { id: "heal", cost: 2, damage: 0 },
    ]);
    expect(watch.current()).toBe(session.registry);
  });

  it("rebuilds the view, and keeps the registry, when a table or the settings change", async () => {
    const host = seed();
    const { session, watch } = await join(host);
    const changed = vi.fn();
    watch.subscribe(changed);
    const before = watch.project();

    layoutPatch(host.doc("asset:p.cards"), tableLayout, {
      ...CARDS,
      rows: [...CARDS.rows, { id: "shield", cost: 1 }],
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(watch.project()).not.toBe(before);
    expect(
      watch
        .project()
        .table(CARD_TABLE)
        .map((r) => r.id),
    ).toEqual(["fireball", "heal", "shield"]);
    expect(watch.current()).toBe(session.registry);

    writeEntry(host.doc("project:p"), {
      ...entry("settings", "game-settings", "game-settings.json"),
      deleted: { at: 1, by: "seed" },
    });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(watch.project().settings).toEqual({ avatarSpeed: AVATAR_SPEED });
  });

  it("stays quiet for an edit that leaves the data as it was", async () => {
    const host = seed();
    const { watch } = await join(host);
    const changed = vi.fn();
    watch.subscribe(changed);
    writeEntry(host.doc("project:p"), {
      ...entry("cards", "data-table", "data/cards.json"),
      name: "Cards",
    });
    expect(changed).not.toHaveBeenCalled();
  });

  it("hands a view kind's edit to the running game in place, edit mode too, with no rebuild", async () => {
    const host = seed();
    const { watch } = await join(host);
    const rebuild = vi.fn();
    watch.subscribe(rebuild);
    const reloadAssets = vi.fn(() => Promise.resolve({ failed: [], errors: [] }));
    watch.followAssets(
      { onAssetChanged: () => () => {} },
      { reloadAssets, getMode: () => "edit" as const },
    );
    const before = watch.project();

    layoutPatch(host.doc("asset:p.zap"), synthLayout, { ...ZAP, osc2: { wave: "saw" } });
    expect(rebuild).not.toHaveBeenCalled();
    expect(watch.project()).not.toBe(before);
    expect(reloadAssets).toHaveBeenCalledTimes(1);
    expect(reloadAssets).toHaveBeenLastCalledWith(
      expect.objectContaining({ project: watch.project(), changed: [] }),
    );

    // A sim kind's edit still rebuilds, and in edit mode reaches the game only through that.
    layoutPatch(host.doc("asset:p.cards"), tableLayout, { ...CARDS, rows: [] });
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(reloadAssets).toHaveBeenCalledTimes(1);
  });
});
