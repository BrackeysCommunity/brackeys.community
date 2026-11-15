import { flowIssue } from "../game/flow";
import { resolveTime } from "../game/time";
import {
  blobContent,
  bundleOf,
  namedPrefabs,
  projectBundle,
  sceneBundle,
  unsizedIds,
  type AssetBundle,
  type BundleEntry,
} from "../project/bundle";
import { AUDIO_KIND } from "../project/kinds/audio";
import { isRuntimeKind } from "../project/kinds/define";
import { engineResolution, gameSettingsEntries } from "../project/kinds/game-settings";
import { prefabKind } from "../project/kinds/prefab";
import { sceneKind } from "../project/kinds/scene";
import {
  sceneListEntries,
  sceneListFlow,
  sceneListIssues,
  type SceneListEntry,
} from "../project/kinds/scene-list";
import { buildRefIndex, siteFits, type RefIndex } from "../project/refs";
import type { ReleaseAsset, ReleaseManifest, ReleaseScene } from "../project/release";
import {
  listedFields,
  reachedAssets,
  releaseAssetOf,
  releaseFiles,
  releaseSceneEntry,
} from "../project/release-assets";
import { jsonValues, withId } from "../project/snapshot";
import type { AssetEntry, AssetId, ProjectExport } from "../project/types";
import { defaultPhysics, expandScene } from "../scene/expand";
import { makeIssue } from "../scene/issues";
import { locatePointer, parseScene } from "../scene/parse";
import { prefabReader, type PrefabReader } from "../scene/prefab";
import type { SceneIssue } from "../scene/types";
import { assetCredits } from "./credits";
import { iconFile, planIcons } from "./icons";
import type { ContentPlan, ExportInput } from "./plan";
import { exportTarget, exportTargetNames } from "./targets";

/** A listed scene as it ships, its bundle's entries resolved for the blobs to ship. */
type PlannedScene = { release: ReleaseScene; bundle: AssetBundle };

/**
 * The audio clips the runtime docs among `docs` need for their first frame
 * (a preloaded sound's), through each kind's `bundleRefs` (default `refs`)
 * and the runtime docs those name in turn. A bundle walk follows them but
 * keeps only textures, so a release's bundles take the clips from here.
 * A clip without a recorded size is left out: shipping it reports that.
 */
function preloadedClips(
  docs: Iterable<AssetId>,
  input: ExportInput,
  values: ReadonlyMap<AssetId, unknown>,
): BundleEntry[] {
  const env = { registry: input.registry, project: input.view };
  const isDoc = (id: AssetId) =>
    isRuntimeKind(input.kinds.get(input.view.byId.get(id)?.kind ?? ""));
  const out: BundleEntry[] = [];
  const seen = new Set<AssetId>();
  const pending = [...docs].filter(isDoc);
  for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const def = input.kinds.get(input.view.byId.get(id)!.kind);
    const value = values.get(id);
    if (!isRuntimeKind(def) || value === undefined) continue;
    const sites = def.bundleRefs ? def.bundleRefs(value, env) : def.refs?.(value, env);
    for (const site of sites ?? []) {
      const target = input.view.byId.get(site.id);
      if (!target || !siteFits(site, target.kind)) continue;
      if (isDoc(site.id)) pending.push(site.id);
      const content = target.kind === AUDIO_KIND ? blobContent(target) : null;
      if (content) out.push({ id: target.id, kind: target.kind, ...content });
    }
  }
  return out;
}

