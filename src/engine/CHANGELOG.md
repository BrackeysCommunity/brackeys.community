# Changelog

All notable changes to `@jams/engine`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package
uses its own semver: on 0.x a breaking change bumps the minor. Besides the
usual sections, **Format** records scene format (`v`) changes and **Agent
surface** records issue codes, ops, JSON Schemas and CLI commands, all of
which are public contract.

## [0.7.0] — unreleased

Scene format v3: every format change the roadmap knows about in one bump
with one migration, so v3 is the format 1.0 freezes. Behaviors attach to
any entity, prefabs nest and have variants and exposed parameters,
instances and groups turn and flip, entities gain `z` and registry layers,
asset fields and the `assets` header reference project assets, scenes
carry `physics`, `grid` and `view` settings, and grid fields hold tile
cells. Every addition is optional with a default equal to v2's behaviour.

### Format

- Scene format v3. `SCENE_FORMAT_VERSION` is 3 and `MIGRATIONS[2]` lifts
  v2 scenes, prefabs and fragments by setting `v: 3` and nothing else;
  every v3 addition defaults to v2's behaviour, so `scene fmt` rewrites a
  v2 file by changing only `"v"`. Schema ids are `scene:v3`, `prefab:v3`,
  `fragment:v3` and `ops:v3` (and their `<game>:` forms); checks files,
  input scripts, recordings and the project kinds keep theirs. A
  recording made against a v2 file replays once with the existing `stale`
  warning, because `sceneHash` covers the canonical text (which now says
  `"v": 3`); re-recording clears it.
- `assets` on the scene and prefab header (after `settings`): the asset
  ids only game code names, sorted and unique, on one line. Dangling ids
  are `asset-missing`, duplicates `schema`.
- `settings.physics` (`"rapier"` or `"none"`, resolved `"rapier"`),
  `settings.grid` (the scene's one cell grid: `square` with `cell` and
  `origin`, or `hex` with `cell`, `side`, `stagger` and `index`, as Tiled
  parameterizes it; none by default) and
  `settings.view` (`{ projection: "orthogonal" }`, reserved).
- `rot` (1, 2 or 3 quarter turns clockwise) and `flip` (mirror x before
  turning) on instances and groups; identity when absent. Geometry stays
  integer: points, vectors, angles, mirrors, shapes and paths transform
  exactly.
- `z` on entities and instances: an integer draw order in
  [-10000, 10000], 0 by default and written as absent (by `update` and
  `setZ` alike, so both give the same file and hash); an instance's `z` is
  added to every child's.
- `params` on instances: values for the parameters the prefab exposes.
- `behaviors` on entities: behavior blocks by name, each checked by its
  behavior's fields, with the type's required and default blocks filled
  in on load.
