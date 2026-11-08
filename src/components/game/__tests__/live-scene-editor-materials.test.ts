// @vitest-environment jsdom
import {
  createProjectSession,
  layoutPatch,
  layoutToDoc,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  writeEntry,
  type ProjectSession,
} from "@jams/engine/collab";
import type { SceneDefinition } from "@jams/engine/editor";
import { createRegistry, type Registry } from "@jams/engine/game";
import { preparePlay } from "@jams/engine/headless";
import {
  createKindRegistry,
  materialKind,
  type AssetEntry,
  type DocLayout,
} from "@jams/engine/project";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { fakeWorldGame } from "@/components/game/editor/__tests__/fake-world-game";
import {
  editorIdentity,
  openLiveEditor,
  projectRegistry,
  type LiveEditor,
  type ProjectRegistry,
} from "@/components/game/live-scene-editor";

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }),
);
vi.mock("@/lib/toast", () => ({ toast }));

const code = createRegistry();
const kinds = createKindRegistry(null);
const layout = materialKind.layout as DocLayout;

const BOUNCY = {
  kind: "material",
  v: 1,
  description: "Bouncy rubber.",
  physics: { friction: 0.4, restitution: 0.9 },
};

const SCENE: SceneDefinition = {
  v: 2,
  name: "yard",
  bounds: [0, 0, 2000, 1200],
  entities: [{ id: "ledge", type: "solid", shape: ["box", 820, 900, 80, 10], material: "bouncy" }],
};

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
        yard: entry("yard", "scene", "yard.json"),
        bouncy: entry("bouncy", "material", "materials/bouncy.json"),
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(SCENE, { doc: host.doc("scene:p.yard"), key: sequentialKeys("s") });
  layoutToDoc(host.doc("asset:p.bouncy"), layout, BOUNCY);
  return host;
}

const opened: { live?: LiveEditor; materials?: ProjectRegistry; session?: ProjectSession }[] = [];

afterEach(() => {
  for (const o of opened.splice(0)) {
    o.live?.destroy();
    o.materials?.destroy();
    o.session?.destroy();
  }
  vi.clearAllMocks();
});

async function join(host: ReturnType<typeof seed>) {
  const identity = editorIdentity("Ada");
  const session = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: identity.origin,
    registry: code,
    kinds,
  });
  const materials = projectRegistry(session);
  opened.push({ materials, session });
  await materials.ready();
  return { session, materials, identity };
}

async function edit(
  session: ProjectSession,
  identity: ReturnType<typeof editorIdentity>,
  registry: Registry,
) {
  const scene = await session.open("scene:p.yard");
  const fake = fakeWorldGame(registry);
  const live = openLiveEditor({
    game: fake.game,
    doc: scene.doc,
    awareness: scene.awareness,
    name: "yard",
    identity,
    issuesDebounceMs: 0,
    project: { session, doc: "scene:p.yard" },
  });
  opened.push({ live });
  return { live, ...fake };
}

/** What Play checks the doc with: the game's registry, which the editor's host builds the game with. */
const playable = (live: LiveEditor) =>
  preparePlay(live.session.getDoc(), live.session.registry, { prefabs: live.session.getPrefabs() });

/** Places a second bouncy solid, which the op is checked against the schema for. */
const place = (live: LiveEditor) =>
  live.session.dispatch({
    label: "Place",
    ops: [
      {
        op: "add",
        entity: { id: "step", type: "solid", shape: ["box", 400, 900, 40, 10], material: "bouncy" },
      },
    ],
  });

describe("the editor's project materials", () => {
  it("overlays the project's material assets on the code registry", async () => {
    const { session, materials } = await join(seed());
    const registry = materials.current();
    expect(registry).not.toBe(session.registry);
    expect(registry.game).toBe(session.registry.game);
    expect(registry.materials.get("bouncy")).toMatchObject({ friction: 0.4, restitution: 0.9 });
    expect(session.registry.materials.has("bouncy")).toBe(false);
  });

  it("binds and validates a scene naming a project material", async () => {
    const { session, materials, identity } = await join(seed());
    const { live, world } = await edit(session, identity, materials.current());
    expect(live.session.registry).toBe(materials.current());
    expect(world()?.entities.map((e) => e.id)).toContain("ledge");
    expect(toast.warning).not.toHaveBeenCalled();
    expect(live.session.store.state.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(place(live).ok).toBe(true);
    expect(playable(live)).toMatchObject({ ok: true });
    expect(live.play()).toBe(true);
  });

  it("would refuse that scene with the code registry alone", async () => {
    const { session, identity } = await join(seed());
    const { live } = await edit(session, identity, code);
    const moved = place(live);
    expect(moved.ok).toBe(false);
    const refused = playable(live);
    expect(refused.ok).toBe(false);
    expect(refused.issues[0]).toMatchObject({ code: "schema", path: "/entities/0/material" });
  });

  it("rebuilds when a material is edited, added or deleted", async () => {
    const host = seed();
    const { materials } = await join(host);
    const changed = vi.fn();
    materials.subscribe(changed);

    layoutPatch(host.doc("asset:p.bouncy"), layout, {
      ...BOUNCY,
      physics: { friction: 0.4, restitution: 0.2 },
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(materials.current().materials.get("bouncy")?.restitution).toBe(0.2);

    layoutToDoc(host.doc("asset:p.ice"), layout, {
      kind: "material",
      v: 1,
      description: "Ice.",
      physics: { friction: 0, restitution: 0 },
    });
    writeEntry(host.doc("project:p"), entry("ice", "material", "materials/ice.json"));
    await materials.ready();
    await vi.waitFor(() => expect(materials.current().materials.has("ice")).toBe(true));

    const deleted = { ...entry("bouncy", "material", "materials/bouncy.json") };
    writeEntry(host.doc("project:p"), { ...deleted, deleted: { at: 1, by: "seed" } });
    expect(materials.current().materials.has("bouncy")).toBe(false);
    expect(materials.current().materials.has("ice")).toBe(true);
  });

  it("keeps the code registry, and stays quiet, for a project without materials", async () => {
    const host = seed();
    writeEntry(host.doc("project:p"), {
      ...entry("bouncy", "material", "materials/bouncy.json"),
      deleted: { at: 1, by: "seed" },
    });
    const { session, materials } = await join(host);
    const changed = vi.fn();
    materials.subscribe(changed);
    expect(materials.current()).toBe(session.registry);
    writeEntry(host.doc("project:p"), { ...entry("yard", "scene", "yard.json"), name: "Yard" });
    expect(changed).not.toHaveBeenCalled();
    expect(materials.current()).toBe(session.registry);
  });

  it("lets go of the material docs it opened", async () => {
    const { session, materials } = await join(seed());
    expect(session.openDocs()).toContain("asset:p.bouncy");
    materials.destroy();
    expect(session.openDocs()).not.toContain("asset:p.bouncy");
  });
});
