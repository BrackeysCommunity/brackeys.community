import { closest } from "@jams/engine/scene";

import { failure, scopeError, usage, type ToolContext, type ToolResult } from "./context";
import { apply } from "./tools/apply";
import { applyLive } from "./tools/apply-live";
import { assetsApply, type WriterFlags } from "./tools/assets-apply";
import { assetsChangeId } from "./tools/assets-change-id";
import { assetsDelete } from "./tools/assets-delete";
import { assetsImport } from "./tools/assets-import";
import { assetsInfo } from "./tools/assets-info";
import { assetsList } from "./tools/assets-list";
import { assetsMove } from "./tools/assets-move";
import { assetsRename } from "./tools/assets-rename";
import { assetsRestore } from "./tools/assets-restore";
import { assetsSetImport } from "./tools/assets-set-import";
import { bundle } from "./tools/bundle";
import { check } from "./tools/check";
import { codes } from "./tools/codes";
import { diff } from "./tools/diff";
import { flow } from "./tools/flow";
import { fmt } from "./tools/fmt";
import { fuzz } from "./tools/fuzz";
import { GAME_BUILD_USAGE, gameBuild } from "./tools/game-build";
import { GAME_EXPORT_USAGE, gameExport } from "./tools/game-export";
import { GAME_MANIFEST_USAGE, gameManifest, replayRelease } from "./tools/game-manifest";
import { GAME_NEW_FLAGS, gameNew } from "./tools/game-new";
import { grid } from "./tools/grid";
import { input } from "./tools/input";
import { list } from "./tools/list";
import { newScene } from "./tools/new";
import { playtest } from "./tools/playtest";
import { projectPull } from "./tools/project-pull";
import { projectPush } from "./tools/project-push";
import { projectRefs } from "./tools/project-refs";
import { projectShow } from "./tools/project-show";
import { projectSnapshot } from "./tools/project-snapshot";
import { projectTree } from "./tools/project-tree";
import { render } from "./tools/render";
import { replay } from "./tools/replay";
import { save } from "./tools/save";
import { schema, SCHEMA_NAMES } from "./tools/schema";
import { show } from "./tools/show";
import { step, STEP_FLAGS, type StepInput } from "./tools/step";
import { textconv } from "./tools/textconv";
import { validate } from "./tools/validate";

export type ParsedArgs = { positionals: string[]; flags: Record<string, string | string[] | true> };

type Command = {
  usage: string;
  summary: string;
  /** Flags that take a value; the rest of `flags` are switches. `json` and `project` are accepted everywhere. */
  values: readonly string[];
  /** Value flags that may repeat; their values arrive as an array in flag order. Every other value flag keeps its last value. */
  repeatable?: readonly string[];
  switches: readonly string[];
  maxPositionals: number;
  run: (args: ParsedArgs, ctx: ToolContext) => Promise<ToolResult>;
};

const str = (v: ParsedArgs["flags"][string] | undefined) => (typeof v === "string" ? v : undefined);
const strs = (v: ParsedArgs["flags"][string] | undefined) => (Array.isArray(v) ? v : undefined);

/** Every writer's flags: `--live` sends the batch to the dev server, or with a site `--url` to a hosted project, instead of the files. */
const WRITER_VALUES = ["url", "token", "agent", "on-behalf-of", "base"] as const;
const WRITER_SWITCHES = ["dry-run", "live"] as const;
const WRITER_USAGE =
  "[--dry-run] [--base hash] [--live [--url ws://…|https://site [--token t]]] [--agent id] [--on-behalf-of user]";

function writerFlags(flags: ParsedArgs["flags"]): WriterFlags {
  return {
    live: flags.live === true,
    dryRun: flags["dry-run"] === true,
    url: str(flags.url),
    token: str(flags.token),
    agent: str(flags.agent),
    onBehalfOf: str(flags["on-behalf-of"]),
    base: str(flags.base),
  };
}

/** A reader's live flags: `--live` reads the dev server's docs, or with a site `--url` a hosted project's. */
const LIVE_READ_USAGE = "--live [--url ws://…|https://site [--token t]]";

function liveReadFlags(flags: ParsedArgs["flags"]) {
  return { live: flags.live === true, url: str(flags.url), token: str(flags.token) };
}

/** Commands named by two words: `project show`, `assets import`. */
export const COMMAND_GROUPS = ["project", "assets", "game"] as const;

