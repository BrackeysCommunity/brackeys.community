# Changelog

All notable changes to `@jams/engine`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package
uses its own semver: on 0.x a breaking change bumps the minor. Besides the
usual sections, **Format** records scene format (`v`) changes and **Agent
surface** records issue codes, ops, JSON Schemas and CLI commands, all of
which are public contract.

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
