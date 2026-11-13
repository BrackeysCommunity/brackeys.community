import { flowIssue } from "../game/flow";
import { resolveTime } from "../game/time";
import {
  blobContent,
  namedPrefabs,
  projectBundle,
  sceneBundle,
  unsizedIds,
  type AssetBundle,
} from "../project/bundle";
import { sha256 } from "../project/hash";
import { byCodeUnit } from "../project/kinds/define";
import { engineResolution, gameSettingsEntries } from "../project/kinds/game-settings";
import { prefabKind } from "../project/kinds/prefab";
import { sceneKind } from "../project/kinds/scene";
import {
  sceneListEntries,
  sceneListFlow,
  sceneListIssues,
  type SceneListEntry,
} from "../project/kinds/scene-list";
import { buildRefIndex, type RefIndex } from "../project/refs";
import type { ReleaseAsset, ReleaseManifest, ReleaseScene } from "../project/release";
import { RUNTIME_VIEW_KINDS } from "../project/runtime-view";
import { jsonValues } from "../project/snapshot";
import type { AssetEntry, AssetId, ProjectExport } from "../project/types";
import { defaultPhysics, expandScene, scenePhysics } from "../scene/expand";
import { makeIssue } from "../scene/issues";
import { locatePointer, parseScene } from "../scene/parse";
import { parsePrefab, prefabsUsedBy } from "../scene/prefab";
import type { Prefab, PrefabLibrary, SceneDefinition, SceneIssue } from "../scene/types";
import { assetCredits } from "./credits";
import { iconFile, planIcons } from "./icons";
import type { ContentPlan, ExportInput } from "./plan";
import { exportTarget, exportTargetNames } from "./targets";

/** `data/<sha256>.json`: where a doc's canonical text ships. */
const dataFile = (hash: string): string => `data/${hash}.json`;

/** `assets/<sha256><ext>`: where a blob ships, its extension the one its path ends in. */
function blobFile(entry: Pick<AssetEntry, "path">, hash: string): string {
  const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return `assets/${hash}${/^\.[a-z0-9]+$/.test(ext) ? ext : ""}`;
}

const withAsset = (id: AssetId, issues: readonly SceneIssue[]): SceneIssue[] =>
  issues.map((i) => (i.entityIds[0] === id ? i : { ...i, entityIds: [id, ...i.entityIds] }));

/** Each live prefab read from its text by id, parsed once and only when a scene reaches it. */
function prefabReader(input: ExportInput, issues: SceneIssue[]) {
  const read = new Map<AssetId, Prefab | null>();
  const get = (id: AssetId): Prefab | undefined => {
    if (!read.has(id)) {
      const entry = input.view.byId.get(id);
      const text = entry?.kind === prefabKind.kind ? input.texts.get(id) : undefined;
      const parsed = text === undefined ? null : parsePrefab(text, input.registry);
      if (parsed && !parsed.ok) issues.push(...withAsset(id, parsed.issues));
      read.set(id, parsed?.ok ? parsed.prefab : null);
    }
    return read.get(id) ?? undefined;
  };
  /** The prefabs `def` reaches, nested ones and variant bases included. */
  const library = (def: SceneDefinition): PrefabLibrary => {
    const lib = new Map<string, Prefab>();
    const pending = prefabsUsedBy(def);
    for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
      if (lib.has(id)) continue;
      const prefab = get(id);
      if (!prefab) continue;
      lib.set(id, prefab);
      if (typeof prefab.base === "string") pending.push(prefab.base);
      for (const nested of prefab.instances ?? []) pending.push(nested.prefab);
    }
    return lib;
  };
  return { get, library };
}

/** A listed scene as it ships, its bundle's entries resolved for the blobs to ship. */
type PlannedScene = { release: ReleaseScene; bundle: AssetBundle };