const DEFINITIONS = {
  list: {
    usage: "list",
    summary: "every scene with its game, hash, issue counts, entity counts and bounds",
    values: [],
    switches: [],
    maxPositionals: 0,
    run: (_a, ctx) => list({}, ctx),
  },
  show: {
    usage: "show <scene|file|-> [--ref id] [--type t] [--near x,y,r]",
    summary:
      "entities and bulk entries with refs, AABB and top span, the scene hash, and the time model and physics backend",
    values: ["ref", "type", "near"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      show({ scene, ref: str(flags.ref), type: str(flags.type), near: str(flags.near) }, ctx),
  },
  schema: {
    usage: `schema [${SCHEMA_NAMES.join("|")}|<doc kind>] [--game id]`,
    summary:
      "a JSON Schema the engine serves: a game's scene, op batch, script, checks, fragment, prefab or doc kind; the recording, project, sidecar, project-op, snapshot and save schemas",
    values: ["game"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [which], flags }, ctx) => schema({ which, game: str(flags.game) }, ctx),
  },
  codes: {
    usage: "codes",
    summary:
      "every issue code, the engine's then each game's, with severity and summary, with migration-unresolved's hint and the 0.x keys deprecation note",
    values: [],
    switches: [],
    maxPositionals: 0,
    run: (_a, ctx) => codes({}, ctx),
  },
  flow: {
    usage: "flow [--project p] [--json]",
    summary:
      "the scene list of each project in scope: the start, each listed scene's physics and bundle bytes, the scenes it leaves out, and its issues (start-scene-missing, entries naming no scene, checks naming a scene flow can't go to: scene-unlisted); exit 1 on an error",
    values: [],
    switches: [],
    maxPositionals: 0,
    run: (_a, ctx) => flow({}, ctx),
  },
  input: {
    usage: "input [--project p] [--player n] [--json]",
    summary:
      "each seat's bindings per action, layer by layer (the project's input map, then the game's), which one the seat uses, and their issues (binding-unknown, player-unknown); remaps live in browsers and never show; loads no Rapier; exit 1 on an error",
    values: ["player"],
    switches: [],
    maxPositionals: 0,
    run: ({ flags }, ctx) => input({ player: str(flags.player) }, ctx),
  },
  validate: {
    usage: "validate <scene|file|-> [--physical]",
    summary:
      "parse and structural issues, and with --physical the physics world's; exit 1 on errors",
    values: [],
    switches: ["physical"],
    maxPositionals: 1,
    run: ({ positionals: [target], flags }, ctx) =>
      validate({ target, physical: flags.physical === true }, ctx),
  },
  fmt: {
    usage: "fmt [asset] [--check]",
    summary:
      "rewrite a doc asset (scene, prefab, checks, input script, any doc kind) in canonical form, or every one; --check only reports",
    values: [],
    switches: ["check"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) => fmt({ scene, check: flags.check === true }, ctx),
  },
  apply: {
    usage:
      "apply <scene> --ops <file|-> [--dry-run] [--base hash] [--live [--url ws://…|https://site [--token t]] [--agent id] [--on-behalf-of user]]",
    summary:
      "apply an OpBatch; writes only when ok, error-free and not --dry-run; --live edits the dev server's doc or a hosted project's",
    values: ["ops", "base", "url", "token", "agent", "on-behalf-of"],
    switches: ["dry-run", "live"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) => {
      const common = {
        scene,
        ops: str(flags.ops),
        base: str(flags.base),
        dryRun: flags["dry-run"] === true,
      };
      if (flags.live === true)
        return applyLive(
          {
            ...common,
            url: str(flags.url),
            token: str(flags.token),
            agent: str(flags.agent),
            onBehalfOf: str(flags["on-behalf-of"]),
          },
          ctx,
        );
      const liveOnly = ["url", "token", "agent", "on-behalf-of"].find((f) => f in flags);
      if (liveOnly) return Promise.resolve(usage(`--${liveOnly} needs --live`));
      return apply(common, ctx);
    },
  },
  diff: {
    usage: "diff <scene|file|-> (<scene|file|-> | --git <rev> | --ops <file|->)",
    summary: "entity, bulk and scene changes between two scenes, a git revision, or an op batch",
    values: ["git", "ops"],
    switches: [],
    maxPositionals: 2,
    run: ({ positionals: [a, b], flags }, ctx) =>
      diff({ a, b, git: str(flags.git), ops: str(flags.ops) }, ctx),
  },
  new: {
    usage: "new <name> [--game id] [--from scene]",
    summary: "write a new scene from the game's template, or a copy of another scene",
    values: ["game", "from"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [name], flags }, ctx) =>
      newScene({ name, game: str(flags.game), from: str(flags.from) }, ctx),
  },
  step: {
    usage: `step <scene|file|-> ${STEP_FLAGS} [--legal]`,
    summary:
      "run the headless runtime and report events and the game's final snapshot, with spawns and destroys counted per type; --events type,… prints only those event types; --command and --elapse repeat; --command tick@seat:name sends from a seat (default 0), judged against the project input map's seats, else the game's; both are stepped on their ticks, each tick's @elapsed first, then its commands in flag order; --legal prints the commands legal after the last tick (at most 64, marked truncated beyond), for a game that lists them; --json carries them as legal/legalTruncated",
    values: ["ticks", "hold", "inputs", "command", "elapse", "events", "game"],
    repeatable: ["command", "elapse"],
    switches: ["legal"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) => {
      const input: StepInput = {
        scene,
        ticks: str(flags.ticks),
        hold: str(flags.hold),
        inputs: str(flags.inputs),
        command: strs(flags.command),
        elapse: strs(flags.elapse),
        events: str(flags.events),
        game: str(flags.game),
        legal: flags.legal === true,
      };
      return step(input, ctx);
    },
  },
  grid: {
    usage: "grid <scene> [--from c,r|ref] [--to c,r|ref] [--fov c,r:radius] [--diagonals] [--json]",
    summary:
      "the scene's grid as ASCII: walls, a path between two cells or entities, and what a cell can see; exit 1 with no path",
    values: ["from", "to", "fov"],
    switches: ["diagonals"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      grid(
        {
          scene,
          from: str(flags.from),
          to: str(flags.to),
          fov: str(flags.fov),
          diagonals: flags.diagonals === true,
        },
        ctx,
      ),
  },
  playtest: {
    usage:
      "playtest <scene|file|-> --script <file|-> [--at x,y] [--events type,…] [--game id] [--record file] [--flow] [--from-save file]",
    summary:
      "play an input script headless (actions, waits, game commands, time away), v1 or v2 (steps or tracks per seat, set/pointer/join/leave): the outcome, steps, events with spawns and destroys counted per type, and focus trail; a game that lists its commands (GamePlayDef.commands) prints how many are legal after the last tick (legal/legalTruncated in --json); --at is in metres; --events type,… prints only those event types; --flow follows scene requests through the scene list, --from-save starts from a save fixture; exit 1 when blocked",
    values: ["script", "at", "events", "game", "record", "from-save"],
    switches: ["flow"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      playtest(
        {
          scene,
          script: str(flags.script),
          at: str(flags.at),
          events: str(flags.events),
          game: str(flags.game),
          record: str(flags.record),
          flow: flags.flow === true,
          fromSave: str(flags["from-save"]),
        },
        ctx,
      ),
  },
  replay: {
    usage: "replay <scene|file|-> --run <file|-> [--game id] [--releases <dir>]",
    summary:
      "replay a run recording (or a playtest report's) headless: the recorded engine version and physics, `migratedFrom 1` for a v1 file, the platform line (recorded vs replayed) and recording-other-platform; with --releases, the release among those builds the run was made on; exit 1 when it ends differently",
    values: ["run", "game", "releases"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) => {
      const releases = str(flags.releases);
      return releases === undefined
        ? replay({ scene, run: str(flags.run), game: str(flags.game) }, ctx)
        : replayRelease({ scene, run: str(flags.run), game: str(flags.game), releases }, ctx);
    },
  },
  fuzz: {
    usage:
      "fuzz <scene|file|-> [--seed s] [--rollouts n] [--ticks n] [--game id] [--from-save file]",
    summary:
      "seeded random rollouts: which entities were reached, in how many runs, how early; a game that lists its commands and has no macro of its own is fuzzed by sending legal commands (every macro on a turns clock, half of them otherwise), counted on a legal line (legal.sent/legal.empty in --json); the default macro never holds a UI action; --from-save starts every rollout from a save fixture",
    values: ["seed", "rollouts", "ticks", "game", "from-save"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      fuzz(
        {
          scene,
          seed: str(flags.seed),
          rollouts: str(flags.rollouts),
          ticks: str(flags.ticks),
          game: str(flags.game),
          fromSave: str(flags["from-save"]),
        },
        ctx,
      ),
  },
  save: {
    usage:
      "save <scene|file> --script <file|-> --at <tick> --out <file>.save.json [--depth world|progress] [--now ms] [--flow]",
    summary:
      "run an input script to a tick and write a save fixture there (save:v1, world depth by default; the slot is the file's stem): inside a project it is imported as a save asset with its sidecar, or replaces the fixture already at that path; a world save that can't be taken is refused with save-unsupported and each cause; a run that ends before the tick saves nothing; meta.savedAt is --now (epoch ms, default 0), so saving the same run twice writes the same bytes; --flow follows scene requests through the project's scene list, so the save holds the scene, entry and persist the run reached",
    values: ["script", "at", "out", "depth", "now"],
    switches: ["flow"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      save(
        {
          scene,
          script: str(flags.script),
          at: str(flags.at),
          out: str(flags.out),
          depth: str(flags.depth),
          now: str(flags.now),
          flow: flags.flow === true,
        },
        ctx,
      ),
  },
  check: {
    usage: "check <scene|file> [--checks file] [--only id] [--game id]",
    summary:
      "run the scene's <scene>.checks.json (validation, playtests, fuzz, connected); exit 1 on a failure",
    values: ["checks", "only", "game"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      check(
        { scene, checks: str(flags.checks), only: str(flags.only), game: str(flags.game) },
        ctx,
      ),
  },
  render: {
    usage:
      "render <scene|file|-> [--out file] [--ascii] [--region r|--around ref --margin n] [--labels l] [--scale n] [--overlay f]",
    summary:
      "a schematic of the scene as PNG or SVG (longest side 1600px), or --ascii as a character map",
    values: ["out", "region", "around", "margin", "labels", "scale", "overlay"],
    switches: ["ascii"],
    maxPositionals: 1,
    run: ({ positionals: [scene], flags }, ctx) =>
      render(
        {
          scene,
          out: str(flags.out),
          region: str(flags.region),
          around: str(flags.around),
          margin: str(flags.margin),
          labels: str(flags.labels),
          scale: str(flags.scale),
          ascii: flags.ascii === true,
          overlay: str(flags.overlay),
        },
        ctx,
      ),
  },
  textconv: {
    usage: "textconv <file>",
    summary: "a scene as one sorted line per entity and bulk entry, for git diff",
    values: [],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [file] }, ctx) => textconv({ file }, ctx),
  },
  bundle: {
    usage: "bundle <scene|file>",
    summary:
      "the blobs a scene loads (ids, kinds, hashes, bytes) from its expanded entities, settings and asset headers; exit 1 on asset-missing",
    values: [],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [scene] }, ctx) => bundle({ scene }, ctx),
  },
  "project show": {
    usage: "project show [--project id]",
    summary: "a project's id, game, assets by kind, code modules, problems and storage usage",
    values: [],
    switches: [],
    maxPositionals: 0,
    run: (_a, ctx) => projectShow({ project: ctx.project }, ctx),
  },
  "project tree": {
    usage: `project tree [${LIVE_READ_USAGE}] [--project id]`,
    summary:
      "the project's folders, assets and read-only code modules, as the editor's tree shows them",
    values: ["url", "token"],
    switches: ["live"],
    maxPositionals: 0,
    run: ({ flags }, ctx) => projectTree({ ...liveReadFlags(flags), project: ctx.project }, ctx),
  },
  "project refs": {
    usage: `project refs [id] [${LIVE_READ_USAGE}] [--project id]`,
    summary:
      "what an asset names and what names it; without an id, every dangling reference; exit 1 on dangling ones",
    values: ["url", "token"],
    switches: ["live"],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) =>
      projectRefs({ ...liveReadFlags(flags), id, project: ctx.project }, ctx),
  },
  "project snapshot": {
    usage: "project snapshot [--out file|-] [--project id]",
    summary: "pins every live asset by content hash; the snapshot hash a file batch's base names",
    values: ["out"],
    switches: [],
    maxPositionals: 0,
    run: ({ flags }, ctx) => projectSnapshot({ project: ctx.project, out: str(flags.out) }, ctx),
  },
  "project pull": {
    usage:
      "project pull <project> --url https://site [--token t] [--out dir] [--check] [--project id]",
    summary:
      "a hosted project's docs and blobs as files and sidecars, formatted here; --check writes nothing and exits 1 on a difference",
    values: ["url", "token", "out"],
    switches: ["check"],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) =>
      projectPull(
        {
          id,
          url: str(flags.url),
          token: str(flags.token),
          out: str(flags.out),
          check: flags.check === true,
        },
        ctx,
      ),
  },
  "project push": {
    usage: "project push <dir> --create --url https://site [--token t] [--dry-run]",
    summary:
      "seed the agent token's new hosted project from a project's files: blobs uploaded, then every doc; refused if it exists; --dry-run sends nothing",
    values: ["url", "token"],
    switches: ["create", "dry-run"],
    maxPositionals: 1,
    run: ({ positionals: [dir], flags }, ctx) =>
      projectPush(
        {
          dir,
          url: str(flags.url),
          token: str(flags.token),
          create: flags.create === true,
          dryRun: flags["dry-run"] === true,
        },
        ctx,
      ),
  },
  "assets list": {
    usage: `assets list [--kind k] [--trash] [${LIVE_READ_USAGE}] [--project id]`,
    summary: "every live asset (or trashed one) with its kind, path, id, name and size",
    values: ["kind", "url", "token"],
    switches: ["trash", "live"],
    maxPositionals: 0,
    run: ({ flags }, ctx) =>
      assetsList(
        {
          kind: str(flags.kind),
          trash: flags.trash === true,
          live: flags.live === true,
          url: str(flags.url),
          token: str(flags.token),
        },
        ctx,
      ),
  },
  "assets info": {
    usage: "assets info <id> [--frame f] [--project id]",
    summary:
      "an asset's kind, hash and bytes, a texture's size, pivot, nine-slice and filter, an atlas's frames, tags and texture; --frame for one frame's size and pivot",
    values: ["frame"],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) => assetsInfo({ id, frame: str(flags.frame) }, ctx),
  },
  "assets import": {
    usage: `assets import <file> [--path p|folder/] [--id id] [--kind k] [--settings json] ${WRITER_USAGE}`,
    summary:
      "add a file: its bytes to the content store, then the file, its sidecar and registry entry",
    values: ["path", "id", "kind", "settings", ...WRITER_VALUES],
    switches: [...WRITER_SWITCHES],
    maxPositionals: 1,
    run: ({ positionals: [file], flags }, ctx) =>
      assetsImport(
        {
          ...writerFlags(flags),
          file,
          path: str(flags.path),
          id: str(flags.id),
          kind: str(flags.kind),
          settings: str(flags.settings),
        },
        ctx,
      ),
  },
  "assets rename": {
    usage: `assets rename <id> [--name text] [--file name.ext] ${WRITER_USAGE}`,
    summary: "change an asset's display name or file name in place; the id stays",
    values: ["name", "file", ...WRITER_VALUES],
    switches: [...WRITER_SWITCHES],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) =>
      assetsRename(
        { ...writerFlags(flags), id, name: str(flags.name), file: str(flags.file) },
        ctx,
      ),
  },
  "assets move": {
    usage: `assets move <id...> --to <folder/> ${WRITER_USAGE}`,
    summary: "move assets into a folder, sidecars included",
    values: ["to", ...WRITER_VALUES],
    switches: [...WRITER_SWITCHES],
    maxPositionals: 256,
    run: ({ positionals: ids, flags }, ctx) =>
      assetsMove({ ...writerFlags(flags), ids, to: str(flags.to) }, ctx),
  },
  "assets delete": {
    usage: `assets delete <id> [--force] ${WRITER_USAGE}`,
    summary: "move an asset to the trash; refused while something names it, unless --force",
    values: [...WRITER_VALUES],
    switches: ["force", ...WRITER_SWITCHES],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) =>
      assetsDelete({ ...writerFlags(flags), id, force: flags.force === true }, ctx),
  },
  "assets restore": {
    usage: `assets restore <id> ${WRITER_USAGE}`,
    summary: "bring an asset back from the trash",
    values: [...WRITER_VALUES],
    switches: [...WRITER_SWITCHES],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) => assetsRestore({ ...writerFlags(flags), id }, ctx),
  },
  "assets change-id": {
    usage: `assets change-id <id> <new-id> ${WRITER_USAGE}`,
    summary: "give an asset a new id and rewrite every reference to it, across docs",
    values: [...WRITER_VALUES],
    switches: [...WRITER_SWITCHES],
    maxPositionals: 2,
    run: ({ positionals: [id, to], flags }, ctx) =>
      assetsChangeId({ ...writerFlags(flags), id, to }, ctx),
  },
  "assets set-import": {
    usage: `assets set-import <id> --set <json|key=value,…> ${WRITER_USAGE}`,
    summary:
      "change a binary asset's import settings per field (null resets one); meta is re-inspected",
    values: ["set", ...WRITER_VALUES],
    switches: [...WRITER_SWITCHES],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) =>
      assetsSetImport({ ...writerFlags(flags), id, set: str(flags.set) }, ctx),
  },
  "assets apply": {
    usage: `assets apply --ops <file|-> ${WRITER_USAGE}`,
    summary: "apply a project op batch (schema project-ops), which may span docs",
    values: ["ops", ...WRITER_VALUES],
    switches: [...WRITER_SWITCHES],
    maxPositionals: 0,
    run: ({ flags }, ctx) => assetsApply({ ...writerFlags(flags), ops: str(flags.ops) }, ctx),
  },
  "game new": {
    usage: `game new <id> ${GAME_NEW_FLAGS}`,
    summary:
      "scaffold a game project under --dir (default src/games) from a preset (top-down, grid or turns): project file, game and UI modules, a scene with checks and a winning input script, game settings, an input map, the generated schemas and a test, with every world and time field written; refused, writing nothing, for an id outside the id pattern (schema), a taken id or an existing directory (project-id-taken), or a scene with error issues; prints the /game/dev URLs and the playtest command; --dry-run lists the files and writes none",
    values: [
      "name",
      "preset",
      "physics",
      "gravity",
      "time",
      "rate",
      "grid",
      "cell",
      "px-per-metre",
      "dir",
    ],
    switches: ["dry-run"],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) =>
      gameNew(
        {
          id,
          name: str(flags.name),
          preset: str(flags.preset),
          physics: str(flags.physics),
          gravity: str(flags.gravity),
          time: str(flags.time),
          rate: str(flags.rate),
          grid: str(flags.grid),
          cell: str(flags.cell),
          pxPerMetre: str(flags["px-per-metre"]),
          dir: str(flags.dir),
          dryRun: flags["dry-run"] === true,
        },
        ctx,
      ),
  },
  "game build": {
    usage: GAME_BUILD_USAGE,
    summary:
      "build a project into a static bundle under dist/: the listed scenes and their assets, the code, release.json, credits and, for the web target, the PWA files; prints the scenes and their physics, bytes per role, the wasm line, the size budgets and credits gaps; the bundle report is written beside the build at <out>.bundle-report/client.json; export-over-budget writes the build and exits 1 unless --allow-over-budget; a target with no row is export-target-unsupported",
    values: ["target", "out", "rapier"],
    switches: ["allow-over-budget"],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) =>
      gameBuild(
        {
          id,
          target: str(flags.target),
          out: str(flags.out),
          rapier: str(flags.rapier),
          allowOverBudget: flags["allow-over-budget"] === true,
        },
        ctx,
      ),
  },
  "game export": {
    usage: GAME_EXPORT_USAGE,
    summary:
      "build a project and zip it (stored, sorted, fixed times, so two zips of one build are equal); the itch target checks itch.io's HTML5 layout (export-itch-layout); nothing is uploaded",
    values: ["target", "out"],
    switches: ["zip"],
    maxPositionals: 1,
    run: ({ positionals: [id], flags }, ctx) =>
      gameExport(
        { id, zip: flags.zip === true, target: str(flags.target), out: str(flags.out) },
        ctx,
      ),
  },
  "game manifest": {
    usage: GAME_MANIFEST_USAGE,
    summary:
      "parse and check a release manifest, with the build's files and their hashes when given its directory, and print its summary: the release id, engine, target, scenes, files and budget",
    values: [],
    switches: [],
    maxPositionals: 1,
    run: ({ positionals: [path] }, ctx) => gameManifest({ path }, ctx),
  },
} satisfies Record<string, Command>;

