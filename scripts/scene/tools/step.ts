import { runProbe, unknownActionError, type ProbeInput } from "@jams/engine/headless";
import { expandScene, sceneHashWith, type Registry } from "@jams/engine/scene";

import {
  failure,
  gameFlag,
  isToolResult,
  openScene,
  readArg,
  usage,
  UsageError,
  type Tool,
} from "../context";

export type StepInput = {
  scene?: string;
  ticks?: string;
  hold?: string;
  inputs?: string;
  game?: string;
};

const DEFAULT_TICKS = 120;
const MAX_TICKS = 60 * 60 * 10;

type Edge = NonNullable<ProbeInput["inputs"]>[number];

function isEdge(v: unknown): v is Edge {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    Number.isInteger(v[0]) &&
    v[0] >= 0 &&
    typeof v[1] === "string" &&
    (v[2] === 0 || v[2] === 1)
  );
}

const firstError = (actions: readonly string[], registry: Registry) =>
  actions.map((a) => unknownActionError(a, registry.actionNames)).find((e) => e !== null);

/** Numbers to two decimals, for the text report only. */
export const rounded = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "number" ? Math.round(v * 100) / 100 : v,
  );

export const step: Tool<StepInput> = async (input, ctx) => {
  const ticks = input.ticks === undefined ? DEFAULT_TICKS : Number(input.ticks);
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS) {
    return usage(`--ticks must be an integer from 1 to ${MAX_TICKS}`);
  }
  let under: Registry | undefined;
  if (input.game !== undefined) {
    const picked = gameFlag(ctx, input.game);
    if (isToolResult(picked)) return picked;
    under = picked;
  }

  const loaded = await openScene(
    ctx,
    input.scene,
    "step [--ticks N] [--hold a,b] [--inputs file] [--game id]",
    under,
  );
  if (!loaded.ok) return loaded.result;
  const { registry } = loaded;
  const runs = registry.game ? `game ${registry.id}` : "no game";

  const hold = input.hold ? input.hold.split(",").filter(Boolean) : [];
  const badHold = firstError(hold, registry);
  if (badHold) return usage(`--hold: ${badHold}`);

  let inputs: Edge[] = [];
  if (input.inputs) {
    try {
      const raw: unknown = JSON.parse(await readArg(ctx, input.inputs));
      if (!Array.isArray(raw) || !raw.every(isEdge)) {
        return usage("--inputs must be a JSON array of [tick, action, 0|1]");
      }
      const badInput = firstError(
        raw.map((e) => e[1]),
        registry,
      );
      if (badInput) return usage(`--inputs: ${badInput}`);
      inputs = raw;
    } catch (e) {
      if (e instanceof UsageError) return usage(e.message);
      if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.inputs}.`);
      return usage(`--inputs is not JSON: ${(e as Error).message}`);
    }
  }

  const rapier = await ctx.loadRapier();
  const report = runProbe({
    rapier,
    game: registry.game,
    registry,
    scene: expandScene(loaded.def, registry, { prefabs: loaded.prefabs }),
    ticks,
    hold,
    inputs,
  });
  const hash = sceneHashWith(loaded.def, loaded.prefabs);
  const data = { scene: loaded.name, game: registry.game?.id ?? null, sceneHash: hash, ...report };

  if (!report.load.ok) {
    return {
      exitCode: 1,
      data,
      text: `${loaded.name}: failed to load: ${report.load.error}${report.load.entityId ? ` (${report.load.entityId})` : ""}`,
    };
  }
  const lines = [
    `${loaded.name} ${hash} ${runs} config ${report.configHash}: ${report.ticks} ticks at ${report.tickRate}Hz`,
    `  final ${rounded(report.final)}`,
    ...report.events.map(
      (e) =>
        `  t${e.tick} ${e.type}${e.entityId ? ` ${e.entityId}` : ""}${e.other ? ` (${e.other})` : ""}`,
    ),
    ...(report.truncated ? ["  (events truncated)"] : []),
    ...(report.outcome
      ? [
          `  outcome t${report.outcome.tick} ${report.outcome.result}${report.outcome.cause ? `: ${report.outcome.cause}` : ""}`,
        ]
      : []),
  ];
  return { exitCode: 0, data, text: lines.join("\n") };
};
