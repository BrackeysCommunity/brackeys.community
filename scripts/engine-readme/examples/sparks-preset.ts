import { createRegistry } from "@jams/engine/game";
import type { AssetInfo } from "@jams/engine/headless";
import { emitterIssues, emitterKind, parseAssetDoc, type EmitterFile } from "@jams/engine/project";

/** Sparks thrown up and to the sides, falling back under their drift. Lengths in metres, speeds m/s. */
export const sparks: EmitterFile = {
  kind: "emitter",
  v: 1,
  texture: "fx-sheet",
  frame: "spark",
  blend: "add",
  rate: 0,
  bursts: [{ atMs: 0, count: 12 }],
  lifeMs: [300, 600],
  speed: [0.8, 2.2],
  angle: [-150, -30],
  drift: [0, 4],
  damping: 0.5,
  scale: [
    [0, 1],
    [1, 0.2],
  ],
  alpha: [
    [0, 1],
    [0.7, 1],
    [1, 0],
  ],
  tint: [
    [0, 0xffffff],
    [1, 0xff8800],
  ],
  shape: { kind: "circle", r: 0.06 },
  max: 200,
};

const fxSheet: AssetInfo = { id: "fx-sheet", kind: "atlas", frames: ["spark", "smoke"] };

/** The preset as a project reads its file, then a speed range written backwards and a frame the sheet lacks. */
export function checkSparks() {
  const env = { registry: createRegistry(), project: null };
  const read = (file: EmitterFile) => parseAssetDoc(emitterKind, JSON.stringify(file), env);
  return {
    ok: read(sparks).ok,
    backwards: read({ ...sparks, speed: [2.2, 0.8] }).issues.map((i) => i.code),
    frame: emitterIssues({ ...sparks, frame: "sprak" }, fxSheet).map((i) => i.code),
  };
}
