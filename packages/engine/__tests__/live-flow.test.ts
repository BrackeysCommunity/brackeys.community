// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { createFlowHost, liveSceneSource, type LiveSceneVersions } from "../flow-host";
import type { LibraryScene, SceneLibrary } from "../game/flow";
import type { AssetId } from "../project/types";
import { loadListed } from "../runtime/flow";
import { createSceneRuntime } from "../runtime/runtime";
import type { SceneRuntimeHandle } from "../runtime/types";
import type { SceneDefinition } from "../scene/types";
import type { FlowResult, SceneSource } from "../types";
import { markerScene } from "./fixtures/live-version";
import { testGame } from "./fixtures/test-game";

const scene = (name: string, markers: readonly string[]): SceneDefinition =>
  markerScene(name, markers, { settings: { physics: "none" } });

const listed = (def: SceneDefinition): LibraryScene => ({ def, prefabs: new Map() });

/** The release's own scenes: two levels and a sublevel. */
function releaseSource(): SceneSource {
  const scenes = new Map<AssetId, LibraryScene>([
    ["hall", listed(scene("hall", ["start"]))],
    ["yard", listed(scene("yard", ["start", "well"]))],
    ["cellar", listed(scene("cellar", ["door"]))],
  ]);
  return {
    list: () => [{ scene: "hall" }, { scene: "yard" }, { scene: "cellar", sublevel: true }],
    start: () => "hall",
    scene: (id) => scenes.get(id) ?? null,
  };
}

/**
 * A stand-in for the live layer's per-scene state: the version each scene's
 * loads use, and the swaps waiting for their timing.
 */
function fakeLive() {
  const active = new Map<AssetId, LibraryScene>();
  const pending = new Set<AssetId>();
  const live: LiveSceneVersions = { sceneFor: (id) => active.get(id) ?? null };
  return { live, active, pending, drop: (id: AssetId) => pending.delete(id) };
}

/** The library a runtime's flow loads and attaches read, built from the source as the shell builds it. */
function libraryOf(source: SceneSource): SceneLibrary {
  const list = source.list();
  const scenes = new Map<AssetId, LibraryScene>();
  for (const entry of list) {
    const s = source.scene(entry.scene);
    if (s) scenes.set(entry.scene, s);
  }
  return { list, scenes };
}

const runtimeOver = (source: SceneSource): SceneRuntimeHandle =>
  createSceneRuntime({ rapier: null, view: null, game: testGame, scenes: () => libraryOf(source) });

const ids = (rt: SceneRuntimeHandle): string[] => rt.scene()!.entities.map((e) => e.id);

/** A flow host over `source` whose loads build into `rt`, without visuals. */
function hostOver(
  source: SceneSource,
  rt: SceneRuntimeHandle,
  hooks: { left?: (id: AssetId) => void; transition?: () => void } = {},
) {
  let current: AssetId | null = null;
  const host = createFlowHost({
    source,
    loading: false,
    transition: async () => hooks.transition?.(),
    layer: () => ({}) as HTMLElement,
    current: () => current,
    setTicking: () => {},
    unload: () => () => {},
    preload: async () => {},
    load(id, opts): FlowResult {
      const loaded = loadListed(rt, id, { entry: opts.entry });
      if (!loaded.ok) return { ok: false, issue: loaded.issue };
      current = id;
      return { ok: true, scene: id, report: loaded.report };
    },
    changed: () => {},
    ...(hooks.left ? { left: hooks.left } : {}),
    loadingProgress: () => {},
    destroyed: () => false,
    dev: false,
  });
  return host;
}

describe("liveSceneSource", () => {
  it("answers a scene with its active version, and the list and start from the base", () => {
    const base = releaseSource();
    const { live, active } = fakeLive();
    const source = liveSceneSource(base, live);
    expect(source.scene("yard")).toBe(base.scene("yard"));
    const version = listed(scene("yard", ["start", "well", "bucket"]));
    active.set("yard", version);
    expect(source.scene("yard")).toBe(version);
    expect(source.scene("hall")).toBe(base.scene("hall"));
    expect(source.scene("ghost")).toBeNull();
    expect(source.list()).toEqual(base.list());
    expect(source.start()).toBe("hall");
  });
});

