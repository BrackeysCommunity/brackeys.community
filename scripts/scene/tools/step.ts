import { runProbe, unknownActionError, type ProbeInput } from "@jams/engine/headless";
import { expandScene, sceneHash } from "@jams/engine/scene";

import { failure, loadScene, readArg, usage, UsageError, type Tool } from "../context";

export type StepInput = { scene?: string; ticks?: string; hold?: string; inputs?: string };

const DEFAULT_TICKS = 120;
const MAX_TICKS = 60 * 60 * 10;
const ACTION = /^[a-z][a-z_]*$/;

type Edge = NonNullable<ProbeInput["inputs"]>[number];

function isEdge(v: unknown): v is Edge {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    Number.isInteger(v[0]) &&
    v[0] >= 0 &&
    typeof v[1] === "string" &&
    ACTION.test(v[1]) &&
    (v[2] === 0 || v[2] === 1)
  );
}

export const step: Tool<StepInput> = async (input, ctx) => {
  const ticks = input.ticks === undefined ? DEFAULT_TICKS : Number(input.ticks);
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > MAX_TICKS) {
    return usage(`--ticks must be an integer from 1 to ${MAX_TICKS}`);
  }
  const hold = input.hold ? input.hold.split(",").filter(Boolean) : [];
  if (hold.some((a) => !ACTION.test(a))) return usage("--hold a,b (action names like move_right)");
  const badHold = hold.map(unknownActionError).find((e) => e !== null);
  if (badHold) return usage(`--hold: ${badHold}`);

  let inputs: Edge[] = [];
  if (input.inputs) {
    try {
      const raw: unknown = JSON.parse(await readArg(ctx, input.inputs));
      if (!Array.isArray(raw) || !raw.every(isEdge)) {
        return usage("--inputs must be a JSON array of [tick, action, 0|1]");
      }
      const badInput = raw.map((e) => unknownActionError(e[1])).find((e) => e !== null);
      if (badInput) return usage(`--inputs: ${badInput}`);
      inputs = raw;
    } catch (e) {
      if (e instanceof UsageError) return usage(e.message);
      if ((e as { code?: string }).code === "ENOENT") return failure(`Not found: ${input.inputs}.`);
      return usage(`--inputs is not JSON: ${(e as Error).message}`);
    }
  }

  const loaded = await loadScene(ctx, input.scene, "step [--ticks N] [--hold a,b] [--inputs file]");
  if (!loaded.ok) return loaded.result;

  const rapier = await ctx.loadRapier();
  const report = runProbe({ rapier, scene: expandScene(loaded.def), ticks, hold, inputs });
  const hash = sceneHash(loaded.def);
  const data = { scene: loaded.name, sceneHash: hash, ...report };

  if (!report.load.ok) {
    return {
      exitCode: 1,
      data,
      text: `${loaded.name}: failed to load: ${report.load.error}${report.load.entityId ? ` (${report.load.entityId})` : ""}`,
    };
  }
  const f = report.final;
  const round = (n: number) => Math.round(n * 100) / 100;
  const lines = [
    `${loaded.name} ${hash} config ${report.configHash}: ${report.ticks} ticks at ${report.tickRate}Hz`,
    `  final at ${round(f.position.x)},${round(f.position.y)} vel ${round(f.velocity.x)},${round(f.velocity.y)} ${f.state}${f.grounded ? ` grounded on ${f.groundId ?? "?"}` : " airborne"}`,
    ...report.landings.map((l) => `  t${l.tick} landed on ${l.on}`),
    ...report.events
      .filter((e) => e.type !== "landed" && e.type !== "left-ground")
      .map((e) => `  t${e.tick} ${e.type}${e.entityId ? ` ${e.entityId}` : ""}`),
    ...(report.truncated ? ["  (events truncated)"] : []),
  ];
  return { exitCode: 0, data, text: lines.join("\n") };
};
