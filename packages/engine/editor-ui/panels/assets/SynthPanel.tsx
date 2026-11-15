import {
  DiceFaces03Icon,
  ShuffleIcon,
  VolumeHighIcon,
  VolumeOffIcon,
} from "@hugeicons/core-free-icons";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { renderSynth, synthDurationMs } from "../../../audio/synth";
import {
  mutateSynth,
  randomSynth,
  SYNTH_PRESETS,
  type SynthPreset,
} from "../../../audio/synth-presets";
import { capitalise } from "../../../game/live";
import { sameValue } from "../../../project/canonical";
import type { JsonEdit } from "../../../project/index";
import {
  SYNTH_BOUNDS,
  SYNTH_DEFAULTS,
  SYNTH_LFO_WAVES,
  SYNTH_OSC_WAVES,
  SYNTH_WAVES,
  synthField,
  synthKind,
  withSynthField,
  type SynthFile,
  type SynthNumberPath,
} from "../../../project/kinds/synth";
import { jsonPointer } from "../../../scene/issues";
import { Rng } from "../../../sim-kit/rng";
import {
  editAssetJson,
  useSelectedAssetDoc,
  type AssetDoc,
  type AssetDocPanelProps,
} from "../../audio/asset-doc";
import { useEditorAudio } from "../../audio/editor-audio";
import { STORAGE_PREFIX } from "../../host";
import { Button, IconButton, Knob, MicroLabel, Switch, useKit } from "../../kit/index";
import { useStoredFlag } from "../../session/stored";
import { InspectorSection, Locked } from "../inspector/field-widgets";
import { DocAssetShell } from "../project-tree/asset-panel";
import { settingScope } from "../settings/settings-doc";

/** Where the viewer's choice to hear a patch as it changes is kept. */
export const SYNTH_SPEAKER_KEY = `${STORAGE_PREFIX}synth-speaker`;

/** How long after a field change the patch is heard, so a run of edits plays once. */
export const SYNTH_AUDITION_DELAY_MS = 150;

/** What an optional block holds when its module is switched on. */
const BLOCK_DEFAULTS = {
  osc2: () => ({ wave: "saw", detune: 7 }),
  osc3: () => ({ wave: "square", octave: -1 }),
  filter: () => ({ cutoff: 2_000, resonance: 0.3 }),
  filterEnv: () => ({ decayMs: 300 }),
  lfo: () => ({ wave: "sine", hz: 5, pitch: 0.5 }),
  jump: (patch: SynthFile) => ({
    atMs: Math.min(SYNTH_BOUNDS["jump.atMs"][1], Math.round(synthDurationMs(patch) / 2)),
    semitones: 5,
  }),
  vibrato: () => ({ semitones: 0.5, hz: 6 }),
  lowpass: () => ({ hz: 4_000 }),
  highpass: () => ({ hz: 200 }),
} satisfies Record<string, (patch: SynthFile) => Record<string, number | string>>;

type Block = keyof typeof BLOCK_DEFAULTS;

/** A preset's button label where its id doesn't read as one. */
const PRESET_LABELS: Partial<Record<SynthPreset, string>> = { powerup: "Power-up" };

const presetLabel = (preset: SynthPreset) => PRESET_LABELS[preset] ?? capitalise(preset);

/** The top-level edits that turn `from` into `to`, keeping `from`'s `$schema`. */
export function replaceEdits(from: Record<string, unknown>, to: SynthFile): JsonEdit[] {
  const next = to as Record<string, unknown>;
  const edits: JsonEdit[] = [];
  for (const key of new Set([...Object.keys(from), ...Object.keys(next)])) {
    if (key === "$schema") continue;
    if (!Object.hasOwn(next, key)) edits.push({ unset: jsonPointer([key]) });
    else if (!sameValue(from[key], next[key]))
      edits.push({ set: jsonPointer([key]), value: next[key] });
  }
  return edits;
}

/** Each column's lowest and highest sample, `columns` pairs in order. */
export function waveformPeaks(samples: Float32Array, columns: number): Float32Array {
  const out = new Float32Array(columns * 2);
  if (samples.length === 0) return out;
  for (let x = 0; x < columns; x++) {
    const start = Math.floor((x * samples.length) / columns);
    const end = Math.max(start + 1, Math.floor(((x + 1) * samples.length) / columns));
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end && i < samples.length; i++) {
      const s = samples[i]!;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    out[x * 2] = lo;
    out[x * 2 + 1] = hi;
  }
  return out;
}

/** How many columns the strip draws; it stretches to the panel's width. */
const WAVE_COLUMNS = 240;