export type CommandName = keyof typeof DEFINITIONS;

/** The command table; every command takes `--project`, which narrows the projects names resolve in. */
export const COMMANDS = {} as Record<CommandName, Command>;
for (const [name, c] of Object.entries(DEFINITIONS) as [CommandName, Command][])
  COMMANDS[name] = { ...c, values: [...c.values, "project"] };
export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

/** Usage lines longer than this put their summary on the next line. */
const HELP_WIDTH = 64;

export function helpText(): string {
  const width = Math.min(
    HELP_WIDTH,
    Math.max(...COMMAND_NAMES.map((n) => COMMANDS[n].usage.length)),
  );
  const rows = COMMAND_NAMES.map((n) => {
    const { usage: line, summary } = COMMANDS[n];
    return line.length > width
      ? `  ${line}\n  ${" ".repeat(width)}  ${summary}`
      : `  ${line.padEnd(width)}  ${summary}`;
  });
  return [
    "usage: vp run scene <command> [args] [--json]",
    "",
    ...rows,
    "",
    "every command takes --project <id>: names resolve in that project only (an id two projects hold needs it)",
    "exit codes: 0 ok, 1 error issues or failure, 2 usage, 3 stale base (file batches only)",
  ].join("\n");
}

/** Splits argv into positionals and `--flag value` / `--flag=value` / `--switch`, checked against the command. */
export function parseArgs(
  command: Command,
  argv: readonly string[],
): { ok: true; args: ParsedArgs; json: boolean } | { ok: false; error: string } {
  const positionals: string[] = [];
  const flags: ParsedArgs["flags"] = {};
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-" || !arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq < 0 ? undefined : eq);
    if (name === "json") {
      json = true;
      continue;
    }
    if (command.switches.includes(name)) {
      if (eq >= 0) return { ok: false, error: `--${name} takes no value` };
      flags[name] = true;
      continue;
    }
    if (!command.values.includes(name)) return { ok: false, error: `unknown flag --${name}` };
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) return { ok: false, error: `--${name} needs a value` };
    const prior = flags[name];
    if (!command.repeatable?.includes(name)) flags[name] = value;
    else if (Array.isArray(prior)) prior.push(value);
    else flags[name] = [value];
  }
  if (positionals.length > command.maxPositionals) {
    return {
      ok: false,
      error: `too many arguments: ${positionals.slice(command.maxPositionals).join(" ")}`,
    };
  }
  return { ok: true, args: { positionals, flags }, json };
}