describe("flow loads through the live source", () => {
  it("a flow.go to a scene with an active version loads it", async () => {
    const { live, active } = fakeLive();
    const source = liveSceneSource(releaseSource(), live);
    const rt = runtimeOver(source);
    const host = hostOver(source, rt);
    expect((await host.restart()).ok).toBe(true);
    expect(ids(rt)).toEqual(["start"]);

    active.set("yard", listed(scene("yard", ["start", "well", "bucket"])));
    const went = await host.go("yard");
    expect(went).toMatchObject({ ok: true, scene: "yard" });
    expect(ids(rt)).toEqual(["start", "well", "bucket"]);

    active.delete("yard");
    await host.go("yard");
    expect(ids(rt)).toEqual(["start", "well"]);
  });

  it("leaving a scene drops its pending swap, and its next load uses the version anyway", async () => {
    const { live, active, pending, drop } = fakeLive();
    const source = liveSceneSource(releaseSource(), live);
    const rt = runtimeOver(source);
    const left: AssetId[] = [];
    const host = hostOver(source, rt, {
      left: (id) => {
        left.push(id);
        drop(id);
      },
    });
    await host.restart();
    expect(left).toEqual([]);

    active.set("hall", listed(scene("hall", ["start", "torch"])));
    pending.add("hall");
    pending.add("yard");
    await host.go("yard", { transition: { kind: "fade" } });
    expect(left).toEqual(["hall"]);
    expect([...pending]).toEqual(["yard"]);

    await host.go("hall");
    expect(ids(rt)).toEqual(["start", "torch"]);
    expect(left).toEqual(["hall", "yard"]);
  });

  it("a restart drops the restarted scene's pending swap", async () => {
    const { live, active, pending, drop } = fakeLive();
    const source = liveSceneSource(releaseSource(), live);
    const rt = runtimeOver(source);
    const host = hostOver(source, rt, { left: drop });
    await host.restart();
    active.set("hall", listed(scene("hall", ["start", "torch"])));
    pending.add("hall");
    await host.restart();
    expect(pending.size).toBe(0);
    expect(ids(rt)).toEqual(["start", "torch"]);
  });

  it("a failed change keeps the left scene's pending swap", async () => {
    const { live, pending, drop } = fakeLive();
    const base = releaseSource();
    const holes: SceneSource = { ...base, scene: (id) => (id === "yard" ? null : base.scene(id)) };
    const source = liveSceneSource(holes, live);
    const rt = runtimeOver(source);
    const host = hostOver(source, rt, { left: drop });
    await host.restart();
    pending.add("hall");
    const went = await host.go("yard");
    expect(went.ok).toBe(false);
    expect([...pending]).toEqual(["hall"]);
  });

  it("reports changing through the whole transition, when no swap may run", async () => {
    const { live } = fakeLive();
    const source = liveSceneSource(releaseSource(), live);
    const rt = runtimeOver(source);
    const seen: boolean[] = [];
    const host = hostOver(source, rt, {
      left: () => seen.push(host.changing),
      transition: () => seen.push(host.changing),
    });
    await host.restart();
    await host.go("yard", { transition: { kind: "fade" } });
    expect(seen).toEqual([true, true, true]);
    expect(host.changing).toBe(false);
  });
});

describe("sublevels through the live source", () => {
  it("a sublevel attached while a version is pending keeps the old one now and gets the new one at its next attach", async () => {
    const { live, active } = fakeLive();
    const source = liveSceneSource(releaseSource(), live);
    const rt = runtimeOver(source);
    const host = hostOver(source, rt);
    await host.restart();
    expect(rt.ctx.flow.attach("cellar", { label: "low", at: [0, 5] })).toMatchObject({
      ok: true,
      entities: ["low:door"],
    });

    active.set("cellar", listed(scene("cellar", ["door", "barrel"])));
    expect(ids(rt)).toEqual(["start", "low:door"]);
    // The run keeps the library it loaded with, so a re-attach in the same run is the old scene too.
    rt.ctx.flow.detach("low");
    rt.step(rt.ctx.time.tickMs, [], []);
    expect(rt.ctx.flow.attach("cellar", { label: "low" })).toMatchObject({
      ok: true,
      entities: ["low:door"],
    });

    await host.restart();
    expect(rt.ctx.flow.attach("cellar", { label: "low" })).toMatchObject({
      ok: true,
      entities: ["low:door", "low:barrel"],
    });
  });

  it("an attach of a version still runs the sublevel checks against the main scene", async () => {
    const { live, active } = fakeLive();
    const source = liveSceneSource(releaseSource(), live);
    const rt = runtimeOver(source);
    const host = hostOver(source, rt);
    active.set("cellar", {
      def: { ...scene("cellar", ["door"]), settings: { physics: "rapier" } },
      prefabs: new Map(),
    });
    await host.restart();
    const attached = rt.ctx.flow.attach("cellar", { label: "low" });
    expect(attached.ok).toBe(false);
    if (!attached.ok) expect(attached.issue.code).toBe("sublevel-invalid");
  });
});
