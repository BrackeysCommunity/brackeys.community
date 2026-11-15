import { describe, expect, it } from "vite-plus/test";

import { soundLeafMs } from "../audio/sound-length";
import { synthDurationMs } from "../audio/synth";
import type { SynthFile } from "../project/kinds/synth";
import type { AssetEntry, ProjectState } from "../project/types";
import { projectView } from "../project/view";

const created = { at: 0, by: "test" };
const clip: AssetEntry = {
  key: "ping",
  id: "ping",
  kind: "audio",
  path: "audio/ping.wav",
  sha256: "a".repeat(64),
  meta: { format: "wav", durationMs: 420 },
  created,
};
const silent: AssetEntry = { ...clip, key: "hum", id: "hum", meta: { format: "ogg" } };
const view = projectView({
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: { ping: clip, hum: silent },
  history: {},
  code: {},
  build: {},
} as ProjectState);
const patch: SynthFile = {
  kind: "synth",
  v: 1,
  wave: "square",
  freq: 440,
  sustainMs: 60,
  decayMs: 120,
};
const patches = (id: string) => (id === "blip" ? patch : undefined);

describe("soundLeafMs", () => {
  it("gives a patch's rendered length and a clip's header length", () => {
    expect(soundLeafMs(view, "blip", patches)).toBe(synthDurationMs(patch));
    expect(soundLeafMs(view, "ping", patches)).toBe(420);
    expect(soundLeafMs(null, "blip", patches)).toBe(synthDurationMs(patch));
  });

  it("is null where the length isn't known: no header length, no view, or no asset", () => {
    expect(soundLeafMs(view, "hum", patches)).toBeNull();
    expect(soundLeafMs(null, "ping", patches)).toBeNull();
    expect(soundLeafMs(view, "nothing", patches)).toBeNull();
  });
});
