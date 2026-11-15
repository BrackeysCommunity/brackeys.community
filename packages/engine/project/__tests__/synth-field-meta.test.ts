import { describe, expect, it } from "vite-plus/test";

import { SYNTH_BOUNDS, SYNTH_DEFAULTS, synthFieldMeta, type SynthNumberPath } from "../kinds/synth";

describe("synthFieldMeta", () => {
  it("reads whether a field may be left out from the schema itself", () => {
    const required = (Object.keys(SYNTH_BOUNDS) as SynthNumberPath[]).filter(
      (path) => !synthFieldMeta(path).optional,
    );
    expect(required.sort()).toEqual(
      [
        "decayMs",
        "filter.cutoff",
        "freq",
        "highpass.hz",
        "jump.atMs",
        "jump.semitones",
        "lfo.hz",
        "lowpass.hz",
        "sustainMs",
        "vibrato.hz",
        "vibrato.semitones",
      ].sort(),
    );
  });

  it("gives the default a field's meta names, and none where the renderer reads 0", () => {
    expect(synthFieldMeta("duty")).toEqual({ optional: true, default: SYNTH_DEFAULTS.duty });
    expect(synthFieldMeta("volume").default).toBe(SYNTH_DEFAULTS.volume);
    expect(synthFieldMeta("level").default).toBe(SYNTH_DEFAULTS.level);
    expect(synthFieldMeta("osc2.level").default).toBe(SYNTH_DEFAULTS.oscLevel);
    expect(synthFieldMeta("osc3.level").default).toBe(SYNTH_DEFAULTS.oscLevel);
    expect(synthFieldMeta("ampSustain").default).toBe(SYNTH_DEFAULTS.ampSustain);
    expect(synthFieldMeta("noise")).toEqual({ optional: true });
    expect(synthFieldMeta("freq")).toEqual({ optional: false });
  });
});
