import { writeFile } from "node:fs/promises";

import {
  randomSynth,
  SYNTH_PRESETS,
  SYNTH_SAMPLE_RATE,
  synthDurationMs,
  synthWav,
  type SynthPreset,
} from "@jams/engine/headless";
import { projectView, SYNTH_KIND, type SynthFile } from "@jams/engine/project";
import { closest } from "@jams/engine/scene";
import { Rng } from "@jams/engine/sim-kit";

import { failure, usage, type Tool, type ToolResult } from "../context";
import { locateInProjects, scanProject } from "../projects";
import { runProjectBatch, type WriterFlags } from "./assets-apply";
import { folderArg } from "./assets-move";
import { loadProject } from "./project-show";

/** Without the writer flags, which each caller spells its own way. */
export const SYNTH_NEW_USAGE = "synth new <preset> [--seed n] [--id id] [--path p|folder/]";
export const SYNTH_RENDER_USAGE = "synth render <id> --wav <file> [--project id]";
const SEED_MAX = 0xffff_ffff;

const isPreset = (name: string): name is SynthPreset =>
  (SYNTH_PRESETS as readonly string[]).includes(name);

function unknownPreset(name: string): ToolResult {
  const guess = closest(name, SYNTH_PRESETS);
  return usage(
    `no synth preset ${JSON.stringify(name)}${guess ? `; did you mean "${guess}"?` : ""} (presets: ${SYNTH_PRESETS.join(", ")})`,
  );
}

/** `--seed` as a uint32, or why it isn't one. */
function seedArg(seed: string): number | ToolResult {
  const n = /^\d+$/.test(seed) ? Number(seed) : Number.NaN;
  return Number.isSafeInteger(n) && n <= SEED_MAX
    ? n
    : usage(`--seed ${JSON.stringify(seed)} isn't a whole number from 0 to ${SEED_MAX}`);
}

/** The patch a preset and seed give: the same seed gives the same patch, byte for byte. */
export function synthFromPreset(preset: SynthPreset, seed: number): SynthFile {
  return randomSynth(preset, Rng.from(seed));
}

// ─── synth new ───────────────────────────────────────────

export type SynthNewInput = WriterFlags & {
  preset?: string;
  /** A uint32; a random one, reported, when left out. */
  seed?: string;
  id?: string;
  /** The patch's path, or a folder ending in `/`; default the kind's folder with `<id>.json`. */
  path?: string;
};

/**
 * Writes a synth patch drawn from a preset's ranges by `--seed`, as one
 * `createAsset` through the writer flags (`--dry-run`, `--live`). Without
 * `--seed` a random one is drawn and reported, so the patch can be made
 * again.
 */
export const synthNew: Tool<SynthNewInput> = async (input, ctx) => {
  const { preset } = input;
  if (preset === undefined) return usage(`${SYNTH_NEW_USAGE} [writer flags]`);
  if (!isPreset(preset)) return unknownPreset(preset);
  let seed: number;
  if (input.seed === undefined) seed = Math.floor(Math.random() * SEED_MAX);
  else {
    const parsed = seedArg(input.seed);
    if (typeof parsed !== "number") return parsed;
    seed = parsed;
  }
  const content = synthFromPreset(preset, seed);
  const given = input.path?.replace(/^\.?\/+/, "");
  const path =
    given === undefined || given === "" || given.endsWith("/") ? folderArg(given ?? "") : given;
  const result = await runProjectBatch(ctx, input, {
    build: () => ({
      v: 1,
      label: `New ${preset} synth patch`,
      ops: [
        {
          op: "createAsset",
          kind: SYNTH_KIND,
          path,
          ...(input.id === undefined ? {} : { id: input.id }),
          content,
        },
      ],
    }),
  });
  if (result.exitCode === 2) return result;
  const note = `${preset} patch, seed ${seed}, ${synthDurationMs(content)} ms`;
  return {
    ...result,
    data: { ...(result.data as Record<string, unknown>), preset, seed, patch: content },
    text: `${result.text}\n  ${note}`,
  };
};

// ─── synth render ────────────────────────────────────────

export type SynthRenderInput = { id?: string; wav?: string };

/** Writes a synth patch's render as 16-bit PCM WAV (`synthWav`'s bytes) to `--wav`. */
export const synthRender: Tool<SynthRenderInput> = async (input, ctx) => {
  const { id, wav } = input;
  if (id === undefined || wav === undefined) return usage(SYNTH_RENDER_USAGE);
  const found = await locateInProjects(
    ctx.projects,
    id,
    async (p) => projectView((await scanProject(p)).state, p.kinds).byId.has(id),
    ctx.project,
  );
  if (!found.ok)
    return found.exitCode === 2 ? usage(found.message) : failure(found.message, { id });
  const loaded = await loadProject(found.project);
  const project = found.project.file.id;
  const entry = loaded.view.byId.get(id);
  if (entry?.kind !== SYNTH_KIND)
    return failure(`"${id}" is a ${entry?.kind ?? "missing"} asset, not a ${SYNTH_KIND} patch`, {
      project,
      id,
    });
  const patch = loaded.values.get(id) as SynthFile | undefined;
  if (patch === undefined)
    return failure(`${entry.path} doesn't parse as a ${SYNTH_KIND} patch; run validate`, {
      project,
      id,
    });
  const bytes = synthWav(patch);
  try {
    await writeFile(wav, bytes);
  } catch (e) {
    return failure(`can't write ${wav}: ${e instanceof Error ? e.message : String(e)}`, {
      project,
      id,
    });
  }
  const durationMs = synthDurationMs(patch);
  return {
    exitCode: 0,
    data: {
      ok: true,
      project,
      id,
      wav,
      bytes: bytes.byteLength,
      durationMs,
      sampleRate: SYNTH_SAMPLE_RATE,
      channels: 1,
    },
    text: `${id}: ${durationMs} ms at ${SYNTH_SAMPLE_RATE} Hz, mono, ${bytes.byteLength} bytes to ${wav}`,
  };
};