- `layer` on entities and instances names one of the registry's layers
  (the game's, else `terrain`, `decor`, `gameplay`, `editor`); the type's
  default when absent.
- Prefab files take `instances` (nesting, at most `PREFAB_MAX_DEPTH`
  levels, no cycles), `base` (a variant of another prefab), `params`
  (`{ description, targets, default? }` per name) and `overrides` (a
  variant's overrides of its base), written in the order `$schema`,
  `kind`, `v`, `game`, `id`, `base`, `contract`, `params`, `assets`,
  `overrides`, bulk keys, `instances`, `entities`.
- Fragments take `instances`, so copying an instance pastes an instance.
- Grid fields on types that declare one (`gridField`): chunked
  run-length cells keyed `"cx,cy"`, 32×32 cells a chunk, one chunk per
  line, empty by default.
- Ref fields (`refField`, `attachField`) may name an instance's child at
  any depth (`room-1/door-1/panel`); one the prefab lacks is
  `ref-child-unknown`.
- Entity and instance keys are written `id`, `type`, `prefab`, `name`,
  `layer`, `group`, `off`, `z`, `shape`, `at`, `rot`, `flip`, `path`,
  `params`, `overrides`, the other keys by code unit, `behaviors`, then
  grid-valued keys.

### Added

- `./scene`: the v3 contract types. `SCENE_HEADER_KEYS` gains `assets`
  (after `settings`); `GroupDef` gains `rot` and `flip`; `InstanceDef`
  gains `rot`, `flip`, `z` and `params`; `GridSettings` and
  `SceneSettings.physics`, `grid` and `view`; `PrefabParam`,
  `PrefabBody.instances`, `base`, `overrides`, `params` and `assets`,
  `PREFAB_MAX_DEPTH`; `SceneFragment.instances`; `RuntimeEntity.behaviors`,
  `z`, `layer` and `transform`; `AssetId`, `CellEdit` and `CellRect`.
- `./scene`: `Transform2D`, `IDENTITY_2D`, `Dihedral` and the transform
  functions (`scene/transform.ts`); `SceneLayerDef`, `DEFAULT_LAYERS` and
  `defaultLayer` (`scene/layers.ts`); the grid codec's `GRID_CHUNK`,
  `ChunkKey`, `GridRow`, `GridCells` and functions (`scene/grid.ts`);
  `splitFieldPath` (`scene/field-path.ts`).
- `./game`: `defineBehavior`, `BehaviorDef`, `BehaviorSystem`,
  `RegisteredBehavior`, `BEHAVIOR_NAME_PATTERN` and the other behavior
  types; `GameDefinition.behaviors` and `layers`;
  `EntityTypeDef.behaviors`; `FieldEnv.assets`; `Registry.behaviors`,
  `behaviorNames`, `behaviorRules` (`BehaviorRules`) and `layers`.
- `./collab`: `LEGACY_Z_FIELD`, `LEGACY_BULK_FIELD`, `BEHAVIORS_FIELD`,
  `PARAMS_FIELD`, `NESTED2_FIELDS`, `GRID_ROW_KEY`, `ASSETS_KEY`,
  `PARAM_KEY_PREFIX` and `VARIANT_KEY`.
- `./scene` and `.` (through `math.ts`): `Transform2D`, `IDENTITY_2D`,
  `Dihedral` and `dihedral`, `compose`, `invert`, `applyPt`, `applyVec`,
  `dihedralOf`, `composeDihedral`, `flipWorld`, `translation`, `turnOf`,
  `inverseTurn` and `isIdentityTurn`. Quarter turns and flips are exact on
  integers.
- `transformEntityDef`, `transformBulkEntry` and `transformFieldValue` act
  on fields by kind: shapes, points and paths move; vectors turn and flip;
  angles gain 90° per turn and negate under a flip; mirror booleans toggle
  under a flip; grids go through `transformGrid`. Boxes and capsules turn
  by `rotDeg`, and flipped polygons and chains keep their winding. The
  translate forms are now wrappers with unchanged behavior.
- `./game`: `vectorField`, `angleField` and `mirrorField`, field builders
  whose values turn and mirror with their entity; `fieldKind` reports
  `vector`, `angle`, `mirror` and `grid` from a field's `meta.kind`.
- `./game`: `assetField(env, kinds, description)`, `AssetIdSchema` and
  `assetKindsOf`. Asset references parse as any id (a dangling one is
  reported by validation, not parsing). `DEFAULT_LAYERS` and
  `SceneLayerDef` are re-exported from `./game`.
- Entity and instance `z`: an integer draw order in [-10000, 10000] (an
  offset on instances); instance `rot`, `flip` and `params`; group `rot`
  and `flip`; the scene `assets` header.
- Scene settings `physics` (`"rapier"` | `"none"`), `grid` (square or
  Tiled-style hex) and the reserved `view: { projection: "orthogonal" }`.
  `resolveSettings(settings, { project?, game? })` (`./scene`, with
  `SettingsSources`) resolves each engine key scene → project engine block
  → game default → engine default (gravity `[0, 1200]`, rapier, no grid,
  orthogonal), and expanded scenes always carry all four.
- `./editor`: bring forward (Mod+]) and send backward (Mod+[) commands,
  one `setZ` by ±1 over the selected entities and instances (`zOrderBatch`
  in `editor/commands`). The spatial index stacks by the registry's layer
  order, then `z`, then document order. The outliner's layer view and the
  inspector's layer choice come from the registry's layers.
- `./project`: `schemaRefSites(shape, value, pointer)` finds asset
  references at every `assetField` leaf, following objects, records,
  arrays, tuples, unions and wrappers. Scene and prefab `refs` now cover
  type fields, behavior blocks, `settings`, the `assets` header (any
  kind), overrides (an instance's or a variant's own) that set an asset
  field, a whole behavior block or the whole `behaviors` map, a prefab's
  `base` and its nested instances' prefabs; `data-table` refs cover rows
  (`/rows/@<id>/…`) and `game-settings` the `game` block. `changeAssetId`
  rewrites references in a scene's settings, `assets` header, those
  overrides (each key set whole with `override`) and a prefab's `base` too.
- `toJsonSchema(schema, { layers?, assets? })` (`JsonSchemaOptions`, with
  `layerNames` on `./scene`): `layer` fields get the registry's layer names
  as `enum` in scene, prefab, fragment, ops and doc-kind schemas; an asset
  field's `enum` lists live ids only when there are some.
  `docKindJsonSchema` with a project fills them from the view; code-skew
  `schemaHashes` never carry asset ids.
- `validateScene` reports `layer-unknown` for an entity or instance whose
  `layer` isn't one of the registry's layers (did-you-mean; fix: `update`
  unsetting `layer`), `grid-invalid` for `settings.grid` values (cells
  positive integers, a hex `side` an integer in [0, cell width for stagger
  x / cell height for stagger y], origin integers), and `schema` for a
  repeated id in the `assets` header. `ValidateOptions.project` (a
  `ProjectView`): with it, an asset id in a type field, a behavior block,
  `settings` or the `assets` header that no live asset has is
  `asset-missing` (did-you-mean over the live ids of the field's kinds; a
  trashed id says so) and a live id of the wrong kind is `asset-kind`;
  without it asset ids aren't checked. `ValidateOptions.prefab` names the
  prefab the scene is a view of: a nested instance that reaches it is
  `prefab-cycle` even while the library's copy of it is stale, and its
  variant base is checked too; `applyOps` with `prefab` validates its
  result the same way. `vp run scene validate` passes the scene's project.
- `setZ { refs, z | by }` sets or shifts `z` on entities and instances,
  within ±10000. A z of 0 is written as absent, bulk refs are refused
  (promote first), and the inverse is an exact `setZ`. On an instance child
  in the resolved view it becomes an override of `<child>.z`.
- `useAssets { add?, remove? }` edits the `assets` header, which stays
  sorted and unique, with an exact inverse. `diffToOps` turns header
  changes into `useAssets` and z-only changes into `setZ`. `diffScenes`
  reports `scene.assets`.
- Behaviors register: the engine's (none yet), then
  `GameDefinition.behaviors` in order; `registry.behaviors`,
  `behaviorNames` and `behaviorRules(type)` (allowed, required blocks,
  defaults). `createRegistry` refuses a game behavior without its
  `<gameId>/` prefix, a bad or duplicate name, `requires` or type rules
  naming unknown behaviors, a behavior both required and forbidden,
  defaults failing a behavior's schema, behavior field names that aren't
  identifiers, and a type with a grid field but no point field `at`.
- `splitFieldPath` parses the field-path grammar (names, indices, behavior
  names right after `behaviors`).
- `behaviorBlocks(registry, type, written?)` (`./scene`): an entity's
  behavior blocks in registration order, merged as behavior defaults, then
  the type's, then the entity's. `expandScene` puts them on
  `RuntimeEntity.behaviors` (bulk entries get their type's required
  blocks), keeps `layer` and a non-zero `z`, and records
  `transform { turn, flip }` for turned or flipped entities.
- `gridField(description, { values?, max? })`: cells in 32×32 chunks of
  run-length rows, local to the entity's `at`; parsing rewrites the value
  canonically. `gridFieldInfo` reads a grid field's values and max. The
  grid codec in `scene/grid.ts` is real: `decodeRow`/`encodeRow`,
  `readCell`, `paintGrid` (rects, then cells; changed rows and the exact
  inverse), `canonicalGrid`, `isGridValue`, `gridCellBounds`,
  `parseChunkKey`, `compareChunkKeys`, `gridProblems`, `transformGrid`.
- `renderSceneSvg` and `renderSceneAscii` draw grid fields' filled cells
  one by one, local to the entity's `at` and sized by
  `settings.grid.cell` (hex grids staggered as Tiled's), at most 4,096
  cells per render (`SCENE_GRID_MAX_CELLS`), with a `…` where the rest
  begin; a grid entity's render box and `around` framing cover its cells.
- `./scene`: `resolveSceneDetailed` places each instance child through its
  instance's turn and flip at its `at` and then its group's
  (`instanceSteps`; composed: `instanceTransform`), and group members
  through their group's (`groupTransform`). `ResolvedOrigin`'s child form
  gains `path: string[]` (instance ids from the scene down) and
  `transform: Dihedral`; the entity form gains an optional `transform`
  when its group turns or flips. `instanceOrigin` applies the group's
  turn. Grid fields turn only on a square grid with equal cells
  (`gridTurns`). `toSourceBatch` maps edits back through the inverse: a
  world `move` of a flipped child becomes a mirrored override; point,
  vector, angle (exact inverse), mirror, shape and path updates, `place`
  (anchor mapped), `add`, `instantiate` (rot/flip into the group's frame)
  and `paintCells` on members of a turned group follow. Updating one
  coordinate of a turned point and painting an instance child are
  `op-invalid`. New: `placeChildren` and `PlacedChild` (the turn helpers
  are listed with `Transform2D`). `fragmentBounds(fragment, registry, prefabs?)` boxes a
  fragment's instances, turned and flipped, with exact integer bounds.
- The `transform` and `paintCells` ops apply. `transform` turns and flips
  instances and whole groups in world terms about `about` (each one's own
  origin by default); an instance in a group keeps a group-local `at`, and
  naming an instance together with its group is `op-invalid`. `paintCells`
  paints a grid field of an entity (an instance child, bulk entry or
  instance is `op-invalid`) and its inverse restores the exact cells, split
  into ops of at most `MAX_PAINT_CELLS` (now exported from
  `ops-schema.ts`). `instantiate` stores `rot`, `flip` and `params`, and
  `setGroup` stores `rot` and `flip`. `update` and override keys reach
  into behavior blocks (`<child>.behaviors.<name>.<field>`).
- `validateScene` checks behavior blocks: `behavior-unknown`
  (did-you-mean, fix unsets the block), `behavior-forbidden` (the type
  forbids it or never loads; fix unsets), `behavior-missing` (a carried
  behavior's `requires`, counting the type's required blocks; fix adds the
  block as `{}`), and `schema` inside a block at
  `/entities/<i>/behaviors/<name, / as ~1>/<field>`. Grid rules: a grid
  field in a scene without `settings.grid` (a prefab view is exempt: the
  scene placing it sizes the cells), an override naming a grid field (fix
  reverts it), and a turned or flipped instance or group over a grid
  unless the grid is square with square cells are `grid-invalid`.
  Overrides may name `z` and `behaviors`.
- Inspector: one `behaviors:<name>` section per carried behavior (titled
  `inspector.label`, fields in `inspector.order`, a Remove batch unless
  the type requires it) and `InspectorModel.addBehaviors` for the Add
  behavior menu; each add or remove is one update per target.
  `ModelField.defaultValue` carries a behavior field's default. A new
  `assets` section holds fields grouped `assets`.
- Editor commands `turn-cw`, `turn-ccw`, `flip-x`, `flip-y` (`turnBatch`,
  `flipBatch`, `quarterTurnTargets`): one `transform` op over the selected
  instances and whole groups. `e` turns a selection of instances or groups
  a quarter (`KeyContext.quarterTurns`), and still rotates anything else
  15°; Shift+H and Shift+V flip.
- `./scene`: `resolvePrefab(id, library, registry, opts?)` returns a
  `PrefabResolution`: a `ResolvedPrefab` (its children with relative ids
  such as `door-1/panel`, its params, and the prefabs it uses, outermost
  first), or a failure: `prefab-unknown`, `prefab-cycle` (the chain starts
  at its least id) or `prefab-depth` (more than `PREFAB_MAX_DEPTH` = 8
  levels). It is memoised per library and registry object. Also new:
  `splitChildRef`, `INSTANCE_OVERRIDE_FIELDS`, `isInstanceOverrideField`,
  `ResolveOptions` (`{ cells }`) and `BulkPlacement`.
- Prefab files can hold nested `instances` (the scene's instance schema).
  `prefabsUsedBy(def, prefabs?)` takes an optional library and then returns
  every prefab the scene reaches through nested instances and variant
  bases, sorted; `sceneHashWith` hashes all of them. `formatPrefab` writes
  the full v3 prefab header order: `$schema`, `kind`, `v`, `game`, `id`,
  `base`, `contract`, `params` (one per line), `assets`, `overrides` (one
  per line), `bulk`, `instances` (one per line), `entities` (one per line,
  always written, `[]` when empty). `prefabOf`, `prefabBody`,
  `prefabScene` and `sceneBody` carry instances.
- `instantiate` works in a prefab's view (pass `prefab`, the viewed
  prefab's id, in `ApplyOptions`) and refuses with `prefab-cycle` an
  instance, an `update` of an instance's `prefab`, a `definePrefab`, a
  `createPrefab` or an `applyToPrefab` that would make a prefab contain
  itself. `override` takes nested child keys (`door-1/panel.path.speed`)
  and a nested instance's own fields (`door-1.at`, `.rot`, `.flip`, `.z`,
  `.off`, `.layer`, `.params.<name>`; any other field is `op-invalid`).
  `applyToPrefab` takes `to`, a prefab in the instance's chain that
  receives the values (default its own prefab; a nested child's override
  lands on the nested instance there); a path that doesn't run through
  `to`, or one a level between overrides too, refuses with `op-invalid`.
  `unpack` is one level: the outer instance's nested instances become
  instances of the document, their `at`, turn, `z`, layer, `off` and group
  composed with it and its overrides through them folded in.
  `createPrefab` takes instance refs, which move into the new prefab as
  nested instances (their group's transform baked in). `definePrefab`
  carries `instances`, `base`, `overrides`, `params` and `assets`, and
  every inverse restores them. `diffPrefabToOps(view, next, registry?)`
  turns a prefab doc's view into a prefab's children, nested instances and
  assets.
- `./editor`: prefab commands work on nested instances. `applyLevels`
  lists the prefabs Apply to prefab can write a ref's overrides into, and
  `applyToPrefabBatch(def, ref, { to, prefabs })` writes to the chosen
  one. `revertAllBatch` on a nested ref (`room-1/door-1`) drops only the
  keys that ref covers (`overridePathsOf`). `nestedInstanceOf` finds a
  nested instance by its resolved ref. `instancesOf` counts placements
  through nesting, and placements of the prefab's variants, when given the
  library. `createPrefabBatch` accepts
  instances, which become nested instances of the new prefab.
  `buildOutline` adds a row for each nested instance and its children
  (`room-1/door-1/panel`), one level deeper each time.
- Variants: a prefab with `base` resolves its base's children (the
  variant's `overrides` applied, `off: true` hides one) ahead of its own
  entities, bulk entries and instances; a base counts toward
  `PREFAB_MAX_DEPTH`; a cycle through bases is `prefab-cycle`, a missing
  base `variant-base-unknown`. Exposed params: an instance's `params`
  apply as overrides of every target (prefab < param < override at each
  level), a param's `default` applies when the instance sets none, and a
  variant inherits its base's params (a redeclared name replaces it).
- Prefab files take a variant header: `base` (a prefab id), `overrides`
  (override path to value) and `params` (name to
  `{ description, targets, default? }`), plus the `assets` header;
  `parsePrefab`, `prefabSchemaFor`, `prefabOf` and `prefabBody` carry all
  four, and `entities` stays required (it may be empty).
- `setPrefabBase` and `exposeParam` apply on a prefab's view (`applyOps`
  with `{ prefab }`) and are refused with `op-invalid` on a scene. An
  unknown base is `variant-base-unknown` with did-you-mean; the prefab
  itself, or a base that contains it, is `prefab-cycle`. When the header
  changes, `result.prefabs` holds the viewed prefab, with its new base and
  params plus the view's children and `assets`, and `prefabsChanged` lists
  its id. Inverses are header ops.
- `setParam` sets or (null) clears one param on an instance, and `update`
  with `params.<name>: null` clears it too. A param's value is checked
  against every target as an override, and the instance's own overrides
  still win. A param the prefab doesn't expose isn't refused; validation
  reports it as `param-unknown`. Instance params come back in an inverse
  as one `setParam` per param.
- `diffToOps` writes each changed instance param as a `setParam`.
  `diffPrefabToOps` takes an optional fourth argument, `header` (the
  prefab's current base and params), and writes `setPrefabBase` and
  `exposeParam` for whatever differs.
- `./collab`: `setPrefabBase` and `exposeParam` in an `editScene` of a
  prefab write that prefab doc's header through the session's prefab
  writer: the base on its own and overrides per path (logged under
  `VARIANT_KEY`), parameters per name (`@param:<name>`). An unknown base
  is `variant-base-unknown` (with a did-you-mean); the prefab itself, or a
  base that leads back through bases or nested instances, is
  `prefab-cycle`. Sent to a scene, either op is refused with `op-invalid`.
  `changeAssetId` of a base prefab repoints its variants' `base`.
- `./game`: `CHILD_REF_PATTERN` and `refField(description)`: a reference
  field may name an instance's child by its resolved ref (`gate-2/door`,
  `room-1/door-1/panel`); every other id keeps `ID_PATTERN`.
- `./editor`: `instanceParamsModel` and `paramBatch` (`InstanceParamsModel`,
  `ParamModel`): an instance's exposed params, each typed by its first
  target's schema, set with `setParam` (a nested instance's as an override
  of `<nested>.params.<name>`); the inspector's instance panel lists and
  edits them. `referableEntities` (`./editor`).
- Scene fragments carry prefab instances: `fragmentOf(def, refs, registry,
prefabs?)` copies instance refs as instances (world `at`/turn, prefab by
  id) and an instance's child as a plain entity under its own id;
  `fragmentSchemaFor` gains `instances`; `placeFragment(fragment, def,
registry, by, prefabs?)` emits `instantiate` ops after the `add`s,
  renames clashing instance ids (`gate-2` → `gate-3`) and rewrites child
  refs into them (`gate-2/door` → `gate-3/door`); an instance whose prefab
  is missing from `prefabs` places nothing and warns `prefab-unknown`.
  `copySelection` and `cutSelection` take `prefabs`, as do
  `PasteOptions.prefabs` and `duplicateSelection`'s options; the editor's
  copy, cut, paste and duplicate pass the session's prefabs.
- `./editor`: `createVariantBatch(base, prefabs, { taken?, folder? })`
  (`CreateVariant`): Create variant. Returns `{ id, project, scene }`.
  `project` is one `createAsset` (kind `prefab`, content
  `{ kind: "prefab", v, base, entities: [] }`), for agents, the CLI and
  the dev file adapter. `scene` is the same prefab as a `definePrefab`,
  for a session that writes prefab docs through its prefab source. The id
  is `<base>-variant`, numbered when taken. Returns null when the library
  has no such base.

- `./editor`: Escape leaves a prefab open on its own once the gesture,
  tool and selection are cleared (`leave-prefab`, bound in edit scope
  before `clear-selection`). `KeyContext` gains `inPrefab` and
  `hasSelection`; `ToolHost.keyContext()` supplies `hasSelection`.
- `./editor`: `attachBatch(def, ref, follower | null, registry, prefabs?)`:
  one `update` that points an entity's `attachField` at a follower, an
  instance's child follower (`gate-2/lift`) included, or clears it. It
  returns null when the type has no `attachField`, the follower's type
  isn't one the field's refs allow, or nothing would change.
  `attachFieldOf` and `isFollowerType` tell which types can attach and
  which can be ridden. In the outliner, dragging a row onto a follower's
  row attaches it, dropping it on its type's row detaches it, and an
  instance's nested children show as a tree that opens and closes.
- `./editor`: the instance inspector turns (clockwise / counter-clockwise)
  and flips (horizontally / vertically) a scene instance as one batch
  each, and shows and sets its `z`; `instanceTransformModel` and
  `instanceZBatch`.
- `README.md` covers format v3: behaviors, layers and `z`, assets and the
  `assets` header, scene settings, grids, transforms, nested prefabs,
  variants and parameters.
- `./collab`: `applyEntityDiff(runtime, before, after)` moves a
  `BindableRuntime` from one set of entities to another (removes, adds and
  updates only what differs) and returns false when an add or update
  failed, so the caller reloads; `bindSceneDoc` uses it.

### Changed

- **Breaking:** `LAYERS` and `Layer` are gone from the scene types:
  `EntityBase.layer` and `InstanceDef.layer` are plain strings naming one
  of the registry's layers, and `ResolvedSettings` is
  `{ gravity, physics, grid: GridSettings | null, view, ...game keys }`.
  `defaultLayer` moved from `editor/spatial-index` to `scene/layers` and
  takes an optional third argument, the registry's layers: a game whose
  layers lack `terrain`, `gameplay` or `editor` gets the first layer
  (editor-only types the last).
- **Breaking:** `BASE_FIELDS.layer` is any id (`ID_PATTERN`), not a fixed
  enum; `RESERVED_FIELDS` gains `z`, `behaviors`, `params` and
  `overrides`, and `createRegistry` refuses a type whose required `path`
  field accepts `{}`, since an empty `path` is written as none.
- `createRegistry` refuses a type field name that isn't
  `/^[A-Za-z_$][A-Za-z0-9_$]*$/`, a game settings field named `gravity`,
  `physics`, `grid` or `view`, and invalid game layers (none, duplicate or
  non-`ID_PATTERN` names, non-finite draw or scroll). `registry.layers` is
  the game's layers or `DEFAULT_LAYERS`; `withProject` fills
  `FieldEnv.assets` with the project's live ids per kind, sorted, and
  `CreateRegistryOptions` gains `assets`.
- A prefab for another game (or no registry) still reports its header,
  base and nested-instance prefab references.
- `formatScene` writes `assets` on one line after `settings`, sorted and
  unique, and leaves it out when empty. `formatPrefab` writes `assets`
  after `contract`. The entity and instance key order adds `z` (after
  `off`), `rot`, `flip` (after `at`) and `params` (before `overrides`).
  The resolved view adds an instance's `z` to each child's, `unpack` bakes
  it into the children, and `instantiate` keeps `z`.
- Each loadable type's entity schema has a `behaviors` object. A known
  block is checked by its behavior's fields, and a field is required only
  when neither the behavior nor the type gives it a default. Any other
  name parses, so validation can report it by name. The JSON Schema lists
  only the type's allowed behaviors (`additionalProperties: false`), and
  types that don't load have no `behaviors`.
- `OVERRIDE_PATH` follows the override-path grammar: a child ref (ids
  joined by `/`, optionally ending in a bulk ref), a dot, then a field
  path whose segment right after `behaviors` may be a behavior name.
- The formatter's entity and instance key order ends with every other key
  by code unit, then `behaviors` (its blocks by name in code-unit order),
  then grid-valued keys. Everything inside `behaviors` is written by code
  unit, at every depth and whatever the names (a path-shaped field value
  included), and `comparePointers` orders pointers there the same way. An
  entity that holds grids spans lines, one chunk
  per line, chunk keys row-major by (cy, cx); `formatScene`'s `lines` maps
  each chunk pointer to its line. `formatPrefab` writes grid entities the
  same way. `comparePointers` takes an optional document to place grid
  keys, and orders chunk keys and behavior names as the text does.
  `parseScene` reports bad grid keys, rows, row counts and values past a
  field's max as `grid-invalid`, once per problem.
- The inspector's `behavior` section is titled Gameplay (its id is
  unchanged). `ModelField.section` and `InspectorSectionModel.id` are
  `ModelSectionId` (`InspectorSectionId | behaviors:<name>`).
- `./collab`: collab layout 3 (`COLLAB_LAYOUT_VERSION = 3`). Record keys
  are `Z_FIELD = "@z"` and `BULK_FIELD = "@bulk"`: every `@`-key belongs to
  the layout and `readDoc` strips only those, so a draw `z` field survives.
  `behaviors` is a two-level nested map (`NESTED2_FIELDS`; removing a
  behavior wins over a concurrent field set) and `params` joins
  `NESTED_FIELDS`. `recordMap` gives a named entity an empty `behaviors`
  map and an instance empty `params` and `overrides` maps, which
  `patchRecord` empties and fills in place and `recordOf` reads as absent,
  so two clients adding an entity's first behaviors (or an instance's
  first params or overrides) at once both land. Grid-valued fields are stored one row per key
  (`<field>@<cx>,<cy>/<row>`, `GRID_ROW_KEY`): `patchRecord` writes only
  changed rows and `recordOf` gathers them back canonical. The `assets`
  header is the `assets` map (AssetId → true; `readAssets`,
  `writeAssets`). `contentMaps` adds `assets` and the prefab doc's `params`
  and `overrides`. `readDoc` reads a prefab doc's instances, and its base,
  params and overrides into `DocView.prefab` (`PrefabDocHeader`). Groups
  carry `rot` and `flip`. New helpers: `assetsMap`, `paramsMap`,
  `prefabOverridesMap`, `patchMap`, `recordFields`, `isLayoutKey`,
  `gridRowKey`.
- `./collab`: `migrateLayout` lifts a layout-2 scene doc to layout 3 (every
  entity and instance record's `z` → `@z`, `bulk` → `@bulk`, keys kept, one
  `migration` transaction), and takes a layout-1 scene through the prefab
  move and then the rename in the same scene transaction. New
  `migrateDocLayout(doc, layout?)` (`DocLayoutMigration`) does the same for
  a prefab doc (records) or a declarative asset doc (every `keyed` entry's
  order key, at any depth) at load. Keyed entries keep their order under
  `KEYED_Z = "@z"`. `migrateDoc` writes only `meta.schemaVersion` for a
  step that changes nothing but `v`.
- Dev and hosted loads lift layout-2 scene, prefab and declarative asset
  docs to collab layout 3 (`@z`, `@bulk`), keeping every key; the layout
  step runs before the format migration, and a client whose token carries
  `l` below 3 connects read-only with `engine-outdated`.
- `./collab`: `writeScene` writes the `assets` map one id per key (log key
  `@assets`), a group's `rot` and `flip` as their own keys (`patchGroup`),
  and an instance's `rot`, `flip`, `z` and per-key `params` through
  `patchRecord`, so `paintCells` writes only the grid rows it changed. A
  prefab doc's `writeScene` also writes its `assets` and nested
  `instances`.
- `./collab`: `prefabToDoc`, `docToPrefab` and `prefabPatch` write and read
  the layout-3 prefab maps: `base` in the `prefab` header beside `id` and
  `contract`, `params` (name → PrefabParam, atomic each), `overrides` (a
  variant's, path → value), `assets` (AssetId → true) and nested
  `instances` (key → Y.Map, the scene's instance layout). `prefabPatch`
  keeps nested instances' keys by id and logs each parameter under
  `@param:<name>`, base and overrides under `@variant`, and the assets set
  under `@assets`, so concurrent edits to different keys merge and each
  entry reverts.
- `./collab`: `revertEntry` reverts `@assets`, `@param:<name>`, `@variant`
  and a prefab doc's `@header`; a group reverts key by key.
- `./collab`: `watchIssues` / `validateDoc` take `project` (`IssueProject`:
  a `ProjectSession` fits); with it the scene's asset ids are checked
  (`asset-missing`, `asset-kind`) and a change to the project registry
  revalidates. A prefab doc validates as a view of its prefab
  (`ValidateOptions.prefab`).
- `moveAsset` and `renameAsset` of a scene carry its checks file
  (`<stem>.checks.json` beside it) to the same folder and new stem in the
  same op, refused with `path-taken` when that path is taken; `deleteAsset`
  of a scene names its checks file as an `asset-in-use` referrer at
  pointer "" (by path), unless the batch trashes or moves the checks file
  too, or a new scene takes the path.
- `localChild`, `localChildren` and `placeChildren` take an optional
  trailing `library` (and `opts` for `localChild` and `localChildren`).
  With a library, nested instances resolve; without one, only the prefab's
  own children come back, and a prefab that doesn't resolve has no
  children. `LocalChild` gains `turn?` and, on bulk children, `placed?`. A
  nested child's `def.id` is its id in its own prefab, while `child` is its
  relative ref. `childEntity` returns the relative ref as the id and
  applies `placed`. `ResolvedOrigin.path` carries the whole instance
  chain, and its transform composes nested turns.
- `splitOverridePath` returns null when the child part is not a child ref
  or the field part is not a field path. Nested override keys
  (`door-1/panel.path.speed`) and nested-instance keys
  (`door-1.at|rot|flip|z|off|layer|params.<name>`) resolve so that an
  outer level beats every inner one. Override values are in the frame of
  the child's own prefab.
- `diffToOps` removes and re-instantiates an instance whose `prefab`
  changed instead of updating it.
- `ApplyOptions` gains `prefab`, the prefab the document is a view of.
- `prefabsUsedBy(def, prefabs?)` takes the library as an optional second
  argument. `prefabSceneBounds` takes
  `Pick<Prefab, "bulk" | "entities" | "instances" | "v">`.
- `./collab`: a prefab doc takes `instantiate`, `override`,
  `revertOverride`, `applyToPrefab` (with `to`) and `unpack`, so prefabs
  can nest; `setScene`, `setSettings`, `setGroup`, `definePrefab` and
  `createPrefab` stay scene-only (`SCENE_ONLY_OPS`). An `instantiate` that
  would make the prefab contain itself is refused with `prefab-cycle`, both
  live and in `checkProjectBatch`. The bounds a prefab doc is edited in
  also hold its nested instances' origins.
- `./collab`: `prefabSceneBounds(prefab, parent?, registry?, prefabs?)`
  and `ReadDocOptions.prefabs` take the prefab library, so a prefab doc's
  bounds hold its nested instances' resolved children. The editor session,
  `bindSceneDoc`, `validateDoc`/`watchIssues` and `applyOpsToDoc` all read
  prefab docs with their prefab source's library, so they agree on its
  `sceneHash`; an edit to a nested prefab can change that hash (the
  session re-reads it when its source changes).
- `./editor`: `applyToPrefabBatch(def, ref, opts?: { to?, prefabs? })` and
  `instancesOf(def, prefab, prefabs?)`.
- `attachField` takes child refs (`gate-2/lift`), so an entity can ride a
  follower inside an instance.
- `refCandidates(def, registry, accepts, prefabs?)` takes an optional
  `PrefabLibrary` and then lists instances' children at any depth.
- `duplicateSelection` reads the selection through `fragmentOf`, which
  resolves the document itself, so the editor no longer passes `from`.

### Fixed

- Copying an instance's child no longer produces a fragment paste refuses
  with `bad-id`: the child takes its own id (`gate-2/door` → `door`, a
  bulk child its type), and refs to it in the fragment follow.
- `snapshotScene` and `loadHeadless({ files })` load every prefab a scene
  reaches (nested instances' prefabs and variant bases), not only the ones
  it places, so a scene with nested prefabs or variants loads instead of
  failing with `prefab-unknown` or `variant-base-unknown`.
- `changeAssetId` on a prefab that other prefabs nest or use as a base
  rewrites those prefabs' instances and `base` in the same batch, instead
  of refusing with "changed while the batch was being planned".
- `bindSceneDoc` and `watchIssues` follow every prefab a scene reaches
  (`prefabsUsedBy`), so editing a nested prefab or a variant's base
  reaches the live runtime and the issue list.
- An empty map (`behaviors: {}`, an empty `path`, `settings: {}`) and an
  absent one are the same between file and doc, so both hash alike.
  `formatScene` leaves an empty `settings` out and `parseScene` reads it
  as absent.
- Behavior defaults are no longer written into files; one implementation
  of `setPrefabBase` and `exposeParam` serves the scene and project paths;
  `createAsset` of a prefab or variant writes through the prefab writer
  on the live and file paths; a batch can expose a param in one
  `editScene` and set it in a later one.
- `prefabScene` and `sceneBody` carry a prefab's `assets` header, so a
  prefab edited or validated on its own keeps it.
- A variant's own `overrides` count as asset and material references (so
  renames rewrite them) and are validated in its view: a path naming no
  child of the base is `unused-override`, one naming a grid field is
  `grid-invalid`, each with a fix that drops it. The fix is a
  `revertOverride` with no ref, so it applies to a live prefab doc and
  touches only that override.
- `override` and `revertOverride` with no `ref`, in a prefab's own
  document, set and drop the prefab's own overrides of its variant base,
  on the scene, project and live paths (a prefab doc writes them per
  path); their inverses are the same ops. Sent to a scene they are refused
  with `op-invalid`, like the other header ops.
- A header op's failure points at its field on every path
  (`/ops/<i>/base`, `/ops/<i>/name`, `/ops/<i>/set`), and a prefab named
  as its own base is `prefab-cycle` on every path.
- An `editScene` on the project path that removes a prefab's last
  `assets` entry drops its `assets` header; the scene and project paths
  build the prefab a view leaves with one helper (`prefabLeftByView`).
- A prefab validated on its own judges a turned or flipped nested instance
  over grid children against the grid `ValidateOptions.settings` (the
  project's engine block, the game's defaults) resolves; with none, each
  scene that places the prefab judges it. Neither source holds a grid yet,
  so the editor and `scene validate` leave the check to the placing scenes
  until a caller passes one.
- An override of a bulk child's `off` (a variant hiding a base solid, or a
  cut of an instance's bulk child) is no longer `unused-override`.
- A behavior field's default under an `optional` or `nullable` wrapper
  (`z.number().default(3).optional()`) is no longer filled on parse and
  written back to files; `expandScene` still fills it.
- The `assets` header's asset checks skip a non-string entry, as the
  project's ref sites do, instead of reporting it.
- In a variant's isolation, an edit whose base children the edit world
  can't add or update reloads the world instead of leaving it out of
  step.
- Generated JSON Schemas no longer carry the field builders' `kind` and
  `axis` meta, which aren't JSON Schema keywords.
- Quarter-turn rotation is exact and writes no trailing `rotDeg: 0`; bulk
  children of a turned nested instance carry the composed turn; grid
  entities' render boxes cover their cells.
- Editor: cutting an instance's child, `cutSelection` hashing the
  document, a variant in isolation showing its base's children, and the
  outliner's layer view showing nested rows.

### Agent surface

- `AGENT_SURFACE_VERSION` is 8: the ops, issue codes, schema ids and CLI
  output below. MCP tool names are unchanged; `scene_apply_ops` takes the
  new ops through `ops:v3` and `scene_show` carries the new fields.
- Ops `transform`, `setZ`, `useAssets`, `paintCells` (at most 65,536
  cells; `rects` fill first and `cells` paint over them), `setPrefabBase`,
  `exposeParam` and `setParam` in the ops schema; `setGroup` takes `rot`
  and `flip`, `instantiate`'s instance takes `rot`, `flip`, `z` and
  `params`, `applyToPrefab` takes `to`, `override` and `revertOverride`
  take an optional `ref` (omitted, in a prefab's own document: the
  prefab's own overrides of its base), and `definePrefab`'s body takes
  `instances`, `base`, `overrides`, `params` and `assets`.
- A variant's `unused-override` and `grid-invalid` fixes are
  `{ "op": "revertOverride", "paths": [<path>] }`, not a `definePrefab`;
  a prefab named as its own base through `editScene` or a prefab doc is
  `prefab-cycle` (was `variant-base-unknown`), and header op issues point
  at the op's field (`/ops/<i>/base`, `/ops/<i>/name`).
- The prefab schema (`prefab:v3`) takes an optional `instances` array of
  the scene's `Instance`, and `base` (before `contract`), then `params`
  (`PrefabParam`: `description`, `targets`, `default`), `assets` and
  `overrides`; `entities` stays required. The fragment schema takes an
  optional `instances` array.
- An `attach` field's pattern is `CHILD_REF_PATTERN`, not `ID_PATTERN`, in
  the scene, prefab and fragment schemas.
- Issue codes `prefab-cycle`, `prefab-depth`, `variant-base-unknown`,
  `param-unknown`, `layer-unknown`, `behavior-unknown`,
  `behavior-forbidden`, `behavior-missing`, `grid-invalid` and
  `ref-child-unknown`.
- `scene show` lists nested instance children as `a/b/c` with
  `instancePath`, an instance's `nested` ids, `z`, the world `transform`
  (turn and flip), behavior blocks, an instance's `params` and the params
  its prefab `exposes`, and each grid field's summary (`grids.<field>`:
  filled `cells`, `chunks`, cell `bounds`); a turned group member's AABB is
  in world space. `scene fmt` reports `migratedFrom` for scenes and
  prefabs it migrates to v3.
- `scripts/scene/README.md` §Format v3: behaviors, layers and `z`, assets,
  grids, transforms, nested prefabs, variants and parameters, with a
  dry-runnable batch for every new and changed op and one that reports
  each new issue code; `examples/paint-cells.json` and
  `examples/turn-instance.json`.

## [0.6.0] — unreleased

The collaborative project and asset model: a project is a set of typed
assets, each kind co-editing like a scene, with a registry, references,
content-addressed blobs and one undo stack across every doc a client
writes.

### Added

- `./project`, a new entry that needs only zod: the project model as plain
  JSON. Ids and keys (`AssetId`, `AssetKey`, `AssetPath`, `Sha256`),
  `ProjectFile`, `AssetEntry`, `ProjectState`, `Licence`, `ProjectOp` and
  `ProjectOpBatch` (`PROJECT_OP_NAMES`); doc names `project:<id>`,
  `scene:<project>.<key>` and `asset:<project>.<key>` (`parseDocName`
  returns null for anything else, `docNameOf` throws on a bad id or key;
  `DOC_NAME_KINDS`, `DOC_NAME_MAX_LENGTH`); `sha256`, `isSha256` and
  `stableJson`.
- `./game`: `GameDefinition.assetKinds`, `tables` (`GameTableDef`) and
  `projectSettings`; `EngineContext.project` (a frozen
  `ProjectRuntimeView`, or null) for the run.
- `./collab`: `DocOrigin` (`SceneOrigin` stays as its alias) gains the
  `repair` origin, labelled `repair (<reason>)`; `ProjectLogEntry` sits
  beside `LogEntry`.
- `./project`: `canonicalJson(value, layout)` writes a declarative kind's
  canonical text: `$schema`, `kind`, `v` first at the root, then the
  layout's declared fields, then the rest sorted; one line per keyed or
  list item, a keyed item's id first; two-space indent; trailing newline.
- `./project`: `applyJsonEdits(value, layout, edits)` applies `set`,
  `unset`, `insert` (before a sibling id or an index, default the end) and
  `remove` to plain JSON; RFC 6901 pointers with `@<id>` segments for keyed
  items (`parseJsonPointer`, `keyedItemPointer`, `readPointer`). It refuses
  a pointer into an atomic or text value with `op-invalid`, a repeated
  keyed id with `id-taken`, and a missing target with `ref-not-found`.
- `./project`: `memoryContentStore()` implements `ContentStore`. `put`
  rejects with a `ContentStoreError` carrying a `hash-mismatch` issue when
  `expect` differs. `hashForPut` gives other stores the same check.
- `./project`: `createKindRegistry(game, base)` builds a kind registry:
  engine kinds then the game's `assetKinds`. It refuses duplicate names,
  game kinds not named `<gameId>/<name>`, game kinds with
  `layout: "custom"`, declarative layouts without a `map` root, and a
  suffix or `jsonKind` that two kinds claim. `detect` goes in order:
  sidecar kind, longest suffix, `.json` top-level `kind`, then a kind's
  `test`. It always skips `*.schema.json`, `*.asset.json`,
  `jams.project.json`, `__tests__`, `node_modules` and `dist`
  (`isSkippedAssetPath`). `schemaHashes` hashes each kind's JSON Schema.
- `./project`: `validateAssetDoc(kind, value, env)`: schema issues
  (`schema`, `unknown-key`), `dup-id` for repeated ids in `keyed`
  collections, then the kind's own `validate`.
- `byCodeUnit` (`./project`): the code-unit string comparator the
  project model sorts by.
- `./project`: `buildRefIndex` (referrers, targets, dangling references as
  `asset-missing` with a did-you-mean), `rewriteRefs`, `referencedTrash`
  (the trashed entries a live value names, for the writer's
  restore-on-store repair), `projectUsage` and `unreferencedBlobs` (keeps
  current hashes of live and trashed entries, hashes replaced within the
  grace period, and pinned snapshots' hashes). Every replacement appends
  the outgoing hash to the asset's history stamped with its time, so a
  hash's newest `HashHistoryEntry.at` is when it last stopped being
  current.
- `./project`: the files-to-registry steps every host seeds a project
  with, shared by the dev server's scan and the site's bundle seeding:
  `projectPathMatcher(file, matchesGlob)` (asset and code candidates by
  the project file's globs), `ownAssetId`, `orphanSidecarIssue`,
  `idsAtPaths`, `assetFileEntry` and `assetFileEntries` (keys from the
  sidecar or id, suffixed in file order; name, licence, settings and the
  inspected meta), over `AssetFile`.
- `./project`: `parseProjectFile` / `formatProjectFile` for
  `jams.project.json` (`urn:jams-engine:project:v1`, defaults
  `assets: ["**"]`, `code: ["**/*.ts", "**/*.tsx"]`) and `parseSidecar` /
  `formatSidecar` for `<file>.asset.json`
  (`urn:jams-engine:asset-sidecar:v1`; `key` omitted when it equals `id`,
  `assetKind` when detection agrees). New schema files
  `./schemas/project.schema.json` and `./schemas/asset-sidecar.schema.json`.
  `src/engine/scenes/` and `src/games/platformer/` each carry a
  `jams.project.json`.
- `./project`: pure header readers `readPngSize`, `readJpegSize`,
  `readWebpSize` (VP8, VP8L, VP8X) and `readGifSize`; `parseAsepriteJson`
  and `parseTexturePackerJson` (hash and array exports: frames, tags with
  direction, slices with nine-slice centre, file order) with `atlasImage`
  and `atlasTool`; `parseBmfont` for text .fnt line height and pages. They
  read headers and JSON only and return null on bad input.
- `./collab`: `layoutToDoc`, `layoutFromDoc` and `layoutPatch` keep a
  declarative kind's value in `doc.getMap("content")` by its `DocLayout`
  (atomic, text, map, list, keyed). A patch writes only what changed, in
  one transaction. Keyed items keep their keys when ids match, and two
  items with one id stay two.
- `createUndoCoordinator(origin, { cap })` (`./collab`): one undo stack per
  client across every doc it writes in a project. Each attached doc gets a
  `Y.UndoManager` with `createSceneUndo`'s settings over every root type
  but `log` and `meta`; a step that wrote several docs undoes (newest doc
  first) and redoes as one, carries its label and selection, never reaches
  into an older step when a collaborator overwrote part of it, and the
  stack keeps the newest 100 steps. `pinned()` names the docs with steps on
  either stack.
- Project log and project presence (`./collab`): `readProjectLog`,
  `observeProjectLog` and `projectLogFor` over the project doc's `log` of
  cross-doc batches (capped at `LOG_CAP`); `setProjectPresence`,
  `projectPeers`, `observeProjectPeers` and `projectPeersByDoc` over
  `PROJECT_PRESENCE_FIELD`, beside each doc's unchanged `ScenePresence`.
- `ENGINE_ASSET_KINDS` (`./project`): the engine's doc kinds `scene`,
  `prefab`, `material` (`material:v1`), `game-settings`
  (`game-settings:v1`), `data-table` (`data-table:v1`), `input-script` and
  `checks`, plus `code`. `createKindRegistry` uses them as its default
  base.
- `parseAssetDoc`, `formatAssetDoc` and `docKindJsonSchema` (`./project`):
  read, write and publish any doc kind's file. `DocKindDef.parse` lets the
  scene and prefab kinds use their own parsers.
- `createRegistry(game, { materials })` and
  `withProject(registry, view, values)` (`./game`): a project's material
  assets overlay the game's code materials by name. A material without
  `physics` can't be used on a body.
- `runtimeView` (`./project`): `EngineContext.project` reads game-settings
  (with `projectSettings` defaults) and data tables (merged in path
  order). `createGame`, `createHeadlessRuntime`, `runPlaytest` and
  `createSceneRuntime` take a `project` option; without one, `ctx.project`
  is null. `./headless` re-exports the `ProjectRuntimeView` type.
- `formatInputScript`, `formatChecks`, `INPUT_SCRIPT_LAYOUT` and
  `CHECKS_LAYOUT` (`./scene`).
- The project doc (`./collab`): `readProject`, `readEntry`, `writeEntry`,
  `seedProjectDoc`, `writeProjectState`, `appendHistory` and the
  `PROJECT_MAPS` accessors. Registry entries are `Y.Map`s whose `import`
  and `licence` are nested `Y.Map`s, so they merge per field.
- `applyRegistryBatch` (`./collab`) applies `createAsset`, `importAsset`,
  `renameAsset`, `moveAsset`, `deleteAsset`, `restoreAsset`, `setImport`,
  `replaceContent` and `setLicence` to a project doc in one transaction
  with the batch's origin and one project log entry. `applyRepairs`
  (repair origin, idempotent) writes the view's deterministic id and path
  repairs, plus restores of the trashed keys it is given.
- `projectView` (`./project`) resolves `byId`, `byPath`, `byKey`, the
  trash, the issues `asset-id-taken`, `path-taken` (case-only included)
  and `asset-kind`, the repairs (sorted by `(created.at, key)`, with
  `-2`/`-3` before the extension) and `tree()`. `checkProjectBatch` checks
  the registry ops on plain JSON; `ProjectBatchEnv.newKey` is required and
  `inspect` (a `BlobInspect`) is new. `assetIdOfPath`, `assetPathProblem`,
  `compareEntries`, `suffixedId` and `suffixedPath` are exported beside
  it.
- `./vite`: `fileContentStore(cacheDir)`, the dev content store: blobs at
  `<cacheDir>/blobs/<sha256>`, written atomically, `put` refused with
  `hash-mismatch` when `expect` differs; `defaultCacheDir(project, root?)`
  and `DEV_CACHE_ROOT` (`node_modules/.cache/jams-engine/<project>`).
- `./vite`: `createProjectFileAdapter(project)` reads a project's files
  into a `ProjectState` (`scan`: keys are ids unless a sidecar names one;
  schemas, sidecars, the project file, `__tests__`, `node_modules` and
  `dist` are skipped) and writes declarative asset docs and registry
  changes back: canonical text only when it changed, a sidecar only when
  it carries something, moves, trash and restore from the dev cache. File
  events: an edit is one `disk` layoutPatch; adds and unlinks wait for
  `settle`, which pairs them into moves (`pairDiskEvents`, by sidecar key
  then id, within `MOVE_SETTLE_MS`).
- Blob asset kinds `texture` (PNG, JPEG, WebP, GIF; 8 MiB), `atlas`
  (Aseprite and TexturePacker JSON; 2 MiB), `font` (text BMFont, WOFF2,
  WOFF, TTF, OTF; 4 MiB), `audio` (Ogg, MP3, WAV, M4A; 16 MiB) and
  `recording` (recording:v1; 4 MiB, immutable) join `ENGINE_ASSET_KINDS`,
  each with zod settings and meta and a pure, header-only `inspect` that
  returns `import-failed` instead of throwing.
- `./collab`: `createProjectSession({ project, openDoc, origin, registry,
kinds, store?, buildAt?, prefabWriter?, cap?, key?, now? })` is a
  client's live project. Docs open lazily through the host's injected
  `openDoc(name): Promise<{ doc, awareness, close }>`, one undo
  coordinator spans all of them, and docs with undo steps stay open
  (`pinned()`). Code skew: a doc of a kind whose schema hash differs from
  the project's build stamp opens read-only with `code-skew`
  (`detail: { kind, mine, project }`), unless this build's
  `(buildAt, hash)` is newer, in which case the session writes its stamp
  with origin `repair`/`build`. `prefabWriter` is a slot;
  `NO_PREFAB_WRITER` refuses prefab writes with `op-invalid` ("needs the
  project"). `memoryDocHost()` serves docs in-process for tests and
  headless runs.
- `./collab`: `applyProjectBatch(session, batch, origin, opts?)` applies a
  project batch across docs. It checks first, so a failing op or a
  read-only doc writes nothing. Each doc gets one transaction and its own
  log entry, a batch that wrote two or more docs gets one project log
  entry, and the batch is one undo step for the session's origin.
  `editAsset` goes through `layoutPatch`, `editScene` through
  `applyOpsToDoc`, and a new asset's content is written as its doc's first
  edit. `applyRegistryBatch` still refuses `editAsset`, `editScene` and
  `changeAssetId`.
- `./collab`: `revertProjectEntry` / `revertOpenProjectEntry` revert a
  project entry as one new cross-doc batch, or name the doc that changed
  since. `revertEntry` takes `{ layout }` for asset docs'
  `@content:<field>` keys. `revertProblem` and `contentLogKey` are new.
- `./collab`: `historyRows(log, projectLog, docName)` returns
  `HistoryRow`s, and `appendProjectLog` is exported. `ProjectLogInput`
  takes an optional `id`.
- `./editor`: `projectHistory(project, docName, { onUndone? })` is a
  `SessionHistory` backed by the coordinator. `SessionHistory.undo`/`redo`
  may return the `SelectionMeta` to restore, and the new optional
  `commit(selection)` is called after each dispatch.
- `./project`: `checkProjectBatch` now checks `editAsset` (through the
  layout, then the kind's schema) and `editScene` (`applyOps` on scenes).
  Ops that write prefabs go to `env.prefabEdit`. `ProjectBatchEnv` gains
  `prefabsFor` and `prefabEdit`, `ProjectBatchCheck` gains `delegated`,
  and `writesPrefabs`, `PREFAB_SCENE_OPS` and `SCENE_KIND_NAME` are new.
- `./project`: project snapshots are real: `snapshotProject` pins every
  live asset by content hash (docs by canonical text, blobs by bytes and
  import settings), `checkSnapshot` resolves every reference to an asset
  in the snapshot (`asset-missing`, `asset-kind`, `hash-mismatch`),
  `snapshotScene` reads a scene and its prefabs from the content store
  and returns the registry they run by. Both parse with the snapshot's own
  material assets overlaid in place of any the caller's registry had, so
  a material edited after a snapshot never reaches it;
  `parseProjectSnapshot`, `formatProjectSnapshot`, `SnapshotError` and
  `SnapshotAsset`.
- `./headless`: `loadHeadless({ snapshot, store, scene, registry,
project? })` or `loadHeadless({ files, registry, project? })` loads a
  scene for a run without fetching or decoding a blob; two snapshots of
  one scene load side by side, each with its own materials in the
  returned `registry`.
- `SceneIssue.detail` (`./scene`): optional facts specific to an issue
  code, such as `code-skew`'s two schema hashes.
- `./project`: `checkProjectBatch` refuses `deleteAsset` with `asset-in-use`
  while another live asset names it, listing `detail.referrers: { id,
pointer }[]`. With `force` it trashes the asset, and the result carries
  each referrer's `asset-missing`. A site only counts when its kinds include
  the asset's kind. `changeAssetId` is checked: the entry's id, a prefab's
  own id, then every referrer is rewritten with `rewriteRefs`. A doc
  referrer goes through `editAsset` (set at the deepest addressable
  pointer), a scene through `update` scene ops, a prefab through
  `env.prefabEdit` as an `editScene` of its own, and a binary referrer
  through its import settings. A referrer that refuses fails the op, and so
  does a recording, whose bytes name its scene. The op needs every live doc
  whose kind has `refs`. `ProjectBatchCheck` gains `writtenBy` and `scenes`
  (`SceneWrite`: the scene ops, registry and prefabs each scene doc is
  written with).
- `./collab`: `applyProjectBatch` applies `changeAssetId` as one cross-doc
  batch. The registry entry, the prefab doc's header id (logged under
  `@header`) and every referrer each get one transaction, and it is one undo
  step. For `changeAssetId` and `deleteAsset` it opens every doc that can
  hold a reference. A doc it only reads refuses the batch for code skew only
  when the batch writes it. The prefab writer is asked about every prefab
  rewrite, and the batch is planned before anything is written. A prefab
  it creates gets the same path rule as `createAsset`: a path another live
  asset holds, ignoring case, or a file where a folder goes is `path-taken`.
- Breaking: `sceneToDoc` takes no `prefabs` and writes `meta.layout`, plus
  `project` and `assetKey` when given. `DocView` loses `prefabs` and gains
  `kind` and `prefab`. `readDoc(doc, { registry, parentBounds })` reads a
  prefab doc as a scene with synthesised bounds. `contentMaps` covers the
  prefab header map, not `prefabs`. `docMeta` returns `layout`, `kind`,
  `project` and `key`. `writeScene` takes no `prefabs`.
- `PrefabSource` (`staticPrefabSource`, `localPrefabSource`,
  `sessionPrefabSource`, `EMPTY_PREFAB_SOURCE`): `bindSceneDoc`,
  `watchIssues`, `validateDoc` and `createEditorSession` take an optional
  `prefabs` source and re-expand or revalidate once per prefab transaction.
  `EditorSession` gains `prefabs` and `parentBounds`.
- `applyOpsToDoc` takes `prefabWriter` and `parentBounds`. Without a writer
  it refuses definePrefab, createPrefab, applyToPrefab and unpack with
  op-invalid ('needs the project'). On a prefab doc it refuses scene-only
  ops and grouped children (`SCENE_ONLY_OPS`). Its result gains `docs`.
- Breaking: `openPrefabIsolation` is async and returns a session over the
  prefab's own doc; the scratch doc is gone. It takes `awareness`, `user`
  and `history` options. Apply to prefab, Create prefab and Unpack are
  cross-doc batches, one undo step each. `asProjectBatch` was added.
- `ProjectSession.prefabLibrary` slot; `PrefabPlan.release`.
- `./vite`: the project file adapter handles binary kinds. `scan` hashes
  each binary, copies its bytes into `fileContentStore` and inspects it;
  `storeProject` writes the sidecar every binary has (hash, bytes, settings,
  meta), the bytes of a `replaceContent` or restore taken from the content
  store, and moves and deletes the sidecar along with its file. When a
  binary's bytes change on disk, that becomes one `disk` `replaceContent`
  with re-inspected meta, and its `ProjectSync` result names the
  `AssetChange` for the server to broadcast as `asset:changed`. A persisted
  doc state loads with `PERSISTED_ORIGIN`, followed by at most one `disk`
  transaction for whatever changed on disk while the server was down.
- Breaking: `./vite`: the dev server serves every project doc
  (`project:<id>`, `scene:<project>.<key>`, `asset:<project>.<key>`) on
  `/__scene-collab` from the projects' files;
  `sceneCollabServer`/`listenSceneCollab` take
  `{ projects: FileProject[], buildAt?, settleMs? }` instead of `{ homes }`.
- `./vite`: dev persistence: each doc's Yjs state is kept in
  `<cacheDir>/docs` and reloaded on restart, with a file edited meanwhile
  applied as one disk transaction.
- `./vite`: one watcher per project root pairs unlink+add into moves within
  the settle delay; disk edits, moves and deletes become one disk
  transaction or registry op; binaries are rehashed and announced with an
  `asset:changed` stateless message on the project doc (`ASSET_CHANGED`,
  `AssetChangedMessage`).
- `./vite`: on store, the dev server repairs binaries whose bytes the
  content store lacks (`hash-mismatch`), restores trashed assets a loaded
  doc still names (`asset-in-use`; also as such a doc loads), and repairs
  duplicate ids and paths; it writes the code map and this build's schema
  stamps.
- `./vite`: `GET /__project`, `POST /__project/<id>/blob`
  (`x-expect-sha256`) and `GET /__project/<id>/blob/<sha256>`, same-origin
  only (`PROJECT_ROUTE`). A body that doesn't hash to `x-expect-sha256` is
  refused with 422 and a `hash-mismatch` issue, the status the site's blob
  route answers. An upload to a project with no blob kinds is refused with
  400 and an `asset-kind` issue before its body is read, and the project id
  segment is percent-decoded. Unlike the site's route it ignores
  `x-asset-kind` (the body is capped at the project's largest blob kind),
  answers 200 for a new blob as well as a held one, and has no quotas.
- `./vite`: `applyProjectBatchToFiles` and `snapshotFiles` apply a
  `ProjectOpBatch` to a project's files through the live path; a stale base
  fails with `stale-base`.
- Breaking: `./vite`: `readFileProject`, `codeModules`, `gameRegisters`,
  `isCodePath`; scene and prefab docs in the project file adapter;
  `file-adapter.ts` and `prefab-files.ts` folded into `project-files.ts`
  (`createSceneFileAdapter`, `sceneDocName`, `sceneOfDocName`,
  `SCENE_DOC_PREFIX`, `SceneHome` and `SceneFileAdapter` removed; use
  `createProjectFileAdapter` and `docNameOf`/`parseDocName`).
- `./vite`: `ProjectFileAdapter.blockedWrite(doc)`, the `path-taken`
  issue for a created or moved entry whose path something on disk other
  than its own file holds (a file the scan doesn't list, a file where a
  folder goes, ignoring case); a path a trash or move in the same write
  frees isn't blocked. `applyProjectBatchToFiles` refuses such a batch with
  it, dry run or not, and writes nothing; the dev server warns once,
  leaves the entry unwritten, and writes each held entry once a file event
  under the project frees its own path. `storeProject` trashes and stages
  moves before it creates, so a new entry can take a path the same write
  frees.
- `./vite`: `readProjectPrefabFiles(project, state, registry)` reads a
  project's live prefab assets at their registry paths. `PrefabFiles` gains
  `files` (each read prefab's file).
- `./vite`: `FileApplyOptions.store`: where `applyProjectBatchToFiles`
  inspects blob bytes from (a dry run's bytes stay out of the cache).
- `reinspectBlobs` (`./collab`): the project's one writer re-derives a
  binary's meta from its bytes and merged import settings on store, with a
  `repair` (`reinspect`) origin; `inspectEntry` (`./project`): the shared,
  never-throwing blob inspection every host uses.
- `./project`: `detectImport(kinds, path, json?)`, the kind a file brought
  into a project takes: `detect`'s, else `atlas` for a `.json` that names
  no `kind` and whose `meta.app` says Aseprite or TexturePacker exported it
  (`atlasExportApp`). The scene CLI's `assets import`, the MCP
  `asset_import` and the editor tree's drop import use it, so such a file
  imports without `--kind`, and its sidecar records `assetKind: atlas`.
- `./collab`: `buildAtFrom(raw)` and `stampWins(buildAt, hash, than)`, the
  build-time reading and stamp comparison every host shares, so a dev
  server and the browser given the same `VITE_BUILD_AT` agree on it.

### Changed

- **Breaking:** doc names carry the project. A scene is
  `scene:<project>.<key>` (the platformer's yard is
  `scene:platformer.test-yard`), every other asset `asset:<project>.<key>`,
  and the registry `project:<id>`, on the dev server and on canvas-sync
  alike; the old `scene:<name>` no longer resolves.
- Collab layout 2: `COLLAB_LAYOUT_VERSION` is 2. Each prefab is a doc of its
  own with the scene entity layout (`prefabToDoc`, `docToPrefab`,
  `prefabPatch`), so concurrent edits to different children or fields merge.
  Scene docs drop their `prefabs` map (`DOC_MAPS.prefabs` stays as the
  layout-1 name). `migrateLayout(sceneDoc, projectWriter)` and
  `projectDocWriter` move a layout-1 doc's prefabs into prefab assets at
  load. A client whose sync token's `l` claim is older or newer than the
  doc's layout connects read-only.
- Prefabs are assets: a prefab file is a `prefab` asset of its project,
  edited in its own doc, and the editor's prefab ops write that doc in the
  same undo step as the scene.
- **Breaking:** `./vite`: `writePrefabFiles` is removed; every scene home is
  a project, whose prefabs change through `applyProjectBatchToFiles`.
- The scene CLI's `GAMES` table, `gameScenesDirs` and `gameSchemaFiles` are
  gone: every `jams.project.json` names its game, and `ToolContext` takes
  `projects`.
- Concurrent `replaceContent`s now resolve to one writer's hash, size and
  meta together (never a mix).
- The dev server sends `asset:changed` whenever a binary's hash changes (a
  client's `replaceContent`, a disk re-export or a hash repair), not only on
  disk edits, and re-inspects binaries on store.
- A `data-table` asset in a project with no game takes any table name, its
  rows needing only ids; the game a run names judges the rows when it reads
  them (`ctx.project.table`). A game without tables still refuses every
  table.
- The engine's own project (`src/engine/scenes/jams.project.json`) holds a
  `bouncy` material asset the kitchen sink's `ledge` uses, a
  `game-settings` doc and a `card` data table (`data/cards.json`);
  `engine-yard.checks.json` and `kitchen-sink.checks.json` are in
  `formatChecks`' canonical form.

### Fixed

- An `editScene` that removes a prefab (`definePrefab` with `null`) is
  refused with `asset-in-use` and `detail.referrers` while another live
  asset still names the prefab, live and on files alike. `checkProjectBatch`
  judges it, and a `deleteAsset` without `force`, once the whole batch has
  run, against what the batch leaves every referrer (a delegated
  `editScene`'s scene included): removing the last instances in the same
  batch, here or in another scene, or deleting the referrer still works,
  and a reference another op of the batch adds is refused before anything
  is written. A delegated `editScene` is judged the way it is written,
  after the batch's other edits of its scene: ops that don't apply to what
  they leave it fail the batch at that op, and so does one that defines or
  changes a prefab an earlier op of the batch removed (`op-invalid`). In
  the editor, the scene's own prefab writer judges a removal against the
  docs the browser holds open. The dev server restores a trashed asset
  that a doc it holds still names, on store and when such a doc loads; it
  doesn't read docs nobody has open, so a forced delete stays trashed
  while its referrers are closed.
- `scene apply` reports the unchanged file's `sceneHash` when the project
  refuses the batch, so a retry with `--base` that hash isn't stale.
- A material's bulk keys (`solid:<material>`, a prefab's `bulk` too) and
  instance overrides that set a material field are references: `deleteAsset`
  reports them as `asset-in-use`, a forced delete leaves them
  `asset-missing`, and `changeAssetId` moves the bulk entries to the new
  key (`addBulk` then `remove`) and rewrites the overrides (`override`).
  `RefSite` gains `in?: "key"` for a site whose id is the end of the key
  it points at, and `rewriteRefs` renames such a key, joining arrays when
  the new key is there already.
- `changeAssetId` follows a keyed collection's own id field:
  `rewriteRefs(value, sites, from, to, layout?)` matches `@<id>` by the
  layout's `id`. A site that still names the old id after the rewrite
  fails the op with `op-invalid` instead of being written back, and a
  scene or prefab that wouldn't read under the new ids (each rewritten one,
  and every one when a material changed id) fails the batch.
- A project holds at most one game-settings asset: `projectView` (with
  kinds) reports a second as `asset-kind` (so `project show` lists it, the
  dev server warns on load and `project push` refuses it), and
  `createAsset` or `restoreAsset` of a second is refused with `asset-kind`.
- A data-table row id that two assets of one table hold is reported as
  `dup-id` (`detail: { table, first }`): by `project show`, by the dev
  server when it loads the project, and on `checkProjectBatch`'s result
  for every table the batch wrote.
- `projectView` treats two folders that differ only in case as taken:
  the later entry gets `path-taken` and a repair under the first entry's
  spelling, and `createAsset`, `renameAsset`, `moveAsset` and
  `restoreAsset` refuse such a path.
- `registry.primitives` beside a game's registry now carries the project
  materials passed to `createRegistry(game, { materials })` /
  `withProject`, so a scene with no game run under a game keeps its
  project's materials.
- Code skew: a newer build whose stamp was held back while project-doc
  updates waited on missing ones now writes it once they land, even when
  they don't touch the build map.
- Code skew hashes each kind's schema under the game's code alone
  (`buildHashes` in collab/project-session.ts), so a registry carrying the
  project's material assets no longer makes a CLI or tab read-only against
  the dev server.
- The dev server's file adapter judges scenes and other docs by the
  project's material assets (its open material docs, else their files), so
  a scene naming a material asset scans, loads and writes back.
- `reinspectBlobs` re-derives meta after a move, for meta that names paths
  (a font's pages).

### Agent surface

- `AGENT_SURFACE_VERSION` 7: the project ops `createAsset`, `importAsset`,
  `renameAsset`, `moveAsset`, `deleteAsset`, `restoreAsset`,
  `changeAssetId`, `setImport`, `replaceContent`, `setLicence`, `editAsset`
  and `editScene` (`project-ops:v1`; `public-api.json` lists them as
  `projectOpNames`); the issue codes `asset-missing`, `asset-kind`,
  `asset-in-use`, `asset-id-taken`, `path-taken`, `hash-mismatch`,
  `code-skew` (a warning: the doc stays readable, but read-only),
  `asset-too-large`, `import-failed` and `quota-exceeded`, none with a
  scene fix, since project ops and server repairs mend them; the schema ids
  `urn:jams-engine:project:v1`, `asset-sidecar:v1`, `project-ops:v1`,
  `project-snapshot:v1`, `material:v1`, `game-settings:v1` and
  `data-table:v1`, each a schema file in the package exports; every
  published schema carries `x-agent-surface: 7`.
- MCP tools `project_tree`, `asset_import` (dry run by default),
  `asset_refs` and `asset_apply_ops` (dry run by default), in file and live
  mode; every tool takes `project?`, and `scene_schema`'s `which` takes any
  schema name the CLI serves.
- New schema files `./schemas/material.schema.json`
  (`urn:jams-engine:material:v1`), `./schemas/game-settings.schema.json`
  (`urn:jams-engine:game-settings:v1`), `./schemas/data-table.schema.json`
  (`urn:jams-engine:data-table:v1`) and `./schemas/project-ops.schema.json`
  (`urn:jams-engine:project-ops:v1`, built from `projectOpBatchSchema` by
  `projectOpsJsonSchema`).
- New schema file `./schemas/project-snapshot.schema.json`
  (`urn:jams-engine:project-snapshot:v1`, built from
  `projectSnapshotSchema` by `projectSnapshotJsonSchema`).
- `checkProjectBatch` and `applyProjectBatch` accept `editAsset`,
  `editScene` and `changeAssetId`. `deleteAsset` is refused with
  `asset-in-use` while referenced once the whole batch has run, unless
  `force`; so is an `editScene` whose `definePrefab` `null` removes a
  prefab another live asset still names.
- The scene CLI works on projects: every `jams.project.json` under `src/`
  (`discoverProjects`), with `--project <id>` on every command; a scene or
  asset id two projects hold exits 2 until `--project` picks one.
- New CLI commands `project show`, `project tree [--live]`,
  `project refs [id] [--live]` and `project snapshot [--out]`;
  `assets list [--kind] [--trash] [--live]`,
  `assets import <file> [--path] [--id] [--kind] [--settings]`,
  `assets rename <id> [--name] [--file]`, `assets move <id…> --to`,
  `assets delete <id> [--force]`, `assets restore <id>`,
  `assets change-id <id> <new-id>`, `assets set-import <id> --set` and
  `assets apply --ops`. Every `assets` writer takes `--dry-run` (writes
  nothing: no file, cache or upload), `--live [--url]` (the dev server's
  docs, as an agent), `--agent`, `--on-behalf-of`, and on files `--base`
  (the project snapshot hash; stale exits 3).
- `assets import` uploads a binary's bytes first
  (`POST /__project/<id>/blob`, or the dev cache on files), then applies
  `importAsset`.
- `fmt [asset]` formats any doc kind through the kind's format, or every doc
  asset.
- `schema` serves project, asset-sidecar, project-ops, project-snapshot,
  material, game-settings, data-table and any doc kind, and its usage line
  lists fragment and prefab.
- `apply --live` runs on the project client as one `editScene` op, so
  prefab ops write their prefab docs.
- On files, a scene in a project resolves its prefabs through the project's
  registry: every live prefab asset under the project's globs, at its path,
  whatever its file name (`validate`, `list`, `show`, `step`, `apply` and
  the rest). Only a scene file outside every project still reads
  `prefabs/` beside it.
- `apply` on files, in a project, sends the batch as one `editScene` op
  through `applyProjectBatchToFiles`, as `--live` does, writing prefab
  files, sidecars, registry and dev cache the way `assets apply` does. A
  changed prefab goes back to its asset's file and a new one to `prefabs/`
  beside the scene (`prefabPathNear`). A prefab id another asset holds is
  refused with `asset-id-taken`, a path another asset or an unlisted
  file holds with `path-taken`, and a `definePrefab` with `"prefab": null`
  while another live asset still places the prefab with `asset-in-use`
  (and `detail.referrers`): exit 1 with `ok: false`, `failedAt`, `issue`,
  `sceneHash` and `written: false` in the data, nothing written, dry run
  included. That `sceneHash` is the unchanged file's, usable as `--base`
  for a retry. Otherwise a `definePrefab` with `"prefab": null` sends the
  prefab to the trash, where `assets restore` brings it back.
- `new` creates the scene as a `createAsset` op through
  `applyProjectBatchToFiles` and refuses an id or path another asset holds
  (`asset-id-taken` / `path-taken`): exit 1, nothing written, the issue in
  its result's `issue` with `written: false`.
- Hosted projects: every `--live` command (`apply`, `assets list`, the
  `assets` writers, `project tree` and `project refs`) takes a site `--url https://…` (`http://` only on
  localhost, since the token travels with every request) and an agent token
  (`--token`, else `JAMS_AGENT_TOKEN`). The CLI exchanges the token at
  `POST /api/engine/agent-sync-token` for 60 s project sync tokens and
  refreshes them before they expire. Edits carry the token's actor (`g` as
  `agentId`, `o` as `onBehalfOf`). Blobs go through
  `/api/engine/projects/<id>/blobs`. A read-only token can read and dry-run,
  but writes are refused.
- New CLI commands `project pull <project> --url … [--out dir] [--check]`
  (the hosted bundle formatted on the client into files and sidecars; every
  added, changed or removed file is reported; `--check` writes nothing and
  exits 1 on a difference) and `project push <dir> --create --url …`
  (uploads binaries, then seeds the agent token's reserved project from a
  `ProjectBundle`; refused if the project already holds anything;
  `--dry-run` checks the files and reads the hosted project, sending
  nothing).
- MCP: a live tool's `url` may be a hosted site only when the MCP server's
  environment has `JAMS_AGENT_TOKEN` and `JAMS_AGENT_SITE`, the site's
  origin; the token is sent to that origin only, so a tool argument can't
  redirect it, and is never a tool argument itself.

### Internal

- The boundary test keeps `./project` on zod and the project, scene and
  game files, and leaves `HocuspocusProviderWebsocket` (one socket shared by
  a project's docs) to hosts: the site's project session and the scene
  CLI's project client build it, never an engine source file.
- The site's engine route paths live in one dependency-free module
  (`src/lib/engine/route-paths.ts`) that the routes and the scene CLI's
  hosted client both import.
- `services/canvas-sync` copies `src/engine/project` and
  `src/engine/version.ts` into its image and serves the project and asset
  doc kinds beside scenes.

## [0.5.0] — unreleased

Prefabs, groups and attachment: a scene places prefab files as instances
with per-field overrides, groups carry a local origin so moving one is one
edit, and solids and sensors can ride a path follower's body. Every
consumer of world geometry reads one resolved view of the scene.

### Format

- Scene format v2. The v1 → v2 migration declares every group a v1 entity
  names at `[0, 0]`, so nothing moves; v1 files keep loading and are saved
  as v2. Two top-level keys after `settings`: `groups` (`{ [id]: { at,
name? } }`; a member stores its geometry relative to `at`) and
  `instances` (`{ id, prefab, at, overrides?, name?, layer?, group?, off?
}`, one per line). Entities and instances share ids. A prefab is
  `<scenes dir>/prefabs/<id>.json`: `{ kind: "prefab", v, game?, id,
contract?, entities, bulk? }` around a local origin. Override keys are
  `<childId>.<field.path>` (`door.path.speed`, `~solid:0.shape`), values in
  the prefab's frame.
- `attach: "<follower id>"` on `solid` and `sensor` (and types that spread
  their fields): the collider rides that follower's body at its offset from
  the follower's first path point; its shape stays in world px.
- Schema ids follow the format: `urn:jams-engine:scene:v2` and
  `urn:jams-engine:ops:v2` (and their game forms). Checks files and input
  scripts keep their own versions (`checks:v1`, `input-script:v1`).

### Added

- `./scene`: `resolveScene` / `resolveSceneDetailed` (instances inlined as
  `<instance>/<child>`, bulk children as `<instance>/~key:index`, group
  offsets applied, sibling references remapped; where each resolved entity
  came from), `toSourceBatch` (a batch written against the resolved view
  mapped onto the document: a child's edit becomes overrides, a group
  member's geometry loses the group's origin), `childRef`, `parseChildRef`,
  `localChild`, `localChildren`, `groupOrigin`, `instanceOrigin`.
- Prefabs: `parsePrefab`, `prefabSchemaFor`, `prefabJsonSchema`
  (`./schemas/prefab.schema.json`), `formatPrefab`, `prefabLibrary`,
  `prefabOf`, `prefabBody`, `prefabScene`, `sceneBody`, `prefabsUsedBy`,
  `sceneHashWith` (a scene's hash with the prefabs it uses, so a prefab
  edit makes recordings stale), `PREFABS_DIR`; `fragmentJsonSchema`
  (`./schemas/fragment.schema.json`); `placeFragment`, `nextFreeId` and
  `takenIds`, shared by paste and unpack.
- `GameDefinition.prefabContract`: the fields of a prefab's `contract`,
  a zod shape like `settings`; without it a prefab carries none.
- `expandScene`, `validateScene`, `applyOps`, `preparePlay`,
  `runPlaytest`, `fuzz`, `replayRecording`, `runChecks`,
  `validatePhysical` and the SVG and ASCII renders take `prefabs`;
  `GameConfig.prefabs` and `GameInstance.setPrefabs` for the shell.
- The collab doc holds `groups`, `instances` (overrides as a per-key
  `Y.Map`, so concurrent overrides of different fields merge) and
  `prefabs` maps (`groupsMap`, `instancesMap`, `prefabsMap`,
  `contentMaps`, `docPrefabs`); `sceneToDoc` seeds a home's prefabs, the
  dev server writes changed prefabs back to `prefabs/*.json` and syncs
  prefab files changed on disk into every open scene of that home.
- `EditorSession.getResolved()`, `getPrefabs()` and `dispatch(batch, {
resolved: true })`; the tool host picks, draws and edits the resolved
  view, so instance children can be picked and edited as overrides.
- Attachment: `EngineContext.attachments` (`AttachmentHub`),
  `carrierDelta` (the follower motion under any collider on its body),
  `ColliderTag.carrier`; `createRiders` for systems that attach.
- `./vite`: `readPrefabFiles`, `writePrefabFiles`, `prefabsDirOf`,
  `prefabPath`.
- Open prefab: `openPrefabIsolation(session, id)` edits a prefab as a
  scene of its own at its local coordinates (`isolationBounds`), on a
  scratch doc whose every batch lands in the scene's doc as one
  `definePrefab`, so instances follow and the scene's undo covers it;
  undo there steps the scene's history back through its own edits only,
  and changes from anywhere else are diffed in. `EditorSessionOptions.history`
  (`SessionHistory`) lets a session undo and list history elsewhere.
- `scenes/kitchen-sink.json`, with its prefabs `post` and `gate` and
  `kitchen-sink.checks.json`: one gameless scene holding every engine
  primitive, a bulk solid of each shape form, a group, two prefabs with
  overridden instances, and a solid and a sensor attached to a follower,
  with a note per region. Its `touches` check is skipped without a game:
  the engine's own collision groups don't let props touch sensors.

### Changed

- `diffToOps` reorders surviving entities and instances in place
  (`reorder`) instead of removing and adding them, so a live doc keeps
  their keys.
- An attached one-way solid is gated by its collider's collision groups,
  not by moving its body; `castSpawn` and the physical checks skip
  colliders gated that way (queries pass `filterGroups`).
- The platformer's player movement filters by the player's collision
  groups, so a gated attached platform lets it through.
- `follower-hits-solid` also sweeps every solid attached to the follower
  (gated one-way ones too; attached sensors don't count).
- `follower-hits-solid`'s summary says what the sweep covers: "A path
  follower, or a solid riding it, swept along the path, runs into a
  solid."

### Agent surface

- `AGENT_SURFACE_VERSION` 6: the ops `reorder`, `instantiate`, `setGroup`,
  `override`, `revertOverride`, `applyToPrefab`, `unpack`, `createPrefab`
  and `definePrefab`, each with an inverse; the schema ids
  `urn:jams-engine:scene:v2`, `urn:jams-engine:ops:v2`,
  `urn:jams-engine:fragment:v2` and `urn:jams-engine:prefab:v2`; `scene
schema fragment|prefab` and `which: "fragment" | "prefab"` on the MCP
  `scene_schema`. `prefab-unknown` reports an instance whose prefab isn't
  loaded; `unused-override` (now a warning with a fix) one that names no
  child or field; an undeclared group is `dangling-ref` with a fix that
  declares it at `[0, 0]`.

### Internal

- The engine compiles under `noUncheckedIndexedAccess`
  (`src/engine/tsconfig.strict.json`, `vp run engine:typecheck:strict`, and
  the pack's dts build); `services/canvas-sync` turns the flag back on.
- A browser smoke (`vp run engine:smoke:browser`) runs engine-yard for 120
  ticks with `rapier2d-compat` in headless Chromium, Firefox and WebKit and
  compares each digest with the in-process run; CI runs it as
  `engine-browser-smoke`.
- Probes for Rapier's `lengthUnit` (`__tests__/probes/length-unit-probe.ts`,
  and the platformer's): setting it changes the traces, so the engine
  leaves it unset.

## [0.4.0] — unreleased

Run recording and replay: every Play and every headless playtest records
its input edges, the focus trail, the game's markers and a digest of the
end state, in one versioned, game-agnostic format that replays tick for
tick, headless or in the browser.

### Added

- `RunRecording` (`./scene`: `runRecordingSchema`, `parseRecording`,
  `recordingJsonSchema`, `RECORDING_VERSION`; packaged as
  `./schemas/recording.schema.json`): `v`, `engine` (version and physics
  build), `scene`, `sceneHash`, `game`, `configHash`, `tickRate`, `start`
  (Play's `at`, `timeOffsetMs` and game options as asked for), `actions`
  (a name table) and `inputs` (`[tick, actionIndex, pressed]` in step
  order), `ticks`, `outcome`, `markers`, an optional `trail` and `end`, a
  digest of the game's snapshot after the last tick.
- `./headless`: `replayRecording` replays a recording on a scene and says
  whether it `matches` (same result, ticks and end digest), how it
  diverged, and warns, without blocking, when the scene is stale (its hash
  changed), the tuning, engine version or physics build differ;
  `recordingDivergence`, `createRunRecorder`. `PlaytestReport.recording`
  carries every playtest's run.
- `GameInstance.replay(doc, recording)` plays a recording in the browser
  in place of the keyboard and pauses on its last tick;
  `GameInstance.recording()` and the `play:recorded` event give each Play's
  recording, finished at the game's first verdict, a replay's last tick or
  Stop.
- `GamePlayDef.markers`: the event types a recording keeps for the ghost
  (every event when omitted).
- `SceneSystem.seek(ms)`: time-driven systems move on before tick 0.
  Path followers implement it.

### Changed

- `PlayOptions.timeOffsetMs` is honoured: Play, playtests, fuzz and
  replays seek every system by it before tick 0, exactly as stepping that
  long would, and before `at` is cast.
- `ENGINE_RUN_RESULTS` adds `quit`, a browser run stopped before any
  outcome.
- `probeConfigHash` moved into the runtime so the browser shell can stamp
  recordings; `./headless` still exports it.

### Agent surface

- `AGENT_SURFACE_VERSION` 5: the schema id `urn:jams-engine:recording:v1`;
  the run result `quit`; the CLI command `replay <scene> --run <file|->`
  (exit 1 when a replay ends differently), `playtest --record <file>` and
  `schema recording`; the MCP tool `scene_replay` and `which: "recording"`
  on `scene_schema`.

## [0.3.0] — unreleased

Editor tools and the MCP surface: picking, gizmos, snapping, vertex and
path editing, a clipboard and a schema-driven inspector model, all pure
and driven by one tool host; physical validation and `.checks.json`; and an
MCP adapter that edits live docs as a Yjs client.

### Added

- `./editor`, the tool layer:
  - the tool contract (`EditorToolDef`, `EditorToolContext`, `EditorTool`,
    `ToolOverlay`, `defineEditorTool`): a tool gets world-space pointer
    events, commits one batch per gesture through `commit`, previews in the
    edit world through `preview`, and describes what to draw as a
    `ToolOverlay` the host renders;
  - `createToolHost`, which mounts tools as one router consumer at
    `TOOL_PRIORITY.editor`, keeps a spatial index current from the session,
    counts clicks, runs the Escape cascade, and carries the default
    commands (nudge, rotate ±15°, select all, group, hierarchy walk, frame,
    snap toggle, copy, cut, paste, duplicate); the keymap's `sub-object` and
    gesture context come from `host.keyContext()`;
  - built-in tools `select` (click, Shift, Mod, Alt-cycle, marquee and
    Alt-marquee, drag-move with snapping, handles, one AABB gizmo for a
    multi-selection, sub-object point editing with a **Convert to chain**
    offer on a concave commit), `box`, `circle`, `pen`, `waypoints`,
    `rotate` and `pan`;
  - `createGesturePreview` (a drag shows in the runtime through its update
    fast path and never writes the doc);
  - the pure geometry under them: `createSpatialIndex` (a 256px grid of
    AABBs, updated from touched refs), `pickAt`, `cycleHit`,
    `marqueeSelect`, `snapPoint`, `snapMove` (grid, then edges and
    vertices, then centres; the grabbed AABB edge snaps), `snapAngle`,
    and `gizmos` (handles per shape, resize with the opposite edge
    anchored, Alt from the centre, Shift keeping aspect, rotate with a 15°
    snap, vertex insert and delete keeping poly ≥ 3 and chain ≥ 2,
    waypoint editing, readouts, each gesture as one `OpBatch`);
  - `copySelection`, `pasteFragment`, `cutSelection`, `duplicateSelection`
    over a `SceneFragment` (`text/plain` JSON): paste centres under the
    cursor, snaps, regenerates ids, remaps internal references and keeps
    or clears external ones with an issue;
  - `buildInspectorModel`: sections and a widget per field from the type's
    schema (`.meta()` titles and groups, `.describe()` tooltips), mixed
    values for a multi-selection, relative edits (`+=16`), shape
    conversions marked lossless or lossy, and a game's own widgets;
  - `placementEditorTool`, a placement tool as an editor tool (one `add`
    per placement).
- `./game`: `GameDefinition.editor` (`tools`, loaded lazily so editor code
  stays out of a play bundle, and `widgets`, `InspectorWidgetDef`
  descriptors a field names in `meta.widget`), `physicalChecks` and
  `checks` (`.checks.json` kinds); `Registry.widgets`, `physicalChecks` and
  `checkKinds`; `createPlacementTool`, the ghost, rotate and place state
  machine the platformer's Shaper now uses.
- `GameInstance.screenToWorld`, `panBy`, `zoomAt` and `frame` for an
  editor camera.
- `./headless`: `validatePhysical` (the scene in a never-stepped world;
  the engine's `follower-hits-solid` and `solid-overlap`, then the game's
  checks), `physicalEnv` and `runPhysicalChecks` for a world that is
  already loaded, and `runChecks` for `.checks.json`.
- `./scene`: `parseChecks`, `checksSchemaFor` and `checksJsonSchema` (the
  `.checks.json` format, kinds `valid`, `reaches`, `touches` and a game's);
  `SceneFragment` and `parseFragment` (migrates a stale `v`);
  `intersectsRect`, `containedInRect`, `nearestVertex`, `nearestSegment`,
  `shapeVertices`, `closestOnSegment` and `rotateShape`.
- A `resized` scene change: a bulk entry with the same tag and centre and
  a new size.
- `src/engine/__tests__/api-report.txt`, the normalised `.d.mts` API
  report (`vp run engine:api-report --write`); CI fails on an unreviewed
  diff.

### Changed

- **Breaking:** `./editor`'s store type `EditorTool` (`"select"`) is gone;
  `EditorStoreState.tool` is a tool id string, and `EditorTool` now names
  a live tool.
- `diffToOps` turns a moved bulk entry into a `move` op and a resized one
  into an `update`, not a remove and an add.

### Agent surface

- `AGENT_SURFACE_VERSION` 4: issue codes `follower-hits-solid` and
  `solid-overlap`; the schema id `urn:jams-engine:checks:v1` (and
  `urn:jams-engine:checks:<game>:v1`); check kinds `valid`, `reaches` and
  `touches`; the CLI commands `check` and `textconv`, `validate
--physical`, `schema checks` and `--game` on `playtest`, `fuzz` and
  `check`; the MCP tools `scene_apply_ops`, `scene_check`, `scene_codes`,
  `scene_diff`, `scene_fuzz`, `scene_list`, `scene_playtest`,
  `scene_render`, `scene_schema`, `scene_show` and `scene_validate`.
  `public-api.json` now lists `checkKinds` and `mcpTools`.

## [0.2.0] — unreleased

Edit and play: Play builds a fresh world from a frozen copy of the
document and Stop throws it away; the editor gets a full scoped keymap;
and agents get headless playtests, fuzz rollouts and scene renders whose
outcomes come from the game.

### Added

- **Play and Stop** on `GameInstance`: `play(doc, opts?)` parses and
  validates the document (errors block and come back in the `PlayReport`),
  clones it, deep-freezes the clone and its expansion in dev, and builds a
  fresh world; input is flushed and the camera snaps. `stop()` destroys the
  play world, rebuilds the edit world from the scene loaded before Play and
  restores the editor camera exactly. `pause`, `resume`, `step(n)` and
  `setTimeScale` are public. `PlayOptions` (`at`, `timeOffsetMs`, `game`)
  is the same object for Play, `runPlaytest` and `fuzz`. Play from a point
  casts the game's `play.spawnShape` onto the first surface below and is
  refused inside a solid (`reason: "spawn-blocked"`). The store has a
  `session` (`startTick`, the game's first `outcome`), with `selectSession`;
  `play:outcome` is a new event. `command(name)`, `cancel()` and
  `pointerWorld()` let a host drive the game's commands, its Escape and
  "play from here".
- **Play hooks in the game contract** (`GameDefinition.play`): `outcome`
  after every tick (a result ends a playtest; the engine never decides
  one), `results`, `focus`, `movementActions` (for `stuck`), input-script
  `predicates`, a fuzz `macro` generator, `spawnShape` and an `options`
  schema for game-typed play options. `GameDefinition.editorKeys` adds
  game keys to the editor keymap, delivered to `GameAttachment.onCommand`
  (and Escape to `onCancel`). `EngineContext.play` tells a game's `onLoad`
  where a play world starts. `Registry.runResults` and `predicateNames`;
  a game can't reuse an engine result or predicate name.
- `SceneRuntime.load(scene, play?)` builds a play world.
- `./editor`: `createKeymap(gameKeys?)` with scopes `global`, `edit`,
  `play`, `sub-object` and `text-field`, `ENGINE_KEYS`, `keyChord` and
  `normalizeChord`. `Mod+Enter` plays, `Shift+Mod+Enter` plays from the
  cursor, `P` / `.` / `[` `]` pause, step and change time scale in play, F3
  cycles the debug overlay everywhere. A game key that collides with an
  engine key in its scope is reported as shadowed and never wins.
- The tool router takes keys from a key target (`GameConfig.keyTarget`,
  default the window) while pointers stay on the canvas, so editor
  shortcuts work with focus on a panel; consumers opt into keys typed in a
  text field with `editable`. `TOOL_PRIORITY.debug` (300).
- `./headless`: `compileInputScript` (input scripts with `hold`, `press`,
  `wait`, `for`, `forMs` and `until` over the engine's `event` and `tick`
  predicates and the game's, compiled to `[tick, action, pressed]` edges,
  unknown names with "did you mean"); `runPlaytest`, a `PlaytestReport`
  with `sceneHash`, `configHash`, the outcome (the game's result, or
  `timeout`, `script-end` or `stuck`), capped events, the focus trail every
  4 ticks, the steps reached, the final snapshot and the inputs played, or
  a `PlaytestBlocked` naming the stage that stopped it; `fuzz`, seeded
  macro-input rollouts reporting which entities were touched, first-reach
  ticks and "reached in N of M runs", result counts and measured ticks per
  second; `preparePlay`, the start of Play shared by all three.
- `./scene`: `inputScriptSchemaFor` and `inputScriptJsonSchema` (the
  game's actions, predicates and options); `renderSceneSvg`, a pure
  schematic drawn through `shapeOutline` (region or `around` a ref with a
  margin, longest side capped at 1600px, labels, axis ticks, colors from
  each type's style, overlays for issues, a playtest's trail, events and
  outcome, follower paths and markers); `sceneAsciiMap` /
  `renderSceneAscii`, a character map whose legend comes from the types.
  `EntityTypeDef.ascii` sets a type's character.
- `./sim-kit`, a new entry with no dependencies: the seeded `Rng` (sfc32),
  `digest32` and the fixed-point maths, moved from the site's arcade, which
  now imports them from here.
- `./schemas/input-script.schema.json`, the engine's input-script JSON
  Schema, in the tarball.

### Changed

- **Breaking:** `GameDefinition.outcome(events, snapshot)` returning
  `{ status }` is gone; a game puts `outcome(state)` returning
  `{ result, cause?, entityId? } | null` in `play`, and `ProbeReport.outcome`
  is the first verdict with its tick. `PlaytestOutcome` is replaced by
  `GameOutcome`.
- **Breaking:** `./editor`'s `resolveEditorKey` and `EditorKeyContext` are
  replaced by `createKeymap`.
- **Breaking:** `./debug`'s `DebugDeps.inputTarget` is replaced by `router`;
  F3 is a router consumer instead of a `window` listener.
- `./headless` is no longer `@experimental`.

### Agent surface

- `AGENT_SURFACE_VERSION` 3: the schema id `urn:jams-engine:input-script:v1`
  (and `urn:jams-engine:input-script:<game>:v1` per game); the CLI commands
  `playtest`, `fuzz` and `render`, and `schema script`.

## [0.1.0] — unreleased

The first release: a game-agnostic engine that loads scenes from data, scene
format v1, the `SceneOp` command language, a headless runtime, shared scene
documents, and the editor core. It is the four pre-releases below plus the
packaging changes listed here.

**Contains:** the browser shell (`.`), with Rapier injected; the entity type
registry and the game-authoring API (`./game`); scene format v1, with
schema, parse, migrate, format, hash, expand and structural validation with
issue codes (`./scene`); `applyOps` with inverses, the entity diff and
`diffToOps`; the scene and ops JSON Schemas as package files; the headless
runtime and `runProbe` (`./headless`); the shared document (`./collab`); the
debug overlay (`./debug`); the dev sync server (`./vite`); and the editor
core (`./editor`). `./editor`, `./game` and `./headless` are
`@experimental`.

**Doesn't contain:** editor tools or gizmos, play-testing, input scripts,
rendering, the MCP adapter, prefabs, React, or anything game-specific.

### Added

- `README.md`, shipped in the tarball: install, peers, Rapier injection,
  registering entity types, a browser host, headless runs, scenes as data,
  co-editing, and a scene format reference generated from the JSON Schema.

### Changed

- **Breaking:** `GameConfig.rapier` is required. The root entry no longer
  falls back to `import("@dimforge/rapier2d")`, so no entry has a runtime
  reference to Rapier; browser hosts pass `rapier: () =>
import("@dimforge/rapier2d")`.
- `package.json` declares `"sideEffects": false`: no module does anything on
  import, and bundlers drop the barrels and scene tools a host doesn't use
  (4.9 kB of engine code off the site's game route).

### Agent surface

- Unchanged: `AGENT_SURFACE_VERSION` is still 2.

## [0.1.0-dev.4]

Scenes become shared documents: the editor co-edits a `Y.Doc` that any
number of people, agents and the disk write to, and every client converges
on the same canonical text.

### Added

- `./collab`, a new entry (`yjs` and `fractional-indexing` are new peers):
  the doc layout (`entities` keyed by generated keys with a fractional `z`,
  `settings`, `scene`, `meta`, and a capped `log`); `sceneToDoc` and
  `docToScene`, which round-trip every scene file byte for byte;
  `applyOpsToDoc`, which checks a batch as `applyOps` does against the doc as
  it is and writes only the changed fields in one transaction, with a `log`
  entry naming the actor; the origin types (`user`, `agent`, `disk`,
  `migration`); `createSceneUndo`, an undo manager that tracks one client's
  origin, one batch per step, with the selection around each step;
  `revertEntry`; `bindSceneDoc`, which keeps an edit-mode runtime in step once
  per transaction; `watchIssues` and `validateDoc`, validation of the merged
  doc; `migrateDoc`; presence helpers over a structural `AwarenessLike`.
- `SceneRuntime.add`, `update` and `remove`: entity-level edits without a
  rebuild, through a system's `update` fast path when it has one (markers,
  solids, sensors). `GameInstance.runtime()` hands the loaded one to a host.
- `./scene`: `diffToOps(a, b, registry?)`, a batch that turns one scene into
  another; an entity on both sides with the same type is an `update`, so a
  live doc keeps its keys. Also exported now: `migrate`, `MIGRATIONS`,
  `hashText` and `ENGINE_REGISTRY_ID`.
- `./vite`: `sceneCollabServer`, an in-process Hocuspocus at
  `/__scene-collab` serving `scene:<name>` docs from the scene homes, storing
  canonical JSON back, and turning outside edits to a file into one `disk`
  transaction (`@hocuspocus/server` is an optional peer).

### Changed

- `./editor`: `createEditorSession` takes a `Y.Doc` and an origin. Undo and
  redo step only this client's batches; history is the doc's `log`, with
  every actor and `revert(id)`; selection is kept as doc keys so it survives
  other people's edits; presence is published through `awareness`. The store
  gained `history` and `peers`; `lastActor` is a `SceneOrigin`.
- `applyOps` refuses to demote an entity that has no geometry.

### Removed

- `./editor`: `markSaved`, `replaceDoc`, `session.history`, the store's
  `dirty` and `savedAt`, and the `apply` option. `createHistory` stays for
  tools that edit files.
- `./vite`: `sceneDevSink` and its POST write path with the 409; the GET
  endpoints remain.

### Agent surface

- `AGENT_SURFACE_VERSION` is 2. The scene CLI's `apply` gained `--live`,
  `--url`, `--agent` and `--on-behalf-of`: `apply <scene> --live` sends the
  batch to the dev server's shared scene doc as an `agent` client instead of
  writing the file. Exit code 3 (stale base) is for file batches only; a live
  batch that fails its `base` exits 1.

## [0.1.0-dev.3]

The scene format is complete for 0.1: every structural code has a fixture
and, where the repair is mechanical, a fix; old files have a migration path;
the JSON Schemas read as documentation; and the agent surface has its own
version.

### Added

- `./scene`: `AGENT_SURFACE_VERSION` and `AGENT_SURFACE_KEYWORD`;
  `createScene` and `EMPTY_SCENE_TEMPLATE`; `comparePointers`, the document
  order of two JSON Pointers; `undescribedProperties` and
  `untitledEntityFields`, which a game's tests run over its schemas.
- `./game`: `GameDefinition.template` and `SceneTemplate`, what a new scene
  of the game starts with.
- `src/engine/scenes/` holds scenes that name no game; `engine-yard.json`
  moved there from the test fixtures.

### Changed

- `validateScene` orders issues by severity, then engine and game issues
  together by where their `path` falls in the canonical text, instead of
  engine issues before game issues.
- A failed `applyOps` issue always has a `path`, a pointer into the batch
  (`/ops/<i>`, or `/base` for `stale-base`).
- Every entity field carries an inspector `title`: `type` and shape fields
  gained theirs, and `Path` has `title` and `group`.

### Format

- Still `v: 1`. The migration harness walks frozen copies of every
  released version (`scene/__tests__/fixtures/v1/`, and each game's own) to
  the current one, and pins their bytes.
- A game's types are versioned with the scene format: a change to them
  must be additive (new optional fields or types) until a game needs its
  own migrations.

### Agent surface

- Version 1. `codes --json` returns `{ agentSurface, codes }` instead of
  the bare groups; both JSON Schemas carry `x-agent-surface`.
- `poly-invalid` offers the convex hull as its fix where the field can't
  be a chain; `platformer/no-kill-plane` is fixable (adds a hazard along the
  bottom of the bounds).
- Op discriminators and the gravity tuple's items have descriptions.
- CLI: `diff <a> (<b> | --git <rev> | --ops <file>)` and
  `new <name> [--game id] [--from scene]`; `list` reports issue counts per
  scene; scenes without a game resolve from the `engine` home.
- `public-api.json` lists op names, schema ids and every command's flags,
  and a test pins the agent surface's hash to its version.

## [0.1.0-dev.2]

Drawing, input and scene loading go through seams, so `./headless` loads
no Pixi and a game draws without importing it.

### Added

- `./scene`: `shapeOutline`, `shapeIsClosed` and `PathCommand`, the outline
  of every shape (rotated box, circle, rotated capsule as one stadium, poly,
  open chain); `isExpandedScene`.
- `./game`: `drawShape`, which traces, fills and strokes a shape in a
  `Style`; the `SceneView` drawing interface (`draw`, `pose`, `remove` and
  `layer`, an opaque `ViewLayerHandle` for a game that draws its own) with
  `ViewLayer`; `Style`, `styleOf`, `drawEntity`, `bodyLocalShape`, and
  `VisualOptions` (`layer`, `draw: false`) on solid and follower options.
- Static geometry has a production visual: solids and sensors draw in
  their type's style on `terrain`, with the material's style winning; props
  and followers draw on `body` and follow their bodies each step.
- `Style.strokeWidth` and `Style.strokeAlpha`.
- `.`: `createPixiView`, `pixiContainer` and `PixiView`, the Pixi-backed
  scene view; the tool router (`GameInstance.router`, `TOOL_PRIORITY`,
  `ToolConsumer`, `ToolEvent`, `ToolRouter`), which gives each pointer and
  key event to one consumer by priority (play, game tools, editor tools);
  `GameConfig.inputTarget`; `CameraMode` and `SimState`.
- `DebugOverlay.setPhysics` and the `DebugTick` type.
- `CameraState.mode` and `GameStoreState.sim` (`paused`, `timeScale`).

### Changed

- `GameInstance.loadScene` and `GameConfig.scene` accept a
  `SceneDefinition` as well as an `ExpandedScene`, and expand it through
  the game's registry. A definition that fails to expand is a failed
  `LoadReport`, and the current scene keeps running.
- `SceneView` is a drawing interface instead of `{ world: Container }`:
  `GameShell.view` is a `SceneView`, and `GameShell.router` replaces
  `GameShell.target`.
- Input comes from `inputTarget`, by default the canvas, which gets
  `tabIndex = 0` when it has none and is focused on start and on
  `setMode("play")`, instead of from `window`. Keys reach the game only
  while it has focus, pointer positions are canvas-local, and a key press
  in a text field reaches no consumer. Held keys are released when the
  target loses focus or the tab is hidden.
- The debug overlay rebinds to each loaded runtime instead of holding the
  first world, and `DebugOverlay.update` takes a `DebugTick`; a custom
  overlay factory must implement `setPhysics`.
- Each load sets the camera's bounds from the scene's bounds plus a 100px
  margin and snaps to the game's camera target, so a load doesn't pan in.
- The loop pauses while the tab is hidden and resumes without a catch-up
  burst.
- The physics wireframes draw every collider shape with its rotation, not
  only cuboids.

### Removed

- `addToLayer` from `./game`; layers belong to the Pixi view.

## [0.1.0-dev.1]

The engine no longer knows any game. The platformer moved to
`src/games/platformer` and is the first game built on the extension points.

### Added

- `@jams/engine/game` (experimental): `defineGame`, `defineEntityType`,
  `createRegistry` and `RegistryError`; field builders (`shapeField`,
  `bodyShapeField`, `pointField`, `materialField`, `tagsField`, `PathSchema`,
  `primitiveFields`); and the system-authoring API: `EngineContext`,
  `SceneSystem`, `ColliderTag(s)`, collider and body builders, and the
  primitive system factories (`createSolidSystem`, `createSensorSystem`,
  `createPropSystem`, `createMarkerSystem`, `createFollowerSystem`) with
  option bags, so a game composes them instead of re-implementing them.
- Engine primitives: `solid` (with `material` and `oneWay`), `sensor` (with
  `tags`), `marker`, `prop`, `follower` (a kinematic path follower) and
  `note`.
- A game supplies entity types, spawn order, actions and bindings,
  materials, collision groups, settings fields, issue codes, validators and
  per-runtime hooks (`onLoad`, `beforeStep`, `afterStep`, `snapshot`,
  `cameraTarget`, `storeSlice`, `debugInfo`), plus `attach` for play-mode
  tools in the browser shell.
- Sensors raise `sensor:enter` and `sensor:exit` with `other`, the entity
  that entered or left.
- `GameConfig.game` (required), `GameConfig.registry`,
  `GameConfig.debugLayers` and `GameInstance.registry`; `selectGame`.
- The debug overlay takes game layers; F3 cycles the engine's grid and
  physics layers, then the game's.

### Changed

- The package moved from `src/game` to `src/engine`.
- `StepResult` is `{ tick, events, game }`: `game` is the game's snapshot,
  in place of `player`. `RuntimeStats.perType` replaces `perBehavior` and
  `fields`. `SceneRuntimeHandle` has `ctx`, `game` and `scene()`.
- World gravity comes from the scene's `settings.gravity`.
- Parse, expand, validate, `applyOps` and the editor session take a
  registry. `formatScene`, `sceneHash` and `diffScenes` don't need one.

### Removed

- `DEFAULT_BINDINGS`, `PlayerInfo`, `selectPlayer`, `selectPlayerPosition`,
  `selectPlayers`, `DEBUG_MODES`, and every platformer type, system,
  material and constant (the player, grapple, Shaper, constructs, wind and
  bounce pads, clouds, movers).

### Format

- Still `v: 1` (unreleased): the entity discriminator is `type` (was `b`);
  a scene names its game with a top-level `game` key and gets a `settings`
  block; bulk keys come from registered types. M1 files are rewritten in
  place, with no migration.

### Agent surface

- Issue codes: added `unknown-type` and `unknown-game`; `spawn-missing`,
  `spawn-overlap`, `wind-rotation`, `no-goal` and `no-kill-plane` left the
  engine and are now the platformer's `platformer/<code>`. Game codes are
  always `<game-id>/<code>`.
- Ops: removed `setSpawn` and `removeSpawn` (spawns are entities or bulk
  entries of a game's type); added `setSettings`. `SceneChange` names
  `type`, not `behavior`.
- JSON Schemas are per registry: `urn:jams-engine:scene:v1` for the
  engine's primitives, `urn:jams-engine:scene:<game>:v1` for a game, which
  commits its own `scene.schema.json`.
- `./headless`: `runProbe` and `createHeadlessRuntime` take `game` and
  `registry`; `ProbeReport.final` is the game's snapshot, `landings` is
  gone, and `probeConfigHash(game)` replaces `CONFIG_HASH`.

## [0.1.0-dev.0]

### Added

- `@jams/engine` as a package rooted at `src/game`, with six entries: `.`,
  `./scene`, `./editor` (experimental), `./headless`, `./debug` and `./vite`,
  built by `vp run engine:pack`.
- Scenes as data: `createGame({ scene })`, `GameInstance.loadScene`,
  `unloadScene`, `setMode("edit" | "play")` and `selectMode`.
- `SceneRuntime` with load, unload, per-entity lookup and `step`, whose
  events name entities by id.
- `./headless`: `createHeadlessRuntime` and `runProbe`, DOM-free.
- `./editor`: `createEditorSession` with `OpBatch` undo history, selection,
  the outline model, the keymap resolver and the editor store.
- `./vite`: `sceneDevSink({ dir })`, the dev-server endpoints under
  `/__scene`, and `resolveScenePath`, the name and path guard tools share.
- `ENGINE_VERSION`.

### Changed

- Rapier is injected through `GameConfig.rapier`; the default loader stays
  until 0.1.
- `GameConfig.dev` replaces `import.meta.env.DEV` inside the engine, and
  the debug overlay is injected through `GameConfig.debug`, so a production
  host that leaves it out doesn't bundle it.
- Collider tags, force fields and every former module-level registry are
  per runtime, so two games or a game and a headless runtime can coexist.
- The level is no longer hardcoded in `physics.ts` and `engine.ts`; it is
  `src/game/scenes/test-yard.json`. The spawn is the player's feet.
- Wind force follows the zone's rotation instead of mirroring it.
- Poly colliders accept either winding; the player passes through sensors
  instead of standing on them.
- Each system draws into a fixed layer of the scene view (`DRAW_LAYERS`),
  so draw order no longer depends on spawn order.
- Game input ignores key presses in edit mode, in text fields and with
  Ctrl, Cmd or Alt held, so it no longer swallows editor shortcuts.

### Format

- Scene format `v: 1` introduced: `SceneDefinition`, its Zod schema
  `SceneV1`, `parseScene`, `formatScene` (canonical text), `sceneHash`,
  `expandScene` and `validateScene`.

### Agent surface

- Issue codes: every code in `ISSUE_CODE_LIST`, with severities, summaries
  and hints in `ISSUE_CODES`.
- Ops: `add`, `addBulk`, `update`, `move`, `place`, `remove`, `rename`,
  `promote`, `demote`, `setSpawn`, `removeSpawn`, `setScene`, applied by
  `applyOps` with inverses and an entity diff.
- JSON Schemas `urn:jams-engine:scene:v1` and `urn:jams-engine:ops:v1`,
  shipped as `schemas/scene.schema.json` and `schemas/ops.schema.json`.
- CLI (`vp run scene`, site-side): `list`, `show`, `schema`, `codes`,
  `validate`, `fmt`, `apply`, `step`, with `--json` and exit codes 0 ok,
  1 errors, 2 usage, 3 stale base. Reports name the scene hash
  `sceneHash`; probe reports also carry `configHash`.
- `ApplyResult.remap`: where each start-of-batch ref went (shifted bulk
  index, promotion, demotion, rename), or `null` when removed.
- Op failures map entity and batch schema errors like `parseScene` does:
  a JSON Pointer `path` under `/ops/<i>`, `expected`, `got`, and a
  did-you-mean for keys and behaviors.
- `./scene` exports `closest`; `./headless` exports `PROBE_ACTIONS`,
  `unknownActionError` and `CONFIG_HASH`, and `runProbe` throws on an
  unknown action.
- `POST /__scene/:name` takes `?base=<hash>` and answers 409 when the file
  changed since; writes need `application/json` and a same-origin caller.
