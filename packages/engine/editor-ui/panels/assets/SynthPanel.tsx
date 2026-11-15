import { ShuffleIcon, VolumeHighIcon, VolumeOffIcon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from "react";

import { renderSynth, synthDurationMs } from "../../../audio/synth";
import {
  mutateSynth,
  randomSynth,
  SYNTH_PRESETS,
  type SynthPreset,
} from "../../../audio/synth-presets";
import { settingsRows, type InspectorRow } from "../../../editor/settings-model";
import { capitalise } from "../../../game/live";
import { sameValue } from "../../../project/canonical";
import type { JsonEdit } from "../../../project/index";
import {
  SYNTH_BOUNDS,
  withSynthField,
  type SynthFile,
  type SynthNumberPath,
} from "../../../project/kinds/synth";
import { jsonPointer } from "../../../scene/issues";
import { Rng } from "../../../sim-kit/rng";
import { useAssetDoc, type AssetDoc, type AssetDocPanelProps } from "../../audio/asset-doc";
import { useEditorAudio } from "../../audio/editor-audio";
import { STORAGE_PREFIX } from "../../host";
import { Button, IconButton, Switch, useKit } from "../../kit/index";
import { readStored, storedFlag, writeStored } from "../../session/stored";
import {
  FieldRow,
  InspectorSection,
  Locked,
  NumberField,
  OptionsField,
  ReadonlyField,
  SliderField,
} from "../inspector/field-widgets";
import { AssetPanel } from "../project-tree/asset-panel";
import { DocGate } from "../settings/DocGate";
import { settingScope } from "../settings/settings-doc";
import { synthObject } from "../settings/settings-schemas";
import { commitSettingsRow, SettingsNote } from "../settings/SettingsRows";

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

const isBounded = (path: string): path is SynthNumberPath => Object.hasOwn(SYNTH_BOUNDS, path);

/** The fields that only change a square wave. */
const SQUARE_ONLY: readonly string[] = ["duty", "dutySweep"];

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
  const notify = asset.notify ?? { error: (message: string) => console.error(message) };
  const doc = useAssetDoc(session, asset.entry.id, {
    ...(asset.readOnly ? { readOnly: true } : {}),
    notify,
  });
  const { storage } = useKit();
  const [speaker, setSpeaker] = useState(() =>
    readStored(storage, SYNTH_SPEAKER_KEY, true, storedFlag),
  );
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
      onClick={() => {
        const on = !speaker;
        setSpeaker(on);
        writeStored(storage, SYNTH_SPEAKER_KEY, on);
      }}
    />
  );
  return (
    <div className="je-doc-asset" onPointerDownCapture={arm} onKeyDownCapture={arm}>
      <AssetPanel
        {...asset}
        audition={
          patch ? { patch, lengthMs: synthDurationMs(patch), actions: toggle } : { actions: toggle }
        }
      />
      <div className="je-asset-panel je-synth-panel" aria-label="Synth patch">
        {doc.entry ? (
          <DocGate doc={doc} noun="synth patch">
            {(value) => (
              <SynthFields doc={doc} value={value as unknown as SynthFile} audition={audition} />
            )}
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

function SynthFields({
  doc,
  value,
  audition,
}: {
  doc: AssetDoc;
  value: SynthFile;
  audition: Audition;
}) {
  const id = doc.entry!.id;
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

  const commit: Commit = (row, input, label) =>
    commitSettingsRow(doc, row, input, {
      ...(label !== undefined ? { label } : {}),
      onCommitted: (next) => audition(withSynthField(value, row.path, next)),
    });

  const rows = shape
    ? settingsRows(shape, value, "").filter(
        (r) =>
          !IDENTITY.includes(r.path) &&
          (!SQUARE_ONLY.includes(r.path) || value.wave === "square" || r.value !== undefined),
      )
    : [];

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
        <div className="je-insp-stack">
          {rows.map((row) => (
            <SynthRow key={row.path} row={row} patch={value} doc={doc} commit={commit} />
          ))}
        </div>
      </Locked>
    </div>
  );
}

/** Writes `input` into `row`, checked by its schema, and plays the patch it makes. */
type Commit = (row: InspectorRow, input: unknown, label?: string) => Promise<string | null>;

function SynthRow({
  row,
  patch,
  doc,
  commit: write,
  block,
}: {
  row: InspectorRow;
  patch: SynthFile;
  doc: AssetDoc;
  commit: Commit;
  /** The block a nested row is in, whose title names its controls with the row's. */
  block?: InspectorRow;
}) {
  const scope = settingScope(doc.docName, row.path);
  const commit = (input: unknown) => write(row, input);
  const disabled = doc.readOnly !== null;
  const label = block ? `${block.title} ${row.title.toLowerCase()}` : row.title;
  switch (row.widget.kind) {
    case "number":
      // The renderer reads an unset number with no schema default as 0.
      return isBounded(row.path) ? (
        <SliderField field={row} label={label} scope={scope} commit={commit} fallback={0} />
      ) : (
        <NumberField field={row} label={label} commit={commit} scope={scope} disabled={disabled} />
      );
    case "segmented":
    case "select":
      return (
        <OptionsField
          field={row}
          label={label}
          commit={commit}
          scope={scope}
          options={row.widget.options}
          segmented={false}
        />
      );
    case "object":
      return <BlockField row={row} patch={patch} doc={doc} commit={write} />;
    default:
      return <ReadonlyField field={row} />;
  }
}

/** An optional block (a jump, vibrato or a filter): a switch that adds or removes it, then its fields. */
function BlockField({
  row,
  patch,
  doc,
  commit,
}: {
  row: InspectorRow;
  patch: SynthFile;
  doc: AssetDoc;
  commit: Commit;
}) {
  const on = row.value !== undefined;
  const fill = BLOCK_DEFAULTS[row.path as keyof typeof BLOCK_DEFAULTS];
  return (
    <>
      <FieldRow field={row} scope={settingScope(doc.docName, row.path)}>
        <Switch
          aria-label={`${row.title} on`}
          checked={on}
          disabled={doc.readOnly !== null || (!on && !fill)}
          onCheckedChange={(checked) =>
            void commit(
              row,
              checked ? fill?.(patch) : undefined,
              `${checked ? "Add" : "Remove"} ${row.title.toLowerCase()}`,
            )
          }
        />
      </FieldRow>
      {on && row.children ? (
        <div className="je-insp-stack je-insp-nested">
          {row.children.map((child) => (
            <SynthRow
              key={child.path}
              row={child}
              patch={patch}
              doc={doc}
              commit={commit}
              block={row}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
