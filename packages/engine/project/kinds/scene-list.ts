import { z } from "zod";

import { flowIssue } from "../../game/flow";
import { jsonPointer, makeIssue } from "../../scene/issues";
import type { SceneIssue } from "../../scene/types";
import type { RefSite } from "../refs";
import type { AssetEntry, AssetId, AssetPath, ProjectView } from "../types";
import { checksBeside } from "./checks";
import {
  defineAssetKind,
  folderOf,
  isPlainObject,
  perProjectEntries,
  type KindEnv,
} from "./define";

export const SCENE_LIST_KIND = "scene-list";
export const SCENE_LIST_VERSION = 1;
export const SCENE_LIST_SCHEMA_ID = `urn:jams-engine:scene-list:v${SCENE_LIST_VERSION}`;

const SCENE_KIND = "scene";

/** One listed scene; a sublevel attaches beside a main scene and is never one itself. */
export type SceneListEntry = { scene: AssetId; title?: string; sublevel?: true };

/** The project's scene list: the scene a game starts in and every scene flow may load. */
export type SceneListFile = {
  $schema?: string;
  kind: typeof SCENE_LIST_KIND;
  v: typeof SCENE_LIST_VERSION;
  start: AssetId | null;
  scenes: SceneListEntry[];
};

const sceneListSchema: z.ZodType<SceneListFile> = z
  .strictObject({
    $schema: z.string().optional().describe("The scene-list JSON Schema this file follows."),
    kind: z.literal(SCENE_LIST_KIND).describe('Always "scene-list".'),
    v: z.literal(SCENE_LIST_VERSION).describe("Scene-list format version."),
    start: z
      .string()
      .nullable()
      .describe("The scene a new game starts in: a listed scene that isn't a sublevel."),
    scenes: z
      .array(
        z
          .strictObject({
            scene: z.string().describe("A scene's asset id."),
            title: z.string().optional().describe("What menus and the editor's picker call it."),
            sublevel: z
              .literal(true)
              .optional()
              .describe(
                "Attached beside a main scene through `ctx.flow.attach`, never loaded alone.",
              ),
          })
          .describe("One listed scene."),
      )
      .describe(
        "Every scene flow may load or attach, in the order menus and the picker show them.",
      ),
  })
  .describe(
    "The project's scene list, at most one per project: the start scene and every scene flow may load, co-edited per entry.",
  ) as unknown as z.ZodType<SceneListFile>;

/** The start and the listed scenes, co-edited per entry and ordered like entities. */
export const sceneListKind = defineAssetKind({
  kind: SCENE_LIST_KIND,
  title: "Scene list",
  description:
    "The project's start scene and every scene flow may load or attach, with titles and sublevel tags. At most one per project.",
  match: { jsonKind: SCENE_LIST_KIND },
  defaultFolder: () => "",
  storage: "doc",
  runtime: "sim",
  perProject: 1,
  perProjectWords: { noun: "scene list", contents: "entries" },
  version: SCENE_LIST_VERSION,
  schemaId: SCENE_LIST_SCHEMA_ID,
  schema: () => sceneListSchema,
  layout: {
    as: "map",
    fields: {
      start: { as: "atomic" },
      scenes: { as: "keyed", id: "scene", item: { as: "map", rest: { as: "atomic" } } },
    },
    rest: { as: "atomic" },
  },
  limits: { maxStateBytes: 65_536, maxItems: 1_024 },
  /**
   * `start-scene-missing` from flow's rule: an error for a start that is
   * null, isn't listed or is a sublevel. A list that lists nothing (a
   * project without scenes) has nothing to start, so its null start is a
   * warning there; flow refuses to start either way. An entry naming no
   * scene is the ref index's `asset-missing`; a repeated entry is the keyed
   * layout's `dup-id`.
   */
  validate: (file: SceneListFile): SceneIssue[] => {
    const issue = flowIssue(file.scenes, file.start, "start");
    if (!issue) return [];
    const nothingListed = file.start === null && file.scenes.length === 0;
    return [{ ...issue, path: "/start", ...(nothingListed ? { severity: "warn" } : {}) }];
  },
  refs: (file: SceneListFile): RefSite[] => [
    ...(file.start === null ? [] : [{ pointer: "/start", id: file.start, kinds: [SCENE_KIND] }]),
    // By index: the site is the entry's own id field, which an "@<id>" pointer stops reaching once rewritten.
    ...file.scenes.map((entry, i) => ({
      pointer: jsonPointer(["scenes", i, "scene"]),
      id: entry.scene,
      kinds: [SCENE_KIND],
    })),
  ],
  empty: (env?: KindEnv): SceneListFile => sceneListOf(env?.project ?? null),
});

/**
 * A new scene list for `view`: every live scene by path, the first as
 * start; `{ start: null, scenes: [] }` without a view or a scene.
 */
function sceneListOf(view: ProjectView | null): SceneListFile {
  const scenes = view ? perProjectEntries(view, SCENE_KIND).map((e) => ({ scene: e.id })) : [];
  return { kind: SCENE_LIST_KIND, v: SCENE_LIST_VERSION, start: scenes[0]?.scene ?? null, scenes };
}

/** The project's live scene lists, the one in effect (first by path) first. */
export function sceneListEntries(view: ProjectView): AssetEntry[] {
  return perProjectEntries(view, SCENE_LIST_KIND);
}

