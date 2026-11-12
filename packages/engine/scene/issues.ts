import type { MigrationRefusal } from "./migrate";
import type { EngineIssueCode, IssueCode, IssueCodeInfo, SceneIssue } from "./types";

export type { IssueCodeInfo } from "./types";

/**
 * Every code the engine reports; a game's own `<game-id>/<code>` codes sit
 * beside them in `registry.issueCodes`. Codes, severities and the `fixable`
 * flag are public contract: renaming or removing one is a breaking change.
 */
export const ISSUE_CODES: Readonly<Record<EngineIssueCode, IssueCodeInfo>> = {
  schema: {
    severity: "error",
    summary: "The document doesn't match the scene schema, isn't valid JSON, or has a bad `v`.",
    hint: "Fix the value at `path`; `expected` and `got` say what the schema wants. Print the schema with `vp run scene schema scene`.",
    fixable: false,
  },
  "unknown-key": {
    severity: "error",
    summary: "A key the schema doesn't define.",
    hint: "Rename it to the suggested key, or remove it. Bulk keys are a registered type's name, or `<type>:<material>` for a type with material bulk keys.",
    fixable: false,
  },
  "unknown-type": {
    severity: "error",
    summary: "An entity's `type` isn't registered, or the entity has no `type`.",
    hint: "Use one of the registered types; a game's own types need the scene's top-level `game` key.",
    fixable: false,
  },
  "unknown-game": {
    severity: "error",
    summary: "The scene names a game this tool has no registry for.",
    hint: "Open the scene with that game's tools, or remove `game` to use engine primitives only.",
    fixable: false,
  },
  "bad-shape": {
    severity: "error",
    summary:
      "A shape tuple with an unknown tag, the wrong number of values, or a non-positive size.",
    hint: 'Write the tuple in its documented form, e.g. ["box", cx, cy, hw, hh] with hw and hh > 0.',
    fixable: false,
  },
  "bad-id": {
    severity: "error",
    summary: "An id that doesn't match ^[a-z0-9][a-z0-9-]{0,47}$.",
    hint: "Use lowercase letters, digits and '-', starting with a letter or digit, at most 48 characters.",
    fixable: false,
  },
  "version-newer": {
    severity: "error",
    summary: "The scene was written by a newer engine than this one.",
    hint: "Upgrade the engine; a newer file is never truncated or downgraded.",
    fixable: false,
  },
  "migration-unresolved": {
    severity: "error",
    summary:
      "A migration step can't run without the game's registry or the prefabs the file names.",
    hint: "The v3 → v4 step needs the game's registry and the prefabs this file names; migrate it with its project: `vp run scene fmt`, or `project pull`, `fmt` and `push` for a hosted project.",
    fixable: false,
  },
  "dup-id": {
    severity: "error",
    summary: "Two entities share an id.",
    hint: "Give the later entity a new id, e.g. by appending -2.",
    fixable: false,
  },
  "dangling-ref": {
    severity: "error",
    summary: "A reference names an id that doesn't exist.",
    hint: "Point the reference at an existing id, or remove it.",
    fixable: true,
  },
  "ref-type": {
    severity: "error",
    summary: "A reference targets an entity of a type it can't target.",
    hint: "Point the reference at an entity of an allowed type, or remove it.",
    fixable: true,
  },
  "poly-invalid": {
    severity: "error",
    summary: "A poly that is non-convex, self-intersecting or has zero area.",
    hint: "Make the points convex, split it into convex polys, or use a chain where the field allows one.",
    fixable: true,
  },
  "chain-invalid": {
    severity: "error",
    summary: "A chain with a zero-length segment.",
    hint: "Remove the repeated point.",
    fixable: true,
  },
  "path-invalid": {
    severity: "error",
    summary: "A path with fewer than 2 points or a speed that isn't positive.",
    hint: "Give the path at least two distinct points and a speed > 0 (m/s).",
    fixable: false,
  },
  "prefab-unknown": {
    severity: "error",
    summary: "An instance names a prefab that doesn't exist.",
    hint: "Name an existing prefab, or remove the instance.",
    fixable: false,
  },
  "path-degenerate": {
    severity: "warn",
    summary: "A path repeats a point, which the runtime skips.",
    hint: "Drop the repeated point.",
    fixable: true,
  },
  "non-integer": {
    severity: "warn",
    summary:
      "A length isn't a whole number of world pixels at the game's px per metre, or an angle isn't whole degrees.",
    hint: "Snap it to whole pixels (the fix does): scene lengths are metres that land on whole world px.",
    fixable: true,
  },
  "out-of-bounds": {
    severity: "warn",
    summary: "Something lies outside the scene's bounds, where the camera can't reach.",
    hint: "Move it inside `bounds`, or grow `bounds` with a setScene op.",
    fixable: true,
  },
  "hidden-layer": {
    severity: "info",
    summary: "An entity sits on a layer that is hidden.",
    hint: "Show the layer, or move the entity to a visible one.",
    fixable: false,
  },
  "unused-override": {
    severity: "warn",
    summary: "A prefab override names no child of the prefab, or no field that child can have.",
    hint: "Drop the override with revertOverride, or fix its key: `<childId>.<field.path>`.",
    fixable: true,
  },
  "prefab-cycle": {
    severity: "error",
    summary: "A prefab contains itself through instances or variant bases.",
    hint: "Remove the instance or change the variant base that closes the loop; `message` names the chain.",
    fixable: false,
  },
  "prefab-depth": {
    severity: "error",
    summary: "Prefabs nest deeper than 8 levels.",
    hint: "Unpack an inner instance, or flatten a variant chain, until the chain is at most 8 prefabs deep.",
    fixable: false,
  },
  "variant-base-unknown": {
    severity: "error",
    summary: "A variant's base isn't a prefab in the project.",
    hint: "Point the variant at an existing prefab with setPrefabBase (the message suggests the closest id), or clear its base.",
    fixable: true,
  },
  "param-unknown": {
    severity: "error",
    summary: "An instance sets a parameter its prefab doesn't expose.",
    hint: "Clear it with setParam and a null value, or expose the parameter on the prefab with exposeParam.",
    fixable: true,
  },
  "layer-unknown": {
    severity: "error",
    summary: "An entity or instance names a layer the registry doesn't have.",
    hint: "Use one of the registry's layers, or unset `layer` with update to fall back to the type's default.",
    fixable: true,
  },
  "behavior-unknown": {
    severity: "error",
    summary: "An entity carries a behavior that isn't registered.",
    hint: "Rename the block to a registered behavior (the message suggests the closest), or unset it with update.",
    fixable: true,
  },
  "behavior-forbidden": {
    severity: "error",
    summary: "An entity's type doesn't allow this behavior.",
    hint: "Unset the block with update; `vp run scene schema scene` lists the behaviors each type allows.",
    fixable: true,
  },
  "behavior-missing": {
    severity: "error",
    summary: "A behavior's `requires` isn't on the same entity.",
    hint: "Add the required behavior's block (an empty block takes its defaults), or remove the behavior that needs it.",
    fixable: true,
  },
  "grid-invalid": {
    severity: "error",
    summary: "A grid setting, grid value or grid placement is invalid.",
    hint: "Fix the value at `path`: cells, hex sides and origins are whole px at the game's px per metre, written in metres, rows follow the run-length grammar, and only square cells turn or flip. `vp run scene fmt` rewrites rows canonically.",
    fixable: false,
  },
  "ref-child-unknown": {
    severity: "error",
    summary: "A child ref names an instance whose prefab has no such child.",
    hint: "Point the reference at a child the prefab has (the message suggests the closest), or remove it.",
    fixable: true,
  },
  "physics-required": {
    severity: "error",
    summary:
      'An entity needs physics (its type requires it, or it rides a follower with `attach`), but the scene\'s resolved physics is `"none"`.',
    hint: "Set `settings.physics` to `\"rapier\"` (or drop it so the project's or game's default applies), or remove the entity or its `attach`.",
    fixable: true,
  },
  "physics-skipped": {
    severity: "info",
    summary:
      "A game's physical check that needs physics was skipped because the scene runs without it.",
    hint: 'Set `settings.physics` to `"rapier"` to run it, or leave it skipped.',
    fixable: false,
  },
  "nav-invalid": {
    severity: "error",
    summary:
      "A nav polygon intersects itself, a block polygon isn't inside exactly one walk area, or two walk areas overlap.",
    hint: "Redraw the polygon without crossings, move the block inside one walk area, or inset the walk areas so they only share edges.",
    fixable: false,
  },
  "follower-hits-solid": {
    severity: "warn",
    summary: "A path follower, or a solid riding it, swept along the path, runs into a solid.",
    hint: "Move the path or the solid so the follower's shape clears it along every segment, the loop's closing one included.",
    fixable: false,
  },
  "solid-overlap": {
    severity: "info",
    summary: "Two static solids overlap; they may be one shape drawn twice or mergeable.",
    hint: "Merge them into one shape, or move one so they only touch.",
    fixable: false,
  },
  "grid-unreachable": {
    severity: "error",
    summary: "A `connected` check's target has no path from its start on the scene's grid.",
    hint: "Open a gap in the walls between them, move the target, or allow `diagonals`; `vp run scene grid` prints the grid and the path.",
    fixable: false,
  },
  "stale-base": {
    severity: "error",
    summary:
      "A batch's `base` hash doesn't match the current scene, so its bulk references may point at other entries.",
    hint: "Re-read the scene and retry against the returned hash, or promote the bulk entry to an id so the reference stays stable.",
    fixable: false,
  },
  "ref-not-found": {
    severity: "error",
    summary: "An op refers to an id or bulk entry that doesn't exist.",
    hint: "Re-read the scene for the current ids and `~key:index` references.",
    fixable: false,
  },
  "op-invalid": {
    severity: "error",
    summary: "An op is malformed, or applying it would leave an entity that fails the schema.",
    hint: "Check the op against `vp run scene schema ops` and the entity against `vp run scene schema scene`.",
    fixable: false,
  },
  "id-taken": {
    severity: "error",
    summary: "An op would create or rename to an id that is already in use.",
    hint: "Pick an unused id, or omit it on add to get a generated one.",
    fixable: false,
  },
  "asset-missing": {
    severity: "error",
    summary: "A reference names an asset the project has no live asset for.",
    hint: "Point it at an existing asset (the message suggests the closest id), restore the asset from the trash, or remove the reference.",
    fixable: false,
  },
  "asset-kind": {
    severity: "error",
    summary:
      "An asset's kind isn't registered, doesn't fit the file's extension or the op, or a one-per-project kind has a second asset.",
    hint: "Use a kind the project registers, with a path whose extension that kind matches; an immutable kind (recordings) can't take new content.",
    fixable: false,
  },
  "asset-frame-unknown": {
    severity: "error",
    summary: "A sprite names a frame its atlas doesn't have, or names an atlas without a frame.",
    hint: "Set `frame` to one of the atlas's frames (the message suggests the closest); `vp run scene assets info <atlas>` lists them.",
    fixable: false,
  },
  "sprite-no-asset": {
    severity: "warn",
    summary: "A sprite has no `asset`, so only its fallback box draws.",
    hint: "Set `asset`; until then only the box draws.",
    fixable: false,
  },
  "tick-rate-invalid": {
    severity: "error",
    summary: "A tick rate the clock can't run: it must be an integer from 1 to 240.",
    hint: "Set `engine.tickRate` (or the game's `time.rate`) to an integer from 1 to 240; 60 is the default.",
    fixable: false,
  },
  "asset-in-use": {
    severity: "error",
    summary: "An asset can't be deleted while other assets reference it.",
    hint: "Remove or repoint the references `detail.referrers` lists, or delete with `force` and fix them after.",
    fixable: false,
  },
  "asset-id-taken": {
    severity: "error",
    summary: "Two live assets share an id.",
    hint: "Rename the later one with changeAssetId; the project's server appends -2 until then.",
    fixable: false,
  },
  "path-taken": {
    severity: "error",
    summary: "Two live assets share a path, or paths that differ only in case.",
    hint: "Move or rename one of them; the project's server suffixes the later one's file name until then.",
    fixable: false,
  },
  "hash-mismatch": {
    severity: "error",
    summary:
      "Bytes don't match the content hash claimed for them, or an op names a hash the content store doesn't hold.",
    hint: "Upload the bytes to the content store first and use the hash it returns.",
    fixable: false,
  },
  "code-skew": {
    severity: "warn",
    summary:
      "A newer build of the game's code changed this kind's schema, so this client can only read docs of that kind.",
    hint: "Reload with the newer build to edit again.",
    fixable: false,
  },
  "asset-too-large": {
    severity: "error",
    summary: "An asset is larger than its kind allows.",
    hint: "Shrink the file, or split it into several assets.",
    fixable: false,
  },
  "import-failed": {
    severity: "error",
    summary:
      "An imported file couldn't be read as its kind: its header or JSON isn't what the kind expects.",
    hint: "Re-export the file from its tool, or import it as another kind.",
    fixable: false,
  },
  "quota-exceeded": {
    severity: "error",
    summary:
      "The project is out of room for what the op adds. `detail.limit` names the quota (a hosted project's are assetBytes, docs, docBytes, releaseBytes, releaseFiles, releaseFileBytes, releaseStorageBytes, jamPins and releasesPerDay), with `used` and `max`.",
    hint: "The message names the limit; empty the trash or remove unused assets, then retry.",
    fixable: false,
  },
  "project-id-taken": {
    severity: "error",
    summary:
      "A new project's id is already a discovered project's, or its directory already exists.",
    hint: "Pick another id, or remove the existing project's directory.",
    fixable: false,
  },
  "asset-not-trashed": {
    severity: "error",
    summary: "Only a trashed asset can be deleted for good, and this one isn't in the trash.",
    hint: "Trash it with deleteAsset first; a purge can't be undone, so check nothing still needs it.",
    fixable: false,
  },
  "release-immutable": {
    severity: "error",
    summary: "The change would alter a published release, or acts on one whose files were removed.",
    hint: "Publish a new version instead; a removed release keeps its record but not its files.",
    fixable: false,
  },
  "release-forbidden": {
    severity: "error",
    summary:
      "The caller may not do this to the release: their role, an agent token on production, a hidden release, or a site that doesn't host games.",
    hint: "Ask one of the game's publishers, or move production by a person on the game's page.",
    fixable: false,
  },
  "binding-unknown": {
    severity: "error",
    summary:
      "A binding names an action, key code, pad button or axis, pointer button or touch control that doesn't exist, or doesn't fit its action's kind.",
    hint: "Use a `KeyboardEvent.code`, a standard pad button or axis, a pointer button, or a declared touch control, fitting the action's kind.",
    fixable: false,
  },
  "player-unknown": {
    severity: "error",
    summary: "A binding's seat or a seats declaration is past the seats there are.",
    hint: "Seats are 0 to `players.max` − 1, at most 8.",
    fixable: false,
  },
  "spawn-id-invalid": {
    severity: "error",
    summary:
      "A runtime spawn or instantiate id isn't `<name>#<label>` for its type or prefab, has an all-digit label, or is already live.",
    hint: "Omit `id` to get the next `<name>#<n>`, or pass `<name>#<word>` with a label that isn't all digits and isn't live.",
    fixable: false,
  },
  "prefab-not-spawnable": {
    severity: "error",
    summary:
      "`ctx.instantiate` can't place a prefab: it isn't in the run's library, its nesting is cyclic or too deep, or a child needs physics in a scene without it.",
    hint: "Read the error's `cause` (its `code`: prefab-unknown, prefab-cycle, prefab-depth, physics-required or unknown-type) and fix the prefab, the library the host passes, or the scene's physics.",
    fixable: false,
  },
  "recording-other-platform": {
    severity: "warn",
    summary:
      "A Rapier recording is replayed on a different CPU architecture than the one that recorded it, so it may not replay bit for bit.",
    hint: "Rapier replays are only guaranteed on the platform that recorded them.",
    fixable: false,
  },
  "scene-unlisted": {
    severity: "warn",
    summary:
      "Flow names a scene the project's scene list doesn't hold: a listed scene's `connected` or `reaches` check, a sublevel attach in an input script, or an export. A runtime `go` to one is refused as an error.",
    hint: "Add the scene to scene-list.json through `vp run scene assets apply`, or name a listed scene; `vp run scene flow` prints the list.",
    fixable: false,
  },
  "start-scene-missing": {
    severity: "error",
    summary:
      "The project has no scene list, or its `start` is null, names no scene, or names a scene that isn't listed or is a sublevel, so nothing plays through flow.",
    hint: "Set `start` in scene-list.json to a listed scene that isn't a sublevel.",
    fixable: false,
  },
  "sublevel-invalid": {
    severity: "error",
    summary:
      "A sublevel can't attach: it isn't listed, its physics, grid or gravity differs from the main scene's, `at` isn't on a cell boundary, or its label is taken or malformed.",
    hint: "Read `detail.reason` (unlisted, physics, grid, label or settings): list the scene, match the main scene's physics, grid and gravity, put `at` on a whole number of cells, and pick a free id-pattern label.",
    fixable: false,
  },
  "save-version-newer": {
    severity: "error",
    summary:
      "A save's game version is newer than this build's `saves.version`, or a migration step between its version and the game's is missing.",
    hint: "Load it with the build that wrote it, or add the missing step to `saves.migrations` (each key migrates from that version to the next).",
    fixable: false,
  },
  "save-too-large": {
    severity: "error",
    summary: "A save is bigger than the game's save limit, so it wasn't written.",
    hint: "Save less state in snapshot(), or raise `saves.limits.maxBytes` (the browser's stores cap at 1 MiB); your own save backend is the path for more.",
    fixable: false,
  },
  "save-slot-limit": {
    severity: "error",
    summary:
      "A save to a new slot would pass the game's slot limit, so it wasn't written; overwriting a slot never is.",
    hint: "Delete a slot or overwrite one; `saves.limits.maxSlots` raises the limit (the browser's stores cap at 64).",
    fixable: false,
  },
  "save-unsupported": {
    severity: "error",
    summary:
      "A world save can't be taken: the scene runs on Rapier, a function timer or coroutine is pending, or the game has no `restore`. `detail` names each cause.",
    hint: "Take a progress save instead, or for a world save run without physics, use emit-form timers and give the game's runtime `restore`.",
    fixable: false,
  },
  "save-store-failed": {
    severity: "warn",
    summary: "The save store threw or refused a read or a write.",
    hint: "Read the store's `describe`: browser storage may be full, blocked or private. The game keeps running; try the save again or use another store.",
    fixable: false,
  },
  "export-asset-missing": {
    severity: "error",
    summary:
      "A file a build or its manifest names isn't there, or an export icon isn't a PNG of its stated size (raised as a warning: the default icon ships instead).",
    hint: "Rebuild with `vp run scene game build`; for an icon, point `export.icons` at a texture of exactly 192×192 or 512×512 PNG, or drop it to use the default.",
    fixable: false,
  },
  "export-over-budget": {
    severity: "error",
    summary:
      "A build is over one of its size budgets: code, first load, total or one file. The build still writes.",
    hint: "Shrink the largest contributors the message names, raise the budget in the project file's `export.budget`, or build with `--allow-over-budget`.",
    fixable: false,
  },
  "export-itch-layout": {
    severity: "error",
    summary:
      "An itch.io build breaks itch.io's HTML5 layout: too many files, too large, a long path, no index.html at the root, or a dotfile.",
    hint: "Remove or shrink what the message names; `index.html` must sit at the zip's root with no `__MACOSX` folder or dotfiles.",
    fixable: false,
  },
  "export-target-unsupported": {
    severity: "error",
    summary: "A build names a target this engine version doesn't build.",
    hint: "Build one of the targets the message lists (`--target`).",
    fixable: false,
  },
  "licence-missing": {
    severity: "warn",
    summary:
      "An exported asset has no licence recorded; it ships, and the credits page lists it under no licence recorded.",
    hint: "Record the asset's licence with a `setLicence` project op (`vp run scene assets apply`): its SPDX id, author, source and attribution line.",
    fixable: false,
  },
};

