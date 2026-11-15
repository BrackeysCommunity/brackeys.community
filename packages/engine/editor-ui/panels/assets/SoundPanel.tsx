import { Delete02Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";

import type { InspectorRow } from "../../../editor/inspector-model";
import { settingsRows } from "../../../editor/settings-model";
import { capitalise } from "../../../game/live";
import type { JsonEdit } from "../../../project/index";
import { keyedItemPointer } from "../../../project/json-edit";
import { AUDIO_KIND } from "../../../project/kinds/audio";
import { audioBuses, soundBusProblem, type SoundFile } from "../../../project/kinds/sound";
import { SYNTH_KIND } from "../../../project/kinds/synth";
import { ENGINE_STEP_EVENTS } from "../../../runtime/types";
import { jsonPointer } from "../../../scene/issues";
import { useAssetDoc, type AssetDoc, type AssetDocPanelProps } from "../../audio/asset-doc";
import { AuditionButton } from "../../audio/editor-audio";
import { IconButton, Text } from "../../kit/index";
import { useProjectView } from "../EditorProject";
import { AssetCombobox, assetOptions, danglingAsset } from "../inspector/asset-picker";
import {
  EditError,
  FieldRow,
  IdCombobox,
  InspectorSection,
  isBoundedNumber,
  Locked,
  NameField,
  OptionsField,
  RangeField,
  SliderField,
  StringKeyField,
  type NameProblem,
  type StringKeyTable,
} from "../inspector/field-widgets";
import { AssetPanel, useStringKeyTable } from "../project-tree/asset-panel";
import { DocGate } from "../settings/DocGate";
import { settingScope } from "../settings/settings-doc";
import { soundShapes } from "../settings/settings-schemas";
import { commitSettingsRow, SettingsNote, SettingsRows } from "../settings/SettingsRows";

/** What a sound's variants may name. */
const VARIANT_KINDS = [AUDIO_KIND, SYNTH_KIND] as const;

/** The fields drawn by their own sections, not as plain rows. */
const OWN_ROWS: readonly string[] = ["$schema", "kind", "v", "bus", "variants", "on"];

/** What the player reads for an unset field the schema gives no default. */
const FALLBACKS: Readonly<Record<string, number>> = { volume: 1 };

/** A typed event a game raises itself: anything without spaces. */
const isEventName = (text: string) => /^\S+$/.test(text);

/** An event the engine doesn't raise may still be the game's own, so it's noted, not refused. */
const eventProblem = (event: string): NameProblem | null =>
  ENGINE_STEP_EVENTS.includes(event)
    ? null
    : { message: `The engine raises no "${event}"; only the game can.`, severity: "info" };

const asSound = (value: Record<string, unknown>) => value as unknown as SoundFile;

/** An issue's message as a sentence: capitalised, and stopped unless it ends in a question. */
const sentence = (message: string) => `${capitalise(message)}${/[.?!]$/.test(message) ? "" : "."}`;

/**
 * A `sound` asset: its bus, its plain fields (volume, pitch, loop and the
 * rest) as the settings panels draw them, its variants with a weight and a
 * play button each, and the step events that play it. Every edit is one
 * `editAsset` batch, so it co-edits and undoes in one step.
 */
export function SoundPanel({ asset, session, registry }: AssetDocPanelProps) {
  const notify = asset.notify ?? { error: (message: string) => console.error(message) };
  const doc = useAssetDoc(session, asset.entry.id, {
    ...(asset.readOnly ? { readOnly: true } : {}),
    notify,
  });
  const strings = useStringKeyTable(session);
  return (
    <div className="je-doc-asset">
      <AssetPanel {...asset} editor />
      <div className="je-asset-panel je-sound-panel" aria-label="Sound">
        {doc.entry ? (
          <DocGate doc={doc} noun="sound">
            {(value) => (
              <SoundFields doc={doc} value={asSound(value)} registry={registry} strings={strings} />
            )}
          </DocGate>
        ) : (
          <SettingsNote>This sound isn't in the project any more.</SettingsNote>
        )}
      </div>
    </div>
  );
}

function SoundFields({
  doc,
  value,
  registry,
  strings,
}: {
  doc: AssetDoc;
  value: SoundFile;
  registry: AssetDocPanelProps["registry"];
  strings: StringKeyTable | null;
}) {
  const shapes = soundShapes(registry);
  if (!shapes.root) return null;
  const rows = settingsRows(shapes.root, value, "", { registry });
  const bus = rows.find((r) => r.path === "bus");
  const plain = rows.filter((r) => !OWN_ROWS.includes(r.path));
  return (
    <>
      {bus ? <BusRow doc={doc} row={bus} registry={registry} /> : null}
      <Rows doc={doc} rows={plain} strings={strings} />
      <Variants doc={doc} value={value} shapes={shapes} registry={registry} />
      <Triggers doc={doc} value={value} shapes={shapes} registry={registry} />
    </>
  );
}

/**
 * `rows` as the settings panels draw them, but a range (the pitch), a
 * bounded number (the volume) and a string key (the caption) through their
 * own widgets, in their place.
 */
function Rows({
  doc,
  rows,
  strings,
}: {
  doc: AssetDoc;
  rows: readonly InspectorRow[];
  strings: StringKeyTable | null;
}) {
  const out: ReactNode[] = [];
  let run: InspectorRow[] = [];
  const flush = () => {
    if (run.length > 0) out.push(<SettingsRows key={run[0]!.path} doc={doc} rows={run} />);
    run = [];
  };
  for (const row of rows) {
    const scope = settingScope(doc.docName, row.path);
    const commit = (input: unknown) => commitSettingsRow(doc, row, input);
    const w = row.widget;
    if (isBoundedNumber(row)) {
      flush();
      const fallback = FALLBACKS[row.path];
      out.push(
        <Locked key={row.path} disabled={doc.readOnly !== null}>
          <SliderField
            field={row}
            scope={scope}
            commit={commit}
            {...(fallback !== undefined ? { fallback } : {})}
          />
        </Locked>,
      );
    } else if (w.kind === "range") {
      flush();
      out.push(
        <Locked key={row.path} disabled={doc.readOnly !== null}>
          <RangeField
            field={row}
            scope={scope}
            commitEach={(next) => {
              const pair = next(row.value);
              return pair instanceof EditError ? pair.message : commit(pair);
            }}
          />
        </Locked>,
      );
    } else if (w.kind === "text" && w.stringKey) {
      flush();
      out.push(
        <Locked key={row.path} disabled={doc.readOnly !== null}>
          <StringKeyField field={row} scope={scope} commit={commit} table={strings} />
        </Locked>,
      );
    } else run.push(row);
  }
  flush();
  return <>{out}</>;
}

/** The bus, picked from the engine's and the game's (`audioBuses`); an unknown one says so. */
function BusRow({
  doc,
  row,
  registry,
}: {
  doc: AssetDoc;
  row: InspectorRow;
  registry: AssetDocPanelProps["registry"];
}) {
  const buses = audioBuses(registry);
  const current = typeof row.value === "string" ? row.value : null;
  const problem = current !== null ? soundBusProblem(current, buses) : null;
  const options = [
    ...buses.map((b) => ({ value: b, label: b })),
    ...(problem && current !== null ? [{ value: current, label: `${current} (not a bus)` }] : []),
  ];
  return (
    <OptionsField
      field={row}
      scope={settingScope(doc.docName, "bus")}
      options={options}
      segmented={false}
      commit={(input) => commitSettingsRow(doc, row, input)}
      problem={problem ? `${sentence(problem.message)} ${problem.hint}` : null}
    />
  );
}

type Shapes = ReturnType<typeof soundShapes>;

/** The variants: a clip or patch each, its weight and a play button, and one more to add. */
function Variants({
  doc,
  value,
  shapes,
  registry,
}: {
  doc: AssetDoc;
  value: SoundFile;
  shapes: Shapes;
  registry: AssetDocPanelProps["registry"];
}) {
  const view = useProjectView(doc.session);
  const options = assetOptions(view, VARIANT_KINDS);
  const id = doc.entry!.id;
  const readOnly = doc.readOnly !== null;
  const scope = settingScope(doc.docName, "variants");
  const edit = (edits: JsonEdit[], label: string) =>
    void doc.edit([{ op: "editAsset", id, edits }], label, scope);
  const taken = new Set(value.variants.map((v) => v.clip));
  return (
    <InspectorSection id="sound:variants" title="Variants">
      <div className="je-insp-stack">
        {value.variants.length === 0 ? (
          <SettingsNote>No variants yet: add a clip or a synth patch.</SettingsNote>
        ) : null}
        {value.variants.map((variant) => {
          const at = keyedItemPointer(jsonPointer(["variants"]), variant.clip);
          const problem = danglingAsset(variant.clip, options, VARIANT_KINDS);
          const name = options.find((o) => o.id === variant.clip)?.label ?? variant.clip;
          const weight = shapes.variant
            ? settingsRows(shapes.variant, variant, `variants.@${variant.clip}`, {
                registry,
              }).filter((r) => r.path.endsWith(".weight"))
            : [];
          return (
            <div
              key={variant.clip}
              className="je-insp-stack je-sound-variant"
              data-variant={variant.clip}
            >
              <FieldRow label="Clip" error={problem}>
                <div className="je-insp-line">
                  <AssetCombobox
                    path={`variants.${variant.clip}.clip`}
                    kinds={VARIANT_KINDS}
                    options={options.filter((o) => o.id === variant.clip || !taken.has(o.id))}
                    value={variant.clip}
                    mixed={false}
                    optional={false}
                    invalid={problem !== null}
                    onPick={(next) => {
                      if (next === undefined || next === variant.clip) return;
                      edit([{ set: `${at}/clip`, value: next }], "Change a variant");
                    }}
                  />
                  <AuditionButton id={variant.clip} name={name} />
                  <IconButton
                    size="icon-xs"
                    icon={Delete02Icon}
                    label={`Remove the variant ${name}`}
                    tooltip="Remove the variant"
                    disabled={readOnly}
                    onClick={() => edit([{ remove: at }], "Remove a variant")}
                  />
                </div>
              </FieldRow>
              <SettingsRows doc={doc} rows={weight} />
            </div>
          );
        })}
        {readOnly ? null : (
          <FieldRow label="Add" scope={scope}>
            <AssetCombobox
              path="variants.add"
              kinds={VARIANT_KINDS}
              options={options.filter((o) => !taken.has(o.id))}
              value={undefined}
              mixed={false}
              optional={false}
              invalid={false}
              placeholder="Add a clip or a patch"
              onPick={(next) => {
                if (next !== undefined)
                  edit([{ insert: "/variants", value: { clip: next } }], "Add a variant");
              }}
            />
          </FieldRow>
        )}
      </div>
    </InspectorSection>
  );
}

/** The step events that play it, each with its filters and a remove, and one more to add. */
function Triggers({
  doc,
  value,
  shapes,
  registry,
}: {
  doc: AssetDoc;
  value: SoundFile;
  shapes: Shapes;
  registry: AssetDocPanelProps["registry"];
}) {
  const id = doc.entry!.id;
  const readOnly = doc.readOnly !== null;
  const scope = settingScope(doc.docName, "on");
  const triggers = value.on ?? [];
  const edit = (edits: JsonEdit[], label: string) =>
    void doc.edit([{ op: "editAsset", id, edits }], label, scope);
  return (
    <InspectorSection id="sound:triggers" title="Triggers">
      <div className="je-insp-stack">
        {triggers.length === 0 ? (
          <SettingsNote>
            Nothing plays it on its own: a game or a behavior asks for it.
          </SettingsNote>
        ) : null}
        {triggers.map((trigger, i) => {
          const rows = shapes.trigger
            ? settingsRows(shapes.trigger, trigger, `on.${i}`, { registry })
            : [];
          const event = rows.find((r) => r.name === "event");
          return (
            <div key={i} className="je-insp-stack je-sound-trigger" data-trigger={i}>
              <div className="je-insp-line">
                <Text size="xs" className="je-insp-grow je-sp-truncate">
                  On {trigger.event}
                </Text>
                <IconButton
                  size="icon-xs"
                  icon={Delete02Icon}
                  label={`Remove the trigger on ${trigger.event}`}
                  tooltip="Remove the trigger"
                  disabled={readOnly}
                  onClick={() => edit([{ remove: jsonPointer(["on", i]) }], "Remove a trigger")}
                />
              </div>
              {event ? (
                <Locked disabled={readOnly}>
                  <NameField
                    field={event}
                    scope={settingScope(doc.docName, event.path)}
                    commit={(input) => commitSettingsRow(doc, event, input)}
                    items={ENGINE_STEP_EVENTS}
                    typed={isEventName}
                    typedDetail="The game's own"
                    problem={eventProblem}
                    placeholder="Pick a step event"
                    empty="No engine event by that name"
                  />
                </Locked>
              ) : null}
              <SettingsRows doc={doc} rows={rows.filter((r) => r !== event)} />
            </div>
          );
        })}
        {readOnly ? null : (
          <FieldRow label="Add" scope={scope}>
            <IdCombobox
              label="on.add"
              items={ENGINE_STEP_EVENTS}
              value={null}
              onChange={(next) => {
                if (next !== null)
                  edit([{ insert: "/on", value: { event: next } }], "Add a trigger");
              }}
              invalid={false}
              placeholder="Add a step event"
              clearable={false}
              empty="No engine event by that name"
              typed={isEventName}
              typedDetail="The game's own"
            />
          </FieldRow>
        )}
      </div>
    </InspectorSection>
  );
}