/** What flow reads of a scene list: its start and its entries in order. */
export type SceneListFlow = {
  readonly start: AssetId | null;
  readonly scenes: readonly SceneListEntry[];
};

/**
 * The start and entries of a scene list's value, read leniently: an entry
 * that isn't an object naming a scene, or whose scene an earlier entry
 * lists, is left out (validation reports both), and a start that isn't a
 * string is null. `undefined` (no list) is the empty flow.
 */
export function sceneListFlow(value: unknown): SceneListFlow {
  if (!isPlainObject(value)) return { start: null, scenes: [] };
  const seen = new Set<AssetId>();
  const scenes: SceneListEntry[] = [];
  for (const raw of Array.isArray(value.scenes) ? value.scenes : []) {
    if (!isPlainObject(raw) || typeof raw.scene !== "string" || seen.has(raw.scene)) continue;
    seen.add(raw.scene);
    scenes.push({
      scene: raw.scene,
      ...(typeof raw.title === "string" ? { title: raw.title } : {}),
      ...(raw.sublevel === true ? { sublevel: true as const } : {}),
    });
  }
  return { start: typeof value.start === "string" ? value.start : null, scenes };
}

/** Where a check names a scene: a JSON Pointer into the file that holds it. */
type SceneSite = { pointer: string; scene: AssetId };

function stepScenes(steps: unknown, at: (string | number)[], out: SceneSite[]): void {
  if (!Array.isArray(steps)) return;
  steps.forEach((step, i) => {
    if (isPlainObject(step) && isPlainObject(step.until) && typeof step.until.scene === "string")
      out.push({ pointer: jsonPointer([...at, i, "until", "scene"]), scene: step.until.scene });
  });
}

/** The scenes an input script names: its own `scene` and each step's `until.scene`, on every track. */
function scriptScenes(script: unknown, at: (string | number)[]): SceneSite[] {
  if (!isPlainObject(script)) return [];
  const out: SceneSite[] = [];
  if (typeof script.scene === "string")
    out.push({ pointer: jsonPointer([...at, "scene"]), scene: script.scene });
  stepScenes(script.steps, [...at, "steps"], out);
  if (Array.isArray(script.tracks))
    script.tracks.forEach((track, t) => {
      if (isPlainObject(track)) stepScenes(track.steps, [...at, "tracks", t, "steps"], out);
    });
  return out;
}

/** `rel` against `folder`, with `.` and `..` segments resolved; null when it climbs above the root. */
function resolvePath(folder: string, rel: string): AssetPath | null {
  const parts: string[] = folder === "" ? [] : folder.split("/");
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/**
 * `scene-unlisted` (warn) for each scene a listed scene's checks name that
 * flow couldn't go to under the list in effect (unlisted, or a sublevel):
 * a `reaches` check's `expect.scene`, and its script's `scene` and steps'
 * `until.scene`, inline or in the input script its path names (relative to
 * the checks file). Each issue's `path` points into the file
 * that names the scene, `entityIds` holds that file's asset key and the scene,
 * and `detail` holds the listed scene and the check. `lineOf` gives a
 * pointer's line in an asset's text, for a host that holds the texts.
 * A second list's `asset-kind` is the project view's.
 */
export function sceneListIssues(
  view: ProjectView,
  values: ReadonlyMap<AssetId, unknown>,
  opts: { lineOf?: (asset: AssetId, pointer: string) => number | undefined } = {},
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const [listEntry] = sceneListEntries(view);
  if (!listEntry) return issues;
  const list = sceneListFlow(values.get(listEntry.id));
  for (const { scene } of list.scenes) {
    const sceneEntry = view.byId.get(scene);
    const checksEntry = sceneEntry ? checksBeside(view, sceneEntry) : undefined;
    const checks = checksEntry ? values.get(checksEntry.id) : undefined;
    if (!checksEntry || !isPlainObject(checks) || !Array.isArray(checks.checks)) continue;
    checks.checks.forEach((check, i) => {
      if (!isPlainObject(check) || check.kind !== "reaches") return;
      const id = typeof check.id === "string" ? check.id : String(i);
      const at = ["checks", i];
      const sites: { asset: AssetEntry; site: SceneSite }[] = [];
      if (isPlainObject(check.expect) && typeof check.expect.scene === "string")
        sites.push({
          asset: checksEntry,
          site: { pointer: jsonPointer([...at, "expect", "scene"]), scene: check.expect.scene },
        });
      if (typeof check.script === "string") {
        const path = resolvePath(folderOf(checksEntry.path), check.script);
        const script = path === null ? undefined : view.byPath.get(path);
        if (script)
          for (const site of scriptScenes(values.get(script.id), []))
            sites.push({ asset: script, site });
      } else
        for (const site of scriptScenes(check.script, [...at, "script"]))
          sites.push({ asset: checksEntry, site });
      for (const { asset, site } of sites) {
        const refused = flowIssue(list.scenes, site.scene, "go");
        if (!refused) continue;
        const line = opts.lineOf?.(asset.id, site.pointer);
        issues.push(
          makeIssue("scene-unlisted", {
            message: `${refused.message}: the "${id}" check of listed scene "${scene}" names it (${asset.path} at ${site.pointer})`,
            path: site.pointer,
            ...(line === undefined ? {} : { line }),
            entityIds: [asset.key, site.scene],
            got: site.scene,
            detail: { scene, check: id, list: listEntry.id },
          }),
        );
      }
    });
  }
  return issues;
}