/** The low-to-high span of each column as one SVG path, in a `WAVE_COLUMNS` × 2 box centred on 1. */
export function waveformPath(samples: Float32Array, columns = WAVE_COLUMNS): string {
  const peaks = waveformPeaks(samples, columns);
  const parts: string[] = [];
  for (let x = 0; x < columns; x++) {
    const lo = peaks[x * 2]!;
    const hi = peaks[x * 2 + 1]!;
    const top = 1 - hi;
    const height = Math.max(0.02, hi - lo);
    parts.push(`M${x} ${top.toFixed(3)}h1v${height.toFixed(3)}h-1z`);
  }
  return parts.join("");
}

/**
 * The patch's render as a strip: each column's low-to-high span around the
 * centre line, filled with the text colour so it follows the theme.
 */
function Waveform({ samples }: { samples: Float32Array }) {
  const d = useMemo(() => waveformPath(samples), [samples]);
  return (
    <svg
      className="je-synth-wave"
      role="img"
      aria-label="Waveform"
      data-samples={samples.length}
      viewBox={`0 0 ${WAVE_COLUMNS} 2`}
      preserveAspectRatio="none"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/**
 * A `synth` asset: its waveform and length, a button per preset that
 * replaces it with a random patch from that preset's ranges, Mutate, and
 * every field with the schema's bounds. Every edit is one `editAsset`
 * batch, so it co-edits and undoes in one step. While the speaker is on, a
 * change is heard shortly after; nothing sounds before a click in the panel
 * creates the editor's audio.
 */
export function SynthPanel({ asset, session }: AssetDocPanelProps) {
  const doc = useSelectedAssetDoc(asset, session);
  const { storage } = useKit();
  const [speaker, setSpeaker] = useStoredFlag(storage, SYNTH_SPEAKER_KEY, true);
  const { audition, arm } = useAudition(asset.entry.id, speaker);
  const patch = doc.value ? (doc.value as unknown as SynthFile) : null;
  const toggle = (
    <IconButton
      className="je-synth-speaker"
      size="icon-xs"
      icon={speaker ? VolumeHighIcon : VolumeOffIcon}
      label="Hear changes"
      tooltip={speaker ? "Changes play as you make them" : "Changes are silent"}
      aria-pressed={speaker}
      onClick={() => setSpeaker(!speaker)}
    />
  );
  return (
    <DocAssetShell
      asset={asset}
      doc={doc}
      noun="synth patch"
      label="Synth patch"
      className="je-synth-panel"
      audition={
        patch ? { patch, lengthMs: synthDurationMs(patch), actions: toggle } : { actions: toggle }
      }
      onPointerDownCapture={arm}
      onKeyDownCapture={arm}
    >
      {(value) => (
        <SynthFields doc={doc} value={value as unknown as SynthFile} audition={audition} />
      )}
    </DocAssetShell>
  );
}

type Audition = (patch: SynthFile, now?: boolean) => void;

/** Plays a changed patch while the speaker is on: at once for a click, else after the delay. */
function useAudition(id: string, speaker: boolean) {
  const audio = useEditorAudio();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clicked = useRef(false);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  useEffect(() => {
    if (!speaker) cancel();
  }, [speaker]);
  const audition: Audition = (patch, now = false) => {
    cancel();
    if (now) clicked.current = true;
    if (!speaker || !audio) return;
    // Until a click in the panel the editor may not create its audio, so a change waits for one.
    const go = () => void audio.play(id, clicked.current ? { patch } : { patch, quiet: true });
    if (now) go();
    else
      timer.current = setTimeout(() => {
        timer.current = null;
        go();
      }, SYNTH_AUDITION_DELAY_MS);
  };
  const arm = () => {
    clicked.current = true;
  };
  return { audition, arm };
}

/** A knob on a numeric field. */
type KnobSpec = {
  path: SynthNumberPath;
  label: string;
  unit?: string;
  step: number;
  log?: true;
  /** Shown in place of a value while the field is unset (a retrigger that's off). */
  unset?: string;
  format?: (v: number) => string;
  /** Usable only while the patch is like this. */
  when?: (patch: SynthFile) => boolean;
};

/** A stepped knob on a wave field. */
type WaveSpec = {
  path: "wave" | "osc2.wave" | "osc3.wave" | "lfo.wave";
  label: string;
  options: readonly string[];
};

type Control = KnobSpec | WaveSpec;

type ModuleSpec = { id: string; title: string; block?: Block; controls: readonly Control[] };

const WAVE_NAMES: Readonly<Record<string, string>> = {
  square: "Square",
  saw: "Saw",
  triangle: "Tri",
  sine: "Sine",
  noise: "Noise",
  random: "S&H",
};

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const hz = (v: number) => (v >= 1_000 ? `${Number((v / 1_000).toFixed(2))}k` : String(v));
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
const ms = { unit: "ms", step: 1 } as const;
const unit = { step: 0.01 } as const;
const isSquare = (p: SynthFile) => p.wave === "square";

/**
 * The patch as a mono synth's front panel: oscillators into a mixer, the
 * ladder filter and its envelope, the amp envelope, then pitch movement and
 * modulation, and the plain sound-effect filters last.
 */
const MODULES: readonly ModuleSpec[] = [
  {
    id: "osc1",
    title: "Osc 1",
    controls: [
      { path: "wave", label: "Wave", options: SYNTH_WAVES },
      { path: "freq", label: "Freq", unit: "Hz", step: 1, log: true, format: hz },
      { path: "duty", label: "Width", step: 0.01, when: isSquare },
      { path: "dutySweep", label: "PWM", step: 0.01, when: isSquare },
    ],
  },
  {
    id: "osc2",
    title: "Osc 2",
    block: "osc2",
    controls: [
      { path: "osc2.wave", label: "Wave", options: SYNTH_OSC_WAVES },
      { path: "osc2.octave", label: "Octave", step: 1, format: signed },
      { path: "osc2.detune", label: "Detune", unit: "ct", step: 1, format: signed },
    ],
  },
  {
    id: "osc3",
    title: "Osc 3",
    block: "osc3",
    controls: [
      { path: "osc3.wave", label: "Wave", options: SYNTH_OSC_WAVES },
      { path: "osc3.octave", label: "Octave", step: 1, format: signed },
      { path: "osc3.detune", label: "Detune", unit: "ct", step: 1, format: signed },
    ],
  },
  {
    id: "mixer",
    title: "Mixer",
    controls: [
      { path: "level", label: "Osc 1", ...unit },
      { path: "osc2.level", label: "Osc 2", ...unit, when: (p) => !!p.osc2 },
      { path: "osc3.level", label: "Osc 3", ...unit, when: (p) => !!p.osc3 },
      { path: "noise", label: "Noise", ...unit },
    ],
  },
  {
    id: "filter",
    title: "Filter",
    block: "filter",
    controls: [
      { path: "filter.cutoff", label: "Cutoff", unit: "Hz", step: 1, log: true, format: hz },
      { path: "filter.resonance", label: "Emphasis", ...unit },
      { path: "filter.envAmount", label: "Contour", unit: "oct", step: 0.05 },
      { path: "filter.keyTrack", label: "Key", ...unit },
      { path: "filter.drive", label: "Drive", ...unit },
    ],
  },
  {
    id: "filterEnv",
    title: "Filter envelope",
    block: "filterEnv",
    controls: [
      { path: "filterEnv.attackMs", label: "Attack", ...ms },
      { path: "filterEnv.decayMs", label: "Decay", ...ms },
      { path: "filterEnv.sustain", label: "Sustain", ...unit },
      { path: "filterEnv.releaseMs", label: "Release", ...ms },
    ],
  },
  {
    id: "amp",
    title: "Amp envelope",
    controls: [
      { path: "attackMs", label: "Attack", ...ms },
      { path: "ampDecayMs", label: "Decay", ...ms },
      { path: "ampSustain", label: "Sustain", ...unit },
      { path: "decayMs", label: "Release", ...ms },
      { path: "sustainMs", label: "Gate", ...ms },
      { path: "punch", label: "Punch", ...unit },
      { path: "volume", label: "Volume", ...unit },
    ],
  },
  {
    id: "pitch",
    title: "Pitch",
    controls: [
      { path: "slide", label: "Slide", step: 0.05 },
      { path: "slideAccel", label: "Accel", step: 0.1 },
      { path: "retriggerMs", label: "Repeat", ...ms, unset: "Off" },
    ],
  },
  {
    id: "jump",
    title: "Jump",
    block: "jump",
    controls: [
      { path: "jump.atMs", label: "At", ...ms },
      { path: "jump.semitones", label: "Step", unit: "st", step: 1, format: signed },
    ],
  },
  {
    id: "lfo",
    title: "LFO",
    block: "lfo",
    controls: [
      { path: "lfo.wave", label: "Wave", options: SYNTH_LFO_WAVES },
      { path: "lfo.hz", label: "Rate", unit: "Hz", step: 0.1 },
      { path: "lfo.pitch", label: "Pitch", unit: "st", step: 0.05 },
      { path: "lfo.cutoff", label: "Cutoff", unit: "oct", step: 0.05, when: (p) => !!p.filter },
      { path: "lfo.amp", label: "Amp", ...unit },
    ],
  },
  {
    id: "vibrato",
    title: "Vibrato",
    block: "vibrato",
    controls: [
      { path: "vibrato.semitones", label: "Depth", unit: "st", step: 0.05 },
      { path: "vibrato.hz", label: "Rate", unit: "Hz", step: 0.1 },
    ],
  },
  {
    id: "lowpass",
    title: "Low-pass 12",
    block: "lowpass",
    controls: [
      { path: "lowpass.hz", label: "Cutoff", unit: "Hz", step: 1, log: true, format: hz },
      { path: "lowpass.sweep", label: "Sweep", step: 0.05 },
      { path: "lowpass.resonance", label: "Res", ...unit },
    ],
  },
  {
    id: "highpass",
    title: "High-pass",
    block: "highpass",
    controls: [
      { path: "highpass.hz", label: "Cutoff", unit: "Hz", step: 1, log: true, format: hz },
      { path: "highpass.sweep", label: "Sweep", step: 0.05 },
    ],
  },
];

/** What the renderer reads for a numeric field that's unset. */
const UNSET_DEFAULTS: Partial<Record<SynthNumberPath, number>> = {
  duty: SYNTH_DEFAULTS.duty,
  volume: SYNTH_DEFAULTS.volume,
  level: SYNTH_DEFAULTS.level,
  "osc2.level": SYNTH_DEFAULTS.oscLevel,
  "osc3.level": SYNTH_DEFAULTS.oscLevel,
  ampSustain: SYNTH_DEFAULTS.ampSustain,
};

/** Where a reset puts a field the file must hold: the new patch's or the switched-on block's value. */
function requiredDefault(path: SynthNumberPath, patch: SynthFile): number | undefined {
  const [head, leaf] = path.split(".") as [string, string | undefined];
  const empty = synthKind.empty() as Record<string, unknown>;
  if (leaf === undefined)
    return typeof empty[head] === "number" ? (empty[head] as number) : undefined;
  const block = BLOCK_DEFAULTS[head as Block]?.(patch) as Record<string, unknown> | undefined;
  return typeof block?.[leaf] === "number" ? (block[leaf] as number) : undefined;
}

/** A field the file must hold: a reset sets it back rather than removing it. */
const isRequired = (path: string) =>
  /^(freq|sustainMs|decayMs|filter\.cutoff|lowpass\.hz|highpass\.hz|lfo\.hz|jump\.\w+|vibrato\.\w+)$/.test(
    path,
  );

function SynthFields({
  doc,
  value,
  audition,
}: {
  doc: AssetDoc;
  value: SynthFile;
  audition: Audition;
}) {
  const [rng] = useState(() => Rng.from(Math.floor(Math.random() * 0xffff_ffff)));
  const readOnly = doc.readOnly !== null;
  // A knob's drag redraws the waveform from this before it's written.
  const [preview, setPreview] = useState<SynthFile | null>(null);
  const shown = preview ?? value;
  const key = useDeferredValue(JSON.stringify(shown));
  const samples = useMemo(() => renderSynth(JSON.parse(key) as SynthFile), [key]);
  const scope = settingScope(doc.docName, "");

  const replace = (next: SynthFile, label: string, now = true) => {
    if (!doc.value) return;
    setPreview(null);
    audition(next, now);
    editAssetJson(doc, replaceEdits(doc.value, next), label, scope);
  };

  const set = (path: string, next: unknown, label: string) =>
    replace(withSynthField(value, path, next), label, false);

  return (
    <div className="je-insp-stack">
      <Waveform samples={samples} />
      <InspectorSection
        id="synth:presets"
        title="Presets"
        actions={
          <Button
            size="xs"
            variant="ghost"
            icon={ShuffleIcon}
            disabled={readOnly}
            busyScope={scope}
            tooltip="Nudge every number a little"
            onClick={() => replace(mutateSynth(value, rng), "Mutate the patch")}
          >
            Mutate
          </Button>
        }
      >
        <div className="je-synth-presets">
          {SYNTH_PRESETS.map((preset) => {
            const label = presetLabel(preset);
            return (
              <Button
                key={preset}
                size="xs"
                variant="secondary"
                data-preset={preset}
                disabled={readOnly}
                tooltip={`A random ${label.toLowerCase()} patch in place of this one`}
                onClick={() =>
                  replace(randomSynth(preset, rng), `New ${label.toLowerCase()} patch`)
                }
              >
                {label}
              </Button>
            );
          })}
        </div>
      </InspectorSection>
      <Locked disabled={readOnly}>
        <div className="je-synth-rack" role="group" aria-label="Synth controls">
          {MODULES.map((module) => (
            <SynthModule
              key={module.id}
              module={module}
              patch={shown}
              readOnly={readOnly}
              onPreview={(path, v) => setPreview(withSynthField(value, path, v))}
              onSet={set}
              extra={
                module.id === "mixer" ? (
                  <IconButton
                    size="icon-xs"
                    icon={DiceFaces03Icon}
                    label="New noise"
                    tooltip={`Roll a new noise seed (now ${value.seed ?? SYNTH_DEFAULTS.seed})`}
                    disabled={readOnly}
                    onClick={() => set("seed", rng.range(1, 0xffff_ffff), "Roll a new noise seed")}
                  />
                ) : null
              }
            />
          ))}
        </div>
      </Locked>
    </div>
  );
}

function SynthModule({
  module,
  patch,
  readOnly,
  onPreview,
  onSet,
  extra,
}: {
  module: ModuleSpec;
  patch: SynthFile;
  readOnly: boolean;
  onPreview: (path: string, value: unknown) => void;
  onSet: (path: string, value: unknown, label: string) => void;
  extra?: ReactNode;
}) {
  const block = module.block;
  const on = block === undefined || patch[block] !== undefined;
  // A switched-off module shows what switching it on would set.
  const filled = block && !on ? withSynthField(patch, block, BLOCK_DEFAULTS[block](patch)) : patch;
  const name = (label: string) => `${module.title} ${label.toLowerCase()}`;
  return (
    <section
      className="je-synth-module"
      aria-label={module.title}
      data-module={module.id}
      data-off={on ? undefined : ""}
    >
      <header className="je-synth-module-head">
        <MicroLabel className="je-sp-truncate">{module.title}</MicroLabel>
        {extra}
        {block ? (
          <Switch
            aria-label={`${module.title} on`}
            checked={on}
            disabled={readOnly}
            onCheckedChange={(checked) =>
              onSet(
                block,
                checked ? BLOCK_DEFAULTS[block](patch) : undefined,
                `${checked ? "Add" : "Remove"} ${module.title.toLowerCase()}`,
              )
            }
          />
        ) : null}
      </header>
      <div className="je-synth-knobs">
        {module.controls.map((control) => {
          const disabled =
            readOnly || !on || ("when" in control && control.when?.(patch) === false);
          if ("options" in control) {
            const current = String(synthWave(filled, control.path));
            return (
              <Knob
                key={control.path}
                label={control.label}
                value={Math.max(0, control.options.indexOf(current))}
                min={0}
                max={control.options.length - 1}
                options={control.options.map((o) => WAVE_NAMES[o] ?? o)}
                disabled={disabled}
                isDefault={false}
                aria-label={name(control.label)}
                onCommit={(i) =>
                  onSet(control.path, control.options[i], `Set ${name(control.label)}`)
                }
              />
            );
          }
          const [min, max] = SYNTH_BOUNDS[control.path];
          const set = synthField(filled, control.path);
          const required = isRequired(control.path);
          const fallback = UNSET_DEFAULTS[control.path] ?? (required ? undefined : 0);
          const resetTo = fallback ?? requiredDefault(control.path, patch);
          const what = name(control.label);
          const off = set === undefined ? control.unset : undefined;
          const format = control.format;
          return (
            <Knob
              key={control.path}
              label={control.label}
              aria-label={name(control.label)}
              value={set ?? fallback ?? min}
              min={min}
              max={max}
              step={control.step}
              {...(control.log ? { scale: "log" as const } : {})}
              {...(control.unit && off === undefined ? { unit: control.unit } : {})}
              {...(resetTo !== undefined ? { defaultValue: resetTo } : {})}
              {...(off !== undefined
                ? { format: () => off }
                : format
                  ? { format: (v: number) => format(roundTo(v, control.step)) }
                  : {})}
              isDefault={set === undefined || set === resetTo}
              disabled={disabled}
              onChange={(v) => onPreview(control.path, v)}
              onCommit={(v) => onSet(control.path, v, `Set ${what}`)}
              onReset={() => {
                // An optional field resets by going unset; one the file must hold, to its starting value.
                if (!required) onSet(control.path, undefined, `Reset ${what}`);
                else if (resetTo !== undefined) onSet(control.path, resetTo, `Reset ${what}`);
              }}
            />
          );
        })}
      </div>
    </section>
  );
}

function synthWave(patch: SynthFile, path: WaveSpec["path"]): string | undefined {
  if (path === "wave") return patch.wave;
  const [head] = path.split(".") as ["osc2" | "osc3" | "lfo"];
  return patch[head]?.wave;
}