function planScene(
  entry: SceneListEntry,
  input: ExportInput,
  prefabs: PrefabReader,
  values: ReadonlyMap<AssetId, unknown>,
  issues: SceneIssue[],
): PlannedScene {
  const empty: AssetBundle = { name: entry.scene, entries: [], bytes: 0 };
  const fallback = (): PlannedScene => ({
    release: {
      ...listedFields(entry),
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
    issues.push(...withId(entry.scene, parsed.issues));
    return fallback();
  }
  const def = parsed.def;
  let library = prefabs.library(def);
  let bundle = empty;
  try {
    const expanded = expandScene(def, input.registry, { prefabs: library, engine: input.engine });
    const named = namedPrefabs(expanded.entities, input.registry, prefabs.get);
    library = new Map([...library, ...named]);
    const followed: AssetId[] = [];
    const read = sceneBundle(expanded, def, library, input.view, input.kinds, input.registry, {
      read: (_kind, id) => {
        followed.push(id);
        return values.get(id);
      },
    });
    issues.push(...withId(entry.scene, read.issues));
    const clips = preloadedClips(followed, input, values);
    bundle =
      clips.length === 0
        ? read.bundle
        : bundleOf(read.bundle.name, [...read.bundle.entries, ...clips]);
  } catch (error) {
    issues.push(
      makeIssue("schema", {
        message: `scene "${entry.scene}" doesn't expand: ${error instanceof Error ? error.message : String(error)}`,
        entityIds: [entry.scene],
      }),
    );
  }
  return {
    release: releaseSceneEntry(entry, def, library, bundle, input.registry, input.engine),
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
const shippedIds = (
  input: ExportInput,
  index: RefIndex,
  roots: readonly AssetId[],
  listed: ReadonlySet<AssetId>,
): AssetId[] => reachedAssets(input.view, input.kinds, index, roots, (id) => listed.has(id));

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

/** `entry` as the release ships it, under `data/` or `assets/`. */
async function releaseAsset(
  entry: AssetEntry,
  input: ExportInput,
  issues: SceneIssue[],
  unsized: ReadonlySet<AssetId>,
): Promise<ReleaseAsset | null> {
  const made = await releaseAssetOf(entry, {
    kinds: input.kinds,
    texts: input.texts,
    files: releaseFiles,
    unsized,
    issues,
    missing: {
      text: (e) => `"${e.id}" (${e.path}) ships, but the export has no canonical text for it`,
      blob: (e) =>
        e.sha256 === undefined
          ? null
          : `"${e.id}" (${e.path}) ships, but its entry records no size for blob ${e.sha256}`,
    },
  });
  return made?.asset ?? null;
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
 * with whatever those reference. A sound ships with every clip and patch it
 * names; only a preloaded sound's clips join the bundles that name it. The
 * only place an export chooses its content. Its issues: the target, the
 * list's start, each listed scene's parse and bundle, `scene-unlisted` for
 * checks naming a scene flow can't go to, references out of shipped assets
 * that don't resolve, the icons, and `licence-missing` once per shipped
 * blob without one.
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

  // Each live prefab is parsed once, and only when a scene reaches it.
  const prefabs = prefabReader(input.registry, {
    text: (id) =>
      input.view.byId.get(id)?.kind === prefabKind.kind ? input.texts.get(id) : undefined,
    failed: (id, found) => issues.push(...withId(id, found)),
  });
  const planned = list.scenes.map((entry) => planScene(entry, input, prefabs, values, issues));
  const listed = new Set(list.scenes.map((e) => e.scene));

  const index = buildRefIndex(input.view, values, input.kinds, {
    registry: input.registry,
    project: input.view,
  });
  const [settingsEntry] = gameSettingsEntries(input.view);
  const project = projectBundle(
    input.view,
    settingsEntry ? values.get(settingsEntry.id) : undefined,
    input.kinds,
    input.registry,
  );
  issues.push(...project.issues);
  const projectClips = settingsEntry
    ? preloadedClips(
        index.targets(settingsEntry.id).map((s) => s.id),
        input,
        values,
      )
    : [];
  const resident = bundleOf("project", [...project.bundle.entries, ...projectClips]);

  const runtimeDocs = [...input.view.byId.values()]
    .filter((e) => isRuntimeKind(input.kinds.get(e.kind)))
    .map((e) => e.id);
  const roots = [
    ...runtimeDocs,
    ...planned.flatMap((s) => [
      s.release.id,
      ...s.release.prefabs,
      ...s.bundle.entries.map((e) => e.id),
    ]),
    ...resident.entries.map((e) => e.id),
  ];
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
      entries: resident.entries.map((e) => e.id),
      bytes: resident.bytes,
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
