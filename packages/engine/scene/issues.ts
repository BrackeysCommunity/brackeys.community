import { acceptedTimingsWords, type SwapTiming } from "../game/live";
import type { AssetId } from "../project/types";
import type { MigrationRefusal } from "./migrate";
import {
  PARENT_MAX_DEPTH,
  type EngineIssueCode,
  type IssueCode,
  type IssueCodeInfo,
  type SceneIssue,
} from "./types";

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
  "behavior-conflict": {
    severity: "error",
    summary:
      "An entity carries two behaviors that can't share it, such as both character controllers. As a warning: a `path-follow` that can't move all of its entity, whose collider has no body or a static one, or whose type's own system places it (solid, prop, follower, sensor).",
    hint: "Unset one of the two blocks with update; keep the one whose movement the entity should have. For a path-follow warning, give the collider a kinematic body, or move it some other way.",
    fixable: false,
  },
  "character-body-kind": {
    severity: "error",
    summary:
      "A character behavior is on an entity whose body is dynamic: the controller and the physics solver would both move it.",
    hint: 'Set the body\'s `kind` to "kinematic" (the fix does), or unset the body block; a character needs no body of its own.',
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
      'An entity needs physics (its type requires it, or it carries a dynamic `body` or a `joint`), but the scene\'s resolved physics is `"none"`.',
    hint: "Set `settings.physics` to `\"rapier\"` (or drop it so the project's or game's default applies), or remove the entity, make its `body` kinematic, or remove its `joint`.",
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
  "nav-missing": {
    severity: "warn",
    summary: "An entity carries `nav-agent`, but the scene has no walk area for it to walk.",
    hint: "Add a `nav` entity (mode walk) covering where the agent should go, or unset the agent's nav-agent block.",
    fixable: false,
  },
  "joint-ref-type": {
    severity: "error",
    summary:
      "A joint's `to` names an entity with no body to hold: no `body` or `collider` block and not a solid, prop or follower, or only a sensor.",
    hint: "Point `to` at an entity with a body or a collider that isn't a sensor, or give that entity a `collider` block.",
    fixable: false,
  },
  "joint-self": {
    severity: "error",
    summary: "A joint's `to` names the entity that carries it.",
    hint: "Point `to` at the other entity the joint links to.",
    fixable: false,
  },
  "parent-depth": {
    severity: "error",
    summary: `An entity sits more than ${PARENT_MAX_DEPTH} \`parent\` levels below its root.`,
    hint: `Reparent part of the chain higher up, so no entity is more than ${PARENT_MAX_DEPTH} levels deep.`,
    fixable: true,
  },
  "parent-type": {
    severity: "error",
    summary:
      "A `parent` link names or sits on something that can't be in the tree: a nav area, a camera region, a note or a bulk entry.",
    hint: "Parent the entity to a node, an instance or another entity that has a pose, or remove its `parent`; promote a bulk entry to an entity first.",
    fixable: true,
  },
  "quarter-turn-only": {
    severity: "error",
    summary:
      "A side or grid field sits under a parent turned by an angle that isn't a whole quarter turn, and a side or a grid's cells can only turn by quarters.",
    hint: "Turn the parent by a multiple of 90°, or move the entity out from under it with a reparent.",
    fixable: true,
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
  "anim-tag-unknown": {
    severity: "error",
    summary: "An animation clip names a tag its atlas doesn't have.",
    hint: "Use one of the atlas's tags (the message suggests the closest); `vp run scene assets info <atlas>` lists them.",
    fixable: false,
  },
  "anim-clip-unknown": {
    severity: "error",
    summary:
      "A clip's `next`, an `anim` block's `clip` or a `ctx.anim.play` names a clip the animation doesn't have.",
    hint: "Name one of the animation's clips (the message suggests the closest), or add the clip.",
    fixable: false,
  },
  "anim-atlas-mismatch": {
    severity: "error",
    summary:
      "An `anim` entity's sprite draws an asset that lacks frames its source plays, so they don't show.",
    hint: "Set the sprite's `asset` to the source's atlas (the message names it), or play a source over the sprite's atlas.",
    fixable: false,
  },
  "frame-shape-invalid": {
    severity: "error",
    summary:
      "An animation frame's shape set has a shape that doesn't parse, or a set name that isn't lowercase with dashes.",
    hint: "Give a shape tuple, in a set named like `hit` or `hurt-high`.",
    fixable: false,
  },
  "tween-target-invalid": {
    severity: "error",
    summary:
      "A tween moves an entity whose type can't be posed, or animates a sprite channel on an entity without a sprite.",
    hint: "Tween a marker, decor, solid or sensor; visual channels need a `sprite`.",
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
  "body-missing": {
    severity: "error",
    summary: "`ctx.bodies` was asked about an entity id that has no body.",
    hint: "Give the entity a `body` and `collider`, or use a type that owns a body (prop, follower); check `ctx.bodies.has(id)` before moving one that may have none.",
    fixable: false,
  },
  "body-not-dynamic": {
    severity: "error",
    summary:
      "A `ctx.bodies` write went to a body that doesn't take it: a force, torque or impulse to a kinematic or static body, a velocity to a static body or a follower (its path sets it), or an angular velocity to a kinematic body.",
    hint: 'Check `ctx.bodies.kind(id)` first. Push only a dynamic body (set its `kind` to "dynamic"); move a kinematic body with `setVelocity`, a follower through its path, and a static one not at all.',
    fixable: false,
  },
  "entity-gone": {
    severity: "error",
    summary:
      "An entity handle was used after its entity was destroyed; only its `id` and `alive` still answer.",
    hint: "Check `entity.alive` before using a handle you kept across ticks, or look the entity up again with `ctx.entity(id)`.",
    fixable: false,
  },
  "pose-not-settable": {
    severity: "error",
    summary:
      "`ctx.setPose` was asked to move an entity whose type nothing can pose: a follower (its path owns its pose), a nav area, a camera region, or a game type whose system has no `setPose`.",
    hint: "Move a follower through its path, and give a game type's system a `setPose` (or build it on `createDataSystem`) before moving its entities.",
    fixable: false,
  },
  "parent-cycle": {
    severity: "error",
    summary:
      "An entity is under itself: its `parent` chain comes back round, or a reparent would put it under one of its own descendants. A file read with a cycle treats the entity whose id sorts last as a root.",
    hint: "Reparent one entity of the loop to a parent outside it (or to the root with `parent: null`), or pick a parent outside the entity's subtree.",
    fixable: true,
  },
  "parent-scope": {
    severity: "error",
    summary:
      "An entity was given a parent it can't have: one that isn't live, or one in another sublevel.",
    hint: "Parent an entity only to a live entity of its own scene or sublevel.",
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
  "save-forbidden": {
    severity: "error",
    summary: "The host refused this save.",
    hint: "Sign in, or check where this game saves.",
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
  "live-incompatible": {
    severity: "error",
    summary:
      "A scene version was made for another build of the game, another scene format, or another game or configuration than the release it would go live on. `detail.rule` names which: `build`, `formats` or `game`.",
    hint: "Publish it again from the build the release was made from, or publish a release.",
    fixable: false,
  },
  "live-scene-unlisted": {
    severity: "error",
    summary:
      "A scene version replaces a scene the release's scene list doesn't hold, or holds with another sublevel flag, so it can't be updated live.",
    hint: "New scenes need a release: add it to the scene list and publish one.",
    fixable: false,
  },
  "live-physics": {
    severity: "error",
    summary: "A scene version needs physics, and the release was built without it.",
    hint: "Publish a release so the build includes physics.",
    fixable: false,
  },
  "live-asset-conflict": {
    severity: "error",
    summary:
      "A scene version carries a changed asset that the release ships under the same id: only the scene and its prefabs may change live.",
    hint: "Shared assets change with a release. Keep the old asset under its id and add the new one under a new id, or publish a release.",
    fixable: false,
  },
  "live-swap-failed": {
    severity: "error",
    summary:
      "A new version of a scene couldn't be staged or applied while playing; `detail.phase` names the step. Staging failed (`stage`): the scene keeps the version it runs. A swap step refused (`swap`) or the game's `onSwap` threw (`onSwap`): the old version keeps running and the new one loads next time. The swap applied, then a step or the game's live check threw (`after`).",
    hint: "The issue's own hint is the onSwap error or the step that refused.",
    fixable: false,
  },
  "live-timing-unsupported": {
    severity: "warn",
    summary:
      "A scene version was moved with a timing the game doesn't declare, so it reaches players at the strongest timing the game accepts.",
    hint: "Declare more timings in GameDefinition.live.timings.",
    fixable: false,
  },
  "scene-version-removed": {
    severity: "error",
    summary:
      "A replay needs a scene version that is gone: the segment's `sceneVersion` (the replay doesn't start), or a swap's (it replays to `detail.tick` and stops).",
    hint: "Scene versions are removed some days after publishing unless a channel points at them; a recording replays only while the versions it names are kept.",
    fixable: false,
  },
};

/**
 * The facts a live-level issue's wording needs. A version is named as its
 * scene and number (`level-1@4`) and a release as its version (`v7`);
 * the caller formats both, since only the host knows the numbers.
 */
export type LiveIssueInput =
  | { code: "live-incompatible"; rule: "build"; version: string; release: string }
  | {
      code: "live-incompatible";
      rule: "formats";
      version: string;
      release: string;
      /** The scene format the version uses, and the one the release reads. */
      format: number;
      reads: number;
    }
  | { code: "live-incompatible"; rule: "game"; version: string }
  | { code: "live-scene-unlisted"; release: string; scene: AssetId }
  | { code: "live-physics"; release: string; scene: AssetId }
  | { code: "live-asset-conflict"; scene: AssetId; asset: string }
  | {
      code: "live-swap-failed";
      scene: AssetId;
      /** The onSwap error or the step that refused: the issue's hint. */
      cause: string;
      phase?: LiveSwapPhase;
      /** `reload` when the swap needs a reload; `refused` when a reconcile step refused. */
      reason?: "reload" | "refused";
      /** The entity whose step refused. */
      entityId?: string;
    }
  | { code: "live-timing-unsupported"; version: string; accepted: readonly SwapTiming[] }
  | {
      code: "scene-version-removed";
      version: string;
      /** When it was removed, as the host shows dates. */
      removedOn?: string;
      /** The swap's tick, for a version a swap needed. */
      tick?: number;
      /** The host's retention rule, when it states one. */
      kept?: { newest: number; days: number };
    };

/**
 * Where a live update failed: staging it, a swap step, the game's `onSwap`,
 * or after the swap applied (a step or the game's live check threw).
 */
export type LiveSwapPhase = "stage" | "swap" | "onSwap" | "after";

/**
 * A failed staging keeps the version the scene runs; a failed swap step
 * has already made the new version the one the scene's next load uses.
 * Without a phase nothing is promised.
 */
function swapFailedMessage(scene: AssetId, phase: LiveSwapPhase | undefined): string {
  if (phase === "stage")
    return `The update to ${scene} couldn't be staged; the scene keeps the version it runs.`;
  if (phase === "after")
    return `The update to ${scene} applied, but the game failed right after it.`;
  if (phase === undefined) return `The update to ${scene} couldn't be applied while playing.`;
  return `The update to ${scene} couldn't be applied while playing; it will load next time.`;
}

/** A live-level issue with its message and hint worded and its values filled in. */
export function liveIssue(input: LiveIssueInput): SceneIssue {
  switch (input.code) {
    case "live-incompatible": {
      const detail = { rule: input.rule };
      if (input.rule === "build")
        return makeIssue(input.code, {
          message: `${input.version} was made for another build of the game: its entity types or data kinds differ from ${input.release}'s.`,
          hint: `Publish it again from the build ${input.release} was made from, or publish a release.`,
          detail,
        });
      if (input.rule === "formats")
        return makeIssue(input.code, {
          message: `${input.version} uses scene format ${input.format}; ${input.release} reads format ${input.reads}.`,
          hint: "Publish a release made with the newer engine.",
          detail,
        });
      // No hint: the code's default is the build rule's, which would mislead here.
      const { hint: _, ...issue } = makeIssue(input.code, {
        message: `${input.version} belongs to another game or game configuration.`,
        detail,
      });
      return issue;
    }
    case "live-scene-unlisted":
      return makeIssue(input.code, {
        message: `${input.release} doesn't list the scene ${input.scene}, so it can't be updated live.`,
        entityIds: [input.scene],
      });
    case "live-physics":
      return makeIssue(input.code, {
        message: `${input.scene} now needs physics, and ${input.release} was built without it.`,
        entityIds: [input.scene],
      });
    case "live-asset-conflict":
      return makeIssue(input.code, {
        message: `${input.scene} uses a changed ${input.asset} that other scenes share.`,
        entityIds: [input.scene],
      });
    case "live-swap-failed":
      return makeIssue(input.code, {
        message: swapFailedMessage(input.scene, input.phase),
        hint: input.cause,
        entityIds: [input.scene],
        ...(input.phase || input.reason || input.entityId !== undefined
          ? {
              detail: {
                ...(input.phase ? { phase: input.phase } : {}),
                ...(input.reason ? { reason: input.reason } : {}),
                ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
              },
            }
          : {}),
      });
    case "live-timing-unsupported":
      return makeIssue(input.code, {
        message: `This game accepts ${acceptedTimingsWords({ timings: input.accepted })}; ${input.version} will reach players then.`,
      });
    case "scene-version-removed":
      return makeIssue(input.code, {
        message: `This replay needs ${input.version}, which was removed${input.removedOn ? ` on ${input.removedOn}` : ""}.`,
        ...(input.kept
          ? {
              hint: `Scene versions outside a scene's ${input.kept.newest} newest are removed ${input.kept.days} days after publishing unless a channel points at them.`,
            }
          : {}),
        ...(input.tick !== undefined ? { detail: { tick: input.tick } } : {}),
      });
  }
}

/** Why `id` can't go under `parent`: `parent` is `id` itself or sits below it. */
export const parentCycleMessage = (id: string, parent: string): string =>
  parent === id
    ? `${id} can't be its own parent.`
    : `${parent} is under ${id}, so putting ${id} under it would make a loop.`;

/** A thrown value as message text: an `Error`'s message, else the value as a string. */
export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const isErrorIssue = (issue: SceneIssue): boolean => issue.severity === "error";

export const firstError = (issues: readonly SceneIssue[]): SceneIssue | undefined =>
  issues.find(isErrorIssue);

/** The issue that stands for `issues`: the first error, else the first issue. */
export const leadIssue = (issues: readonly SceneIssue[]): SceneIssue | undefined =>
  firstError(issues) ?? issues[0];

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