function planScene(
  entry: SceneListEntry,
  input: ExportInput,
  prefabs: ReturnType<typeof prefabReader>,
  issues: SceneIssue[],
): PlannedScene {
  const empty: AssetBundle = { name: entry.scene, entries: [], bytes: 0 };
  const base = {
    id: entry.scene,
    ...(entry.title !== undefined ? { title: entry.title } : {}),
    ...(entry.sublevel ? { sublevel: true as const } : {}),
  };
  const fallback = (): PlannedScene => ({
    release: {
      ...base,
      physics: defaultPhysics(input.registry, input.engine),
      prefabs: [],
      bundle: { entries: [], bytes: 0 },
    },
    bundle: empty,
  });
  const asset = input.view.byId.get(entry.scene);
  const text = asset?.kind === sceneKind.kind ? input.texts.get(entry.scene) : undefined;
  if (text === undefined) {
    issues.push(
      makeIssue("asset-missing", {
        message: `the scene list names scene "${entry.scene}", which the project has no ${asset ? "text for" : "live scene"} to ship`,
        entityIds: [entry.scene],
        got: entry.scene,
        expected: sceneKind.kind,
      }),
    );
    return fallback();
  }
  const parsed = parseScene(text, input.registry, { prefab: prefabs.get });
  if (!parsed.ok) {
    issues.push(...withAsset(entry.scene, parsed.issues));
    return fallback();
  }
  const def = parsed.def;
  const library = prefabs.library(def);
  let bundle = empty;
  try {
    const expanded = expandScene(def, input.registry, { prefabs: library, engine: input.engine });
    const named = namedPrefabs(expanded.entities, input.registry, prefabs.get);
    const reach = new Map([...library, ...named]);
    const read = sceneBundle(expanded, def, reach, input.view, input.kinds, input.registry);
    issues.push(...withAsset(entry.scene, read.issues));
    bundle = read.bundle;
  } catch (error) {
    issues.push(
      makeIssue("schema", {
        message: `scene "${entry.scene}" doesn't expand: ${error instanceof Error ? error.message : String(error)}`,
        entityIds: [entry.scene],
      }),
    );
  }
  return {
    release: {
      ...base,
      physics: scenePhysics(def, input.registry, input.engine),
      prefabs: prefabsUsedBy(def, library),
      bundle: { entries: bundle.entries.map((e) => e.id), bytes: bundle.bytes },
    },
    bundle,
  };
}

/**
 * The live assets that ship: the listed scenes and the runtime docs, then
 * everything they reach through their references and bundles, nested
 * prefabs, an atlas's texture and a table's assets included. A scene ships
 * only when listed, and code never does; checks, input scripts,
 * recordings and saves aren't reached from these, and the trash isn't live.
 */
function shippedIds(
  input: ExportInput,
  index: RefIndex,
  roots: readonly AssetId[],
  listed: ReadonlySet<AssetId>,
): AssetId[] {
  const ships = (entry: AssetEntry | undefined): entry is AssetEntry => {
    if (!entry) return false;
    const storage = input.kinds.get(entry.kind)?.storage;
    if (storage !== "doc" && storage !== "blob") return false;
    return entry.kind !== sceneKind.kind || listed.has(entry.id);
  };
  const seen = new Set<AssetId>();
  const pending = [...roots];
  for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
    if (seen.has(id) || !ships(input.view.byId.get(id))) continue;
    seen.add(id);
    for (const site of index.targets(id)) pending.push(site.id);
  }
  return [...seen].sort(byCodeUnit);
}

/**
 * `scene-unlisted` (warn) for each reference out of a shipped asset to a
 * scene the list doesn't hold (a door's or a sublevel's target): that scene
 * doesn't ship, so the jump fails at runtime. The list's own entries are
 * judged by `flowIssue` at its start.
 */