/** Runs one CLI invocation without touching the process: what `cli.ts` prints and exits with. */
export async function runCli(
  argv: readonly string[],
  ctx: ToolContext,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const [first, ...after] = argv;
  const grouped =
    first !== undefined &&
    (COMMAND_GROUPS as readonly string[]).includes(first) &&
    after[0] !== undefined &&
    !after[0].startsWith("-");
  const name = grouped ? `${first} ${after[0]}` : first;
  const rest = grouped ? after.slice(1) : after;
  if (!name || name === "help" || name === "--help" || name === "-h") {
    return {
      exitCode: name ? 0 : 2,
      stdout: name ? `${helpText()}\n` : "",
      stderr: name ? "" : `${helpText()}\n`,
    };
  }
  if (!Object.hasOwn(COMMANDS, name)) {
    const guess = closest(name, COMMAND_NAMES);
    const hint = guess ? `; did you mean "${guess}"?` : "";
    return {
      exitCode: 2,
      stdout: "",
      stderr: `unknown command ${JSON.stringify(name)}${hint}\n\n${helpText()}\n`,
    };
  }
  const command: Command = COMMANDS[name as CommandName];
  const parsed = parseArgs(command, rest);
  if (!parsed.ok) {
    const json = rest.includes("--json");
    const body = json
      ? `${JSON.stringify({ ok: false, error: parsed.error, usage: command.usage })}\n`
      : `${parsed.error}\nusage: vp run scene ${command.usage}\n`;
    return json
      ? { exitCode: 2, stdout: body, stderr: "" }
      : { exitCode: 2, stdout: "", stderr: body };
  }
  const project = parsed.args.flags.project;
  const scoped: ToolContext = typeof project === "string" ? { ...ctx, project } : ctx;
  let result: ToolResult;
  try {
    result = scopeError(scoped) ?? (await command.run(parsed.args, scoped));
  } catch (e) {
    result = failure(e instanceof Error ? e.message : String(e));
  }
  const out = parsed.json ? JSON.stringify(result.data) : result.text;
  return result.exitCode === 0 || parsed.json
    ? { exitCode: result.exitCode, stdout: `${out}\n`, stderr: "" }
    : { exitCode: result.exitCode, stdout: "", stderr: `${out}\n` };
}
