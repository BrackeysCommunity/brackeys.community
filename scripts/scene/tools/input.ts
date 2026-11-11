import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MAX_PLAYERS, resolveBindings, resolvePlayers, type BindingLayerName } from "@jams/engine";
import {
  bindingProblems,
  type ActionKind,
  type Binding,
  type BindingProblem,
  type PlayersDef,
} from "@jams/engine/game";
import {
  INPUT_MAP_KIND,
  inputMapEntries,
  inputMapIssues,
  parseAssetDoc,
  projectView,
  usableInputMap,
  type DocKindDef,
  type InputMapFile,
} from "@jams/engine/project";
import { ISSUE_CODES, type SceneIssue } from "@jams/engine/scene";

import { inScope, issueLine, scopeError, usage, type Tool } from "../context";
import { scanProject, type ProjectHandle } from "../projects";

export type InputInput = {
  /** A seat index, as typed. */
  player?: string;
};

/** The layers `input` shows, in precedence order; remaps and the host's bindings live in a browser. */
const LAYERS = ["map", "game"] as const;
type ShownLayer = (typeof LAYERS)[number];

type BindingRow = { binding: Binding; problems: BindingProblem[] };

type ActionRow = {
  action: string;
  kind: ActionKind;
  /** The layer whose bindings the seat uses; null when no layer binds the action. */
  source: BindingLayerName | null;
  /** Each layer that names the action, with its bindings for this seat. */
  layers: Partial<Record<ShownLayer, BindingRow[]>>;
  /** The game declares the action with 0.x `keys`. */
  keys?: readonly string[];
  /** The map's entry for the action was refused, so the game's bindings apply. */
  mapRefused?: true;
};

type ProjectReport = {
  project: string;
  game: string | null;
  players: PlayersDef;
  inputMap: { id: string; path: string } | null;
  /** The map's issues, as its kind judges the file (each binding through `bindingProblems`), and a second map's. */
  issues: SceneIssue[];
  seats: { player: number; actions: ActionRow[] }[];
};

/** `key KeyA`, `pad stick left`, `pointer primary`, with a binding's extras. */
const show = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v);

