import { ShuffleIcon, VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { renderSynth, synthDurationMs } from "../../../audio/synth";
import { mutateSynth, randomSynth, SYNTH_PRESETS } from "../../../audio/synth-presets";
import {
  settingsEdit,
  settingsRows,
  settingsValue,
  type InspectorRow,
} from "../../../editor/settings-model";
import { sameValue } from "../../../project/canonical";
import type { JsonEdit } from "../../../project/index";
import {
  SYNTH_BOUNDS,
  synthKind,
  type SynthFile,
  type SynthNumberPath,
} from "../../../project/kinds/synth";
import { jsonPointer } from "../../../scene/issues";
import { unwrapSchema } from "../../../scene/schema";
import { Rng } from "../../../sim-kit/rng";
import { useAssetDoc, type AssetDoc, type AssetDocPanelProps } from "../../audio/asset-doc";
import { AuditionButton, formatClipLength, useEditorAudio } from "../../audio/editor-audio";
import { STORAGE_PREFIX } from "../../host";
import { Button, IconButton, MicroLabel, Slider, Switch, Text, useKit } from "../../kit/index";
import { readStored, storedFlag, writeStored } from "../../session/stored";
import {
  FieldRow,
  NumberField,
  NumberInput,
  OptionsField,
  ReadonlyField,
} from "../inspector/field-widgets";
import { AssetPanel } from "../project-tree/asset-panel";
import { DocGate } from "../settings/DocGate";
import { settingScope } from "../settings/settings-doc";
import { SettingsNote } from "../settings/SettingsRows";

/** Where the viewer's choice to hear a patch as it changes is kept. */
export const SYNTH_SPEAKER_KEY = `${STORAGE_PREFIX}synth-speaker`;

/** How long after a field change the patch is heard, so a run of edits plays once. */
export const SYNTH_AUDITION_DELAY_MS = 150;

/** The fields the panel never edits: the file's identity. */
const IDENTITY: readonly string[] = ["$schema", "kind", "v"];

/** What an optional block holds when it's switched on. */
const BLOCK_DEFAULTS = {
  jump: (patch: SynthFile) => ({
    atMs: Math.min(SYNTH_BOUNDS["jump.atMs"][1], Math.round(synthDurationMs(patch) / 2)),
    semitones: 5,
  }),
  vibrato: () => ({ semitones: 0.5, hz: 6 }),
  lowpass: () => ({ hz: 4_000 }),
  highpass: () => ({ hz: 200 }),
} satisfies Record<string, (patch: SynthFile) => Record<string, number>>;

/** An unset field's value as the renderer reads it, where that isn't 0. */
const UNSET_AS: Partial<Record<SynthNumberPath, number>> = { duty: 0.5, volume: 1 };

const isBounded = (path: string): path is SynthNumberPath => Object.hasOwn(SYNTH_BOUNDS, path);

/** The fields that only change a square wave. */
const SQUARE_ONLY: readonly string[] = ["duty", "dutySweep"];

const synthObject = (): z.ZodObject | null => {
  const inner = unwrapSchema(synthKind.schema());
  return inner instanceof z.ZodObject ? inner : null;
};

/** `patch` with `value` at dot `path` (undefined removes it). */
function withField(patch: SynthFile, path: string, value: unknown): SynthFile {
  const next = structuredClone(patch) as Record<string, unknown>;
  const keys = path.split(".");
  const last = keys.pop()!;
  let node = next;
  for (const key of keys) {
    const inner = node[key];
    const copy: Record<string, unknown> =
      inner && typeof inner === "object" ? { ...(inner as Record<string, unknown>) } : {};
    node[key] = copy;
    node = copy;
  }
  if (value === undefined) delete node[last];
  else node[last] = value;
  return next as SynthFile;
}

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

const WAVE_HEIGHT_PX = 48;

/** The patch's render as a strip: each column's low-to-high span around the centre line. */
function Waveform({ samples }: { samples: Float32Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const ratio = globalThis.devicePixelRatio || 1;
      const width = Math.max(1, Math.round((canvas.clientWidth || 240) * ratio));
      const height = Math.round(WAVE_HEIGHT_PX * ratio);
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = getComputedStyle(canvas).color;
      const mid = height / 2;
      const peaks = waveformPeaks(samples, width);
      for (let x = 0; x < width; x++) {
        const lo = peaks[x * 2]!;
        const hi = peaks[x * 2 + 1]!;
        const top = mid - hi * mid;
        ctx.fillRect(x, top, 1, Math.max(1, (hi - lo) * mid));
      }
    };
    draw();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [samples]);
  return (
    <canvas
      ref={ref}
      className="je-synth-wave"
      role="img"
      aria-label="Waveform"
      data-samples={samples.length}
      style={{ height: WAVE_HEIGHT_PX }}
    />
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
  const notify = asset.notify ?? { error: (message: string) => console.error(message) };
  const doc = useAssetDoc(session, asset.entry.id, {
    ...(asset.readOnly ? { readOnly: true } : {}),
    notify,
  });
  return (
    <div className="je-doc-asset">
      <AssetPanel {...asset} />
      <div className="je-asset-panel je-synth-panel" aria-label="Synth patch">
        {doc.entry ? (
          <DocGate doc={doc} noun="synth patch">
            {(value) => <SynthFields doc={doc} value={value as unknown as SynthFile} />}
          </DocGate>
        ) : (
          <SettingsNote>This patch isn't in the project any more.</SettingsNote>
        )}
      </div>
    </div>
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

function SynthFields({ doc, value }: { doc: AssetDoc; value: SynthFile }) {
  const { storage } = useKit();
  const id = doc.entry!.id;
  const [speaker, setSpeaker] = useState(() =>
    readStored(storage, SYNTH_SPEAKER_KEY, true, storedFlag),
  );
  const { audition, arm } = useAudition(id, speaker);
  const [rng] = useState(() => Rng.from(Math.floor(Math.random() * 0xffff_ffff)));
  const readOnly = doc.readOnly !== null;
  const shape = useMemo(() => synthObject(), []);
  const key = JSON.stringify(value);
  const samples = useMemo(() => renderSynth(JSON.parse(key) as SynthFile), [key]);
  const scope = settingScope(doc.docName, "");

  const replace = (next: SynthFile, label: string) => {
    if (!doc.value) return;
    audition(next, true);
    void doc.edit([{ op: "editAsset", id, edits: replaceEdits(doc.value, next) }], label, scope);
  };

  const change = async (path: string, next: unknown, label: string): Promise<string | null> => {
    if (doc.readOnly !== null) return doc.readOnly;
    if (!doc.value || !doc.layout) return "The patch hasn't opened yet.";
    const op = settingsEdit(id, path, next, { doc: doc.value, layout: doc.layout });
    if (await doc.edit([op], label, settingScope(doc.docName, path)))
      audition(withField(value, path, next));
    return null;
  };

  const rows = shape
    ? settingsRows(shape, value, "").filter(
        (r) =>
          !IDENTITY.includes(r.path) &&
          (!SQUARE_ONLY.includes(r.path) || value.wave === "square" || r.value !== undefined),
      )
    : [];

  return (
    <div className="je-insp-stack" onPointerDownCapture={arm} onKeyDownCapture={arm}>
      <div className="je-insp-line">
        <AuditionButton
          id={id}
          name={doc.entry!.name ?? id}
          size="icon-sm"
          variant="secondary"
          patch={value}
        />
        <Text size="xs" variant="muted">
          {formatClipLength(synthDurationMs(value))}
        </Text>
        <IconButton
          className="je-synth-speaker"
          size="icon-xs"
          icon={speaker ? VolumeHighIcon : VolumeOffIcon}
          label="Hear changes"
          tooltip={speaker ? "Changes play as you make them" : "Changes are silent"}
          aria-pressed={speaker}
          onClick={() => {
            const on = !speaker;
            setSpeaker(on);
            writeStored(storage, SYNTH_SPEAKER_KEY, on);
          }}
        />
      </div>
      <Waveform samples={samples} />
      <section aria-label="Presets" className="je-insp-section" data-open="">
        <div className="je-insp-section-head">
          <MicroLabel className="je-sp-truncate">Presets</MicroLabel>
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
        </div>
        <div className="je-synth-presets">
          {SYNTH_PRESETS.map((preset) => (
            <Button
              key={preset}
              size="xs"
              variant="secondary"
              disabled={readOnly}
              tooltip={`A random ${preset} patch in place of this one`}
              onClick={() => replace(randomSynth(preset, rng), `New ${preset} patch`)}
            >
              {preset}
            </Button>
          ))}
        </div>
      </section>
      <fieldset disabled={readOnly} style={{ display: "contents" }}>
        <div className="je-insp-stack">
          {rows.map((row) => (
            <SynthRow key={row.path} row={row} patch={value} doc={doc} change={change} />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

type Change = (path: string, value: unknown, label: string) => Promise<string | null>;

const labelFor = (row: InspectorRow, value: unknown) =>
  `${value === undefined ? "Reset" : "Set"} ${row.title}`;

/** A row's typed or picked input, checked by its schema, then written. */
const commitRow = (change: Change, row: InspectorRow) => async (input: unknown) => {
  const checked = settingsValue(row, input);
  if (!checked.ok) return checked.error;
  return change(row.path, checked.value, labelFor(row, checked.value));
};

function SynthRow({
  row,
  patch,
  doc,
  change,
}: {
  row: InspectorRow;
  patch: SynthFile;
  doc: AssetDoc;
  change: Change;
}) {
  const scope = settingScope(doc.docName, row.path);
  const commit = commitRow(change, row);
  const disabled = doc.readOnly !== null;
  switch (row.widget.kind) {
    case "number":
      return isBounded(row.path) ? (
        <SliderField row={row} path={row.path} scope={scope} commit={commit} />
      ) : (
        <NumberField field={row} commit={commit} scope={scope} disabled={disabled} />
      );
    case "segmented":
    case "select":
      return (
        <OptionsField
          field={row}
          commit={commit}
          scope={scope}
          options={row.widget.options}
          segmented={false}
        />
      );
    case "object":
      return <BlockField row={row} patch={patch} doc={doc} change={change} />;
    default:
      return <ReadonlyField field={row} />;
  }
}

type NumberWidget = Extract<InspectorRow["widget"], { kind: "number" }>;

/** A bounded number: a slider over the schema's range that writes on release, and the typed value. */
function SliderField({
  row,
  path,
  scope,
  commit,
}: {
  row: InspectorRow;
  path: SynthNumberPath;
  scope: string;
  commit: (input: unknown) => Promise<string | null>;
}) {
  const w = row.widget as NumberWidget;
  const [min, max] = SYNTH_BOUNDS[path];
  const [drag, setDrag] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = typeof row.value === "number" ? row.value : undefined;
  const shown = drag ?? value ?? Math.min(max, Math.max(min, UNSET_AS[path] ?? 0));
  const write = (input: unknown) => void commit(input).then(setError);
  return (
    <FieldRow field={row} scope={scope} error={error}>
      <div className="je-insp-row je-synth-slider" data-gap="tight">
        <Slider
          aria-label={`${row.path} slider`}
          min={min}
          max={max}
          step={w.step}
          value={shown}
          onValueChange={(v) => setDrag(Array.isArray(v) ? (v[0] ?? null) : v)}
          onValueCommitted={(v) => {
            setDrag(null);
            const n = Array.isArray(v) ? v[0] : v;
            if (typeof n === "number" && n !== value) write(n);
          }}
        />
        <NumberInput
          label={row.path}
          value={value}
          fallback={row}
          mixed={false}
          step={w.step}
          bigStep={w.bigStep}
          suffix={w.unit}
          decimals={w.decimals}
          preview={drag === null ? null : String(drag)}
          onCommit={(text) =>
            text.trim() === "" && row.optional ? commit(undefined) : commit(text)
          }
        />
      </div>
    </FieldRow>
  );
}

/** An optional block (a jump, vibrato or a filter): a switch that adds or removes it, then its fields. */
function BlockField({
  row,
  patch,
  doc,
  change,
}: {
  row: InspectorRow;
  patch: SynthFile;
  doc: AssetDoc;
  change: Change;
}) {
  const on = row.value !== undefined;
  const fill = BLOCK_DEFAULTS[row.path as keyof typeof BLOCK_DEFAULTS];
  return (
    <>
      <FieldRow field={row} scope={settingScope(doc.docName, row.path)}>
        <Switch
          aria-label={`${row.path} on`}
          checked={on}
          disabled={doc.readOnly !== null || (!on && !fill)}
          onCheckedChange={(checked) =>
            void change(
              row.path,
              checked ? fill?.(patch) : undefined,
              `${checked ? "Add" : "Remove"} ${row.title.toLowerCase()}`,
            )
          }
        />
      </FieldRow>
      {on && row.children ? (
        <div className="je-insp-stack je-insp-nested">
          {row.children.map((child) => (
            <SynthRow key={child.path} row={child} patch={patch} doc={doc} change={change} />
          ))}
        </div>
      ) : null}
    </>
  );
}
