import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SceneIssue } from "@jams/engine/scene";

import {
  failure,
  issueLine,
  usage,
  type Tool,
  type ToolContext,
  type ToolResult,
} from "../context";
import { askEditor, liveFailure } from "./play-live";
import { render } from "./render";

export type FrameInput = {
  scene?: string;
  /** Ask the editor that has the scene open; without it there is no frame to give. */
  live: boolean;
  out?: string;
  viewport?: string;
  url?: string;
  token?: string;
  /** How long the editor has to answer; default `LIVE_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
};

export const FRAME_USAGE =
  "frame <scene> --live [--out f.png] [--viewport n] [--url ws://…|https://site [--token t]]";

/** The PNG's pixel size from its IHDR chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * The scene's schematic as a PNG, for when no editor gives a frame: written
 * to `out`, else returned as base64.
 */
async function schematic(
  ctx: ToolContext,
  scene: string,
  out: string | undefined,
  issue: SceneIssue,
): Promise<ToolResult> {
  const dir = out ? null : await mkdtemp(join(tmpdir(), "scene-frame-"));
  const file = out ?? join(dir!, "frame.png");
  try {
    const drawn = await render({ scene, out: file }, ctx);
    if (drawn.exitCode !== 0) return drawn;
    const bytes = new Uint8Array(await readFile(file));
    const size = pngSize(bytes) ?? { width: 0, height: 0 };
    return {
      exitCode: 0,
      data: {
        ok: true,
        scene,
        source: "schematic",
        ...size,
        ...(out ? { out } : { png: Buffer.from(bytes).toString("base64") }),
        issues: [issue],
      },
      text: [
        `${scene}: ${out ? `wrote ${out}` : "drew"} the schematic (${size.width}x${size.height}), source: schematic`,
        issueLine(issue),
      ].join("\n"),
    };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The open editor's canvas as a PNG, answered over the scene's live
 * channel; with no editor answering (or a frame over the cap), the
 * schematic render instead, with `source: "schematic"`.
 */
export const frame: Tool<FrameInput> = async (input, ctx) => {
  if (!input.scene) return usage(`scene ${FRAME_USAGE}`);
  if (!input.live)
    return usage(
      "scene frame reads the open editor's canvas and needs --live; scene render draws the schematic",
    );
  if (input.out !== undefined && !/\.png$/i.test(input.out)) return usage("--out must end in .png");
  let viewport: number | undefined;
  if (input.viewport !== undefined) {
    viewport = Number(input.viewport);
    if (!Number.isFinite(viewport) || viewport <= 0)
      return usage(`--viewport takes a width in metres above 0: ${input.viewport}`);
  }
  const scene = input.scene;
  const asked = await askEditor(
    ctx,
    { ...input, scene },
    {
      t: "frame",
      opts: viewport === undefined ? {} : { viewport },
    },
  );
  if (!asked.ok) {
    if (asked.result) return asked.result;
    if (asked.issue.code === "live-refused") return liveFailure(scene, asked.issue);
    return schematic(ctx, scene, input.out, asked.issue);
  }
  const { response, project } = asked;
  if (response.t !== "frame") return failure(`The editor answered a ${response.t} request.`);
  const { width, height, tick, mode } = response;
  if (input.out) await writeFile(input.out, Buffer.from(response.png, "base64"));
  return {
    exitCode: 0,
    data: {
      ok: true,
      scene,
      project,
      source: "live",
      width,
      height,
      tick,
      mode,
      ...(input.out ? { out: input.out } : { png: response.png }),
    },
    text: `${scene}: ${input.out ? `wrote ${input.out}` : "the editor's frame"} (${width}x${height}, ${mode} at t${tick}), source: live${input.out ? "" : "; pass --out f.png to write it"}`,
  };
};