export function bindingText(b: Binding): string {
  const extras: string[] = [];
  const r = b as Record<string, unknown>;
  if (r.axis !== undefined && b.device !== "pad") extras.push(`axis ${show(r.axis)}`);
  if (r.value !== undefined) extras.push(`value ${show(r.value)}`);
  if (r.scale !== undefined) extras.push(`scale ${show(r.scale)}`);
  if (r.player !== undefined) extras.push(`seat ${show(r.player)}`);
  let head: string;
  switch (b.device) {
    case "key":
      head = `key ${b.code}`;
      break;
    case "pad":
      head =
        "stick" in b
          ? `pad stick ${b.stick}`
          : "button" in b
            ? `pad button ${show(b.button)}`
            : `pad axis ${show(b.axis)}`;
      if ("button" in b && r.axis !== undefined) extras.unshift(`axis ${show(r.axis)}`);
      break;
    case "pointer":
      head = `pointer ${b.button}`;
      break;
    case "touch":
      head = `touch ${b.control}`;
      break;
    default:
      head = JSON.stringify(b);
  }
  return extras.length > 0 ? `${head} (${extras.join(", ")})` : head;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

async function projectReport(project: ProjectHandle, only?: number): Promise<ProjectReport> {
  const { registry, game } = project;
  const scan = await scanProject(project);
  const view = projectView(scan.state, project.kinds);
  const [entry] = inputMapEntries(view);

  let raw: unknown = null;
  const issues: SceneIssue[] = [...inputMapIssues(view)];
  if (entry) {
    const text = await readFile(join(project.dir, ...entry.path.split("/")), "utf8");
    const kind = project.kinds.get(INPUT_MAP_KIND) as DocKindDef<InputMapFile> | undefined;
    if (kind) {
      const parsed = parseAssetDoc(kind, text, { registry, project: view });
      issues.push(...parsed.issues);
    }
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
  }
  const map = entry ? usableInputMap(raw, registry) : null;
  const players: PlayersDef = resolvePlayers(map, game);
  const seatCount = Math.min(MAX_PLAYERS, Math.max(1, Math.floor(players.max)));

  const actions = registry.actions;
  const resolved = resolveBindings({ map, game: actions, players: seatCount });
  const gameOnly = resolveBindings({ game: actions, players: seatCount });
  const mapOnly = map ? resolveBindings({ map, game: [], players: seatCount }) : null;
  const rawEntries = isRecord(raw) && Array.isArray(raw.actions) ? raw.actions : [];
  const refused = new Set(
    rawEntries
      .filter(isRecord)
      .map((e) => e.action)
      .filter(
        (name): name is string =>
          typeof name === "string" && !(map?.actions ?? []).some((a) => a.action === name),
      ),
  );
  const controls = isRecord(raw) && Array.isArray(raw.touch) ? raw.touch : [];
  const controlIds = controls
    .filter(isRecord)
    .flatMap((c) => (typeof c.id === "string" ? [c.id] : []));

  const rows = (list: readonly Binding[] | undefined, kind: ActionKind, layer: ShownLayer) =>
    (list ?? []).map((binding) => ({
      binding,
      problems: bindingProblems(binding, {
        kind,
        max: seatCount,
        ...(layer === "map" ? { controls: controlIds } : {}),
      }),
    }));

  const seats: ProjectReport["seats"] = [];
  for (let player = 0; player < seatCount; player++) {
    if (only !== undefined && player !== only) continue;
    const mapSeat = mapOnly?.bindings(player) ?? {};
    const gameSeat = gameOnly.bindings(player);
    const out: ActionRow[] = resolved.actions.map((action) => {
      const kind = resolved.kindOf(action);
      const def = actions.find((a) => a.action === action);
      const legacy =
        def && def.bindings === undefined ? (def as { keys?: readonly string[] }).keys : undefined;
      const layers: ActionRow["layers"] = {};
      if (Object.hasOwn(mapSeat, action)) layers.map = rows(mapSeat[action], kind, "map");
      if (Object.hasOwn(gameSeat, action)) layers.game = rows(gameSeat[action], kind, "game");
      return {
        action,
        kind,
        source: resolved.source(action, player),
        layers,
        ...(legacy ? { keys: legacy } : {}),
        ...(refused.has(action) ? { mapRefused: true as const } : {}),
      };
    });
    seats.push({ player, actions: out });
  }
  return {
    project: project.file.id,
    game: game?.id ?? null,
    players,
    inputMap: entry ? { id: entry.id, path: entry.path } : null,
    issues,
    seats,
  };
}

function problemLine(p: BindingProblem): string {
  const text = p.hint ?? ISSUE_CODES[p.code]?.hint;
  const hint = text ? `\n          hint: ${text}` : "";
  return `        error ${p.code} ${p.path} ${p.message}${hint}`;
}

function reportText(r: ProjectReport): string[] {
  const head = `${r.project} (${r.game ? `game ${r.game}` : "no game"}): ${r.players.max} seat${r.players.max === 1 ? "" : "s"}, join ${r.players.join}; ${
    r.inputMap ? `input map ${r.inputMap.id} (${r.inputMap.path})` : "no input map"
  }`;
  const lines = [head, ...r.issues.map(issueLine)];
  if (r.seats.length === 0) lines.push(`  no such seat: seats 0 to ${r.players.max - 1}`);
  for (const seat of r.seats) {
    if (seat.actions.length === 0) {
      lines.push(`  seat ${seat.player}: no actions`);
      continue;
    }
    lines.push(`  seat ${seat.player}`);
    for (const a of seat.actions) {
      lines.push(`    ${a.action} (${a.kind}) from ${a.source ?? "nothing: unbound"}`);
      for (const layer of LAYERS) {
        const list = a.layers[layer];
        if (!list) continue;
        const notes = [
          ...(layer === "game" && a.keys
            ? [`from 0.x keys ${JSON.stringify(a.keys)}, deprecated`]
            : []),
        ];
        const used = a.source === layer ? "*" : " ";
        const text = list.length > 0 ? list.map((b) => bindingText(b.binding)).join(", ") : "none";
        lines.push(
          `     ${used}${layer.padEnd(5)} ${text}${notes.length > 0 ? ` [${notes.join("; ")}]` : ""}`,
        );
        for (const b of list) for (const p of b.problems) lines.push(problemLine(p));
      }
      if (a.mapRefused) lines.push("      map   refused (see the map's issues); the game's apply");
    }
  }
  return lines;
}

const hasErrors = (r: ProjectReport) =>
  r.issues.some((i) => i.severity === "error") ||
  r.seats.some((s) =>
    s.actions.some((a) => LAYERS.some((l) => a.layers[l]?.some((b) => b.problems.length > 0))),
  );

/**
 * Each seat's bindings per action, layer by layer (the project's input
 * map, then the game's), which one the seat uses, and every issue: the
 * map's own and each binding's, judged by `bindingProblems`. Remaps live
 * in the player's browser and the host's bindings in its page, so neither
 * shows. Reads the project's files only; Rapier never loads. Exit 1 when
 * anything is an error.
 */
export const input: Tool<InputInput> = async (args, ctx) => {
  const scoped = scopeError(ctx);
  if (scoped) return scoped;
  let only: number | undefined;
  if (args.player !== undefined) {
    const n = Number(args.player);
    if (args.player.trim() === "" || !Number.isInteger(n) || n < 0 || n >= MAX_PLAYERS)
      return usage(`--player takes a seat from 0 to ${MAX_PLAYERS - 1}; got ${args.player}`);
    only = n;
  }

  const reports = await Promise.all(inScope(ctx).map((p) => projectReport(p, only)));
  if (only !== undefined && reports.every((r) => r.seats.length === 0)) {
    const max = Math.max(1, ...reports.map((r) => r.players.max));
    const problems = bindingProblems(
      { device: "key", code: "Space", player: only },
      { kind: "button", max },
    ).filter((p) => p.code === "player-unknown");
    return {
      exitCode: 1,
      data: { ok: false, player: only, problems },
      text: [`--player ${only}:`, ...problems.map(problemLine)].join("\n"),
    };
  }
  const bad = reports.some(hasErrors);
  return {
    exitCode: bad ? 1 : 0,
    data: { ok: !bad, projects: reports },
    text: [
      ...reports.flatMap(reportText),
      "remaps live in the player's browser; input maps are project docs",
    ].join("\n"),
  };
};