function unlistedReferences(
  input: ExportInput,
  index: RefIndex,
  shipped: readonly AssetId[],
  list: readonly SceneListEntry[],
  listId: AssetId | undefined,
  lineOf: (id: AssetId, pointer: string) => number | undefined,
): SceneIssue[] {
  const listed = new Set(list.map((e) => e.scene));
  const issues: SceneIssue[] = [];
  for (const from of shipped) {
    if (from === listId) continue;
    const seen = new Set<string>();
    for (const site of index.targets(from)) {
      const target = input.view.byId.get(site.id);
      if (target?.kind !== sceneKind.kind || listed.has(site.id)) continue;
      if (seen.has(`${site.pointer}\n${site.id}`)) continue;
      seen.add(`${site.pointer}\n${site.id}`);
      const refused = flowIssue(list, site.id, "go");
      const source = input.view.byId.get(from);
      const line = lineOf(from, site.pointer);
      issues.push(
        makeIssue("scene-unlisted", {
          message: `${refused?.message ?? `"${site.id}" isn't in the scene list`}: "${from}" (${source?.path ?? from} at ${site.pointer}) names it, and it doesn't ship`,
          path: site.pointer,
          ...(line === undefined ? {} : { line }),
          entityIds: [from, site.id],
          got: site.id,
        }),
      );
    }
  }
  return issues;
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

async function releaseAsset(
  entry: AssetEntry,
  input: ExportInput,
  issues: SceneIssue[],
  unsized: ReadonlySet<AssetId>,
): Promise<ReleaseAsset | null> {
  const storage = input.kinds.get(entry.kind)?.storage;
  const common = {
    key: entry.key,
    kind: entry.kind,
    path: entry.path,
    ...(entry.name !== undefined ? { name: entry.name } : {}),
  };
  const licence =
    entry.licence && Object.keys(entry.licence).length > 0
      ? { licence: structuredClone(entry.licence) }
      : {};
  if (storage === "doc") {
    const text = input.texts.get(entry.id);
    if (text === undefined) {
      issues.push(
        makeIssue("asset-missing", {
          message: `"${entry.id}" (${entry.path}) ships, but the export has no canonical text for it`,
          entityIds: [entry.id],
          got: entry.id,
        }),
      );
      return null;
    }
    const hash = await sha256(text);
    return {
      ...common,
      sha256: hash,
      bytes: utf8Bytes(text),
      storage: "doc",
      file: dataFile(hash),
      ...licence,
    };
  }
  if (entry.sha256 === undefined) return null;
  // The size becomes the build file's row and the release's pin, so a guessed one would disagree with the bytes shipped.
  const content = blobContent(entry);
  if (!content) {
    if (unsized.has(entry.id)) return null;
    issues.push(
      makeIssue("asset-missing", {
        message: `"${entry.id}" (${entry.path}) ships, but its entry records no size for blob ${entry.sha256}`,
        entityIds: [entry.id],
        got: entry.id,
      }),
    );
    return null;
  }
  return {
    ...common,
    ...content,
    storage: "blob",
    file: blobFile(entry, entry.sha256),
    ...(entry.meta && Object.keys(entry.meta).length > 0
      ? { meta: structuredClone(entry.meta) }
      : {}),
    ...(entry.import && Object.keys(entry.import).length > 0
      ? { import: structuredClone(entry.import) }
      : {}),
    ...licence,
  };
}

/**
 * The installed app's orientation when the project file doesn't set one:
 * the virtual area's aspect when the policy in force (the project's, then
 * the game's, as `resolveResolution` orders them) fixes both sides, else
 * "any".
 */
function orientationOf(input: ExportInput): "any" | "landscape" | "portrait" {
  const virtual: { width?: number; height?: number } | undefined =
    engineResolution(input.engine)?.virtual ?? input.game.resolution?.virtual;
  const width = virtual?.width;
  const height = virtual?.height;
  if (width === undefined || height === undefined) return "any";
  if (width > height) return "landscape";
  if (height > width) return "portrait";
  return "any";
}

const DEFAULT_BACKGROUND = "#000000";

function planPwa(input: ExportInput): ReleaseManifest["pwa"] {
  const block: ProjectExport = input.project.export ?? {};
  if (!exportTarget(input.target)?.pwa || block.pwa === false) return null;
  const background = block.background ?? DEFAULT_BACKGROUND;
  return {
    name: input.project.name,
    shortName: block.shortName ?? input.project.name,
    display: block.display ?? "fullscreen",
    orientation: block.orientation ?? orientationOf(input),
    themeColor: block.themeColor ?? background,
    background,
    icons: [
      { file: iconFile(192), size: 192 },
      { file: iconFile(512), size: 512 },
    ],
  };
}

/**
 * What ships: every scene the scene list holds, every prefab they expand,
 * the runtime docs and the blobs of their bundles and the project bundle,
 * with whatever those reference. The only place an export chooses its
 * content. Its issues: the target, the list's start, each listed scene's
 * parse and bundle, `scene-unlisted` for checks naming a scene flow can't
 * go to, references out of shipped assets that don't resolve, the icons,
 * and `licence-missing` once per shipped blob without one.
 */
export async function planContent(input: ExportInput): Promise<ContentPlan> {
  const issues: SceneIssue[] = [];
  if (!exportTarget(input.target))
    issues.push(
      makeIssue("export-target-unsupported", {
        message: `this engine doesn't build the "${input.target}" target; it builds ${exportTargetNames().join(", ")}`,
        got: input.target,
        expected: exportTargetNames().join(" or "),
      }),
    );

  const values = jsonValues(input.texts);
  const [listEntry] = sceneListEntries(input.view);
  const list = sceneListFlow(listEntry ? values.get(listEntry.id) : undefined);
  const startIssue = flowIssue(list.scenes, list.start, "start");
  if (startIssue) issues.push(startIssue);
  const lineOf = (id: AssetId, pointer: string) => {
    const text = input.texts.get(id);
    return text === undefined ? undefined : locatePointer(text, pointer);
  };
  issues.push(...sceneListIssues(input.view, values, { lineOf }));

  const prefabs = prefabReader(input, issues);
  const planned = list.scenes.map((entry) => planScene(entry, input, prefabs, issues));
  const listed = new Set(list.scenes.map((e) => e.scene));

  const [settingsEntry] = gameSettingsEntries(input.view);
  const project = projectBundle(
    input.view,
    settingsEntry ? values.get(settingsEntry.id) : undefined,
    input.kinds,
    input.registry,
  );
  issues.push(...project.issues);

  const runtimeDocs = [...input.view.byId.values()]
    .filter((e) => RUNTIME_VIEW_KINDS.includes(e.kind))
    .map((e) => e.id);
  const roots = [
    ...runtimeDocs,
    ...planned.flatMap((s) => [
      s.release.id,
      ...s.release.prefabs,
      ...s.bundle.entries.map((e) => e.id),
    ]),
    ...project.bundle.entries.map((e) => e.id),
  ];
  const index = buildRefIndex(input.view, values, input.kinds, {
    registry: input.registry,
    project: input.view,
  });
  // A named icon ships at its icon path; one that something else also reaches ships at its own file too.
  const icons = planIcons(input);
  const reached = new Set(shippedIds(input, index, roots, listed));
  const iconOnly = new Map<AssetId, string>();
  for (const icon of icons.icons)
    if (icon.source.kind === "asset" && !reached.has(icon.source.id))
      iconOnly.set(icon.source.id, icon.file);
  const ids = shippedIds(input, index, [...roots, ...iconOnly.keys()], listed);
  const shipped = new Set(ids);
  issues.push(...unlistedReferences(input, index, ids, list.scenes, listEntry?.id, lineOf));
  // Scenes' and the settings' references are judged by their bundles, and listed scenes by planScene.
  const judged = new Set([...listed, settingsEntry?.id, listEntry?.id]);
  issues.push(
    ...index.dangling().filter((i) => {
      const from = i.entityIds[0];
      return from !== undefined && shipped.has(from) && !judged.has(from);
    }),
  );

  const assets: Record<AssetId, ReleaseAsset> = {};
  const unsized = unsizedIds(issues);
  for (const id of ids) {
    const asset = await releaseAsset(input.view.byId.get(id)!, input, issues, unsized);
    const iconPath = iconOnly.get(id);
    if (asset) assets[id] = iconPath === undefined ? asset : { ...asset, file: iconPath };
  }

  const credits = assetCredits(assets);
  issues.push(...credits.issues);
  issues.push(...icons.issues);

  const time = resolveTime({ project: input.engine, game: input.game.time });
  const scenes = planned.map((s) => s.release);
  return {
    start: list.start ?? "",
    scenes,
    projectBundle: {
      entries: project.bundle.entries.map((e) => e.id),
      bytes: project.bundle.bytes,
    },
    assets,
    needsRapier: scenes.some((s) => s.physics === "rapier"),
    time: {
      kind: time.kind,
      rate: time.rate,
      catchUp: time.catchUp,
      wakeOnPointerMove: time.wakeOnPointerMove,
    },
    credits: credits.credits,
    pwa: planPwa(input),
    issues,
  };
}