/**
 * A `SceneIssue` with the code's severity and hint filled in. A game's codes
 * are looked up in `codes`, which is `registry.issueCodes` for them.
 */
export function makeIssue(
  code: IssueCode,
  fields: Partial<Omit<SceneIssue, "code">> & { message: string },
  codes: Readonly<Record<string, IssueCodeInfo>> = ISSUE_CODES,
): SceneIssue {
  const info = codes[code];
  if (!info) throw new Error(`makeIssue: unknown issue code "${code}"`);
  return {
    ...fields,
    severity: fields.severity ?? info.severity,
    code,
    message: fields.message,
    entityIds: fields.entityIds ?? [],
    hint: fields.hint ?? info.hint,
  };
}

function escapeSegment(segment: string | number): string {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

/** RFC 6901 pointer from path segments; `[]` is the root, `""`. */
export function jsonPointer(segments: readonly (string | number)[]): string {
  return segments.map((s) => `/${escapeSegment(s)}`).join("");
}

export function pointerSegments(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** The line of `pointer`, or of its nearest ancestor that has one. */
export function lineAt(lines: ReadonlyMap<string, number>, pointer: string): number | undefined {
  let p = pointer;
  for (;;) {
    const line = lines.get(p);
    if (line !== undefined) return line;
    if (p === "") return undefined;
    p = p.slice(0, p.lastIndexOf("/"));
  }
}

/**
 * The refusal of a step that moves a px file to metres without the game's
 * registry, which alone knows its px per metre and its fields' units.
 */
export function unitsRefusal(what: string): MigrationRefusal {
  return {
    refused: makeIssue("migration-unresolved", {
      message: `the ${what} file is in px; moving it to metres needs the game's registry`,
      path: "/v",
    }),
  };
}
