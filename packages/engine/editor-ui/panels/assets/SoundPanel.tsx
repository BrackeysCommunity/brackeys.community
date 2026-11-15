import { Delete02Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";

import type { InspectorRow } from "../../../editor/inspector-model";
import { settingsRows } from "../../../editor/settings-model";
import { sentence } from "../../../game/live";
import { keyedItemPointer } from "../../../project/json-edit";
import { AUDIO_KIND } from "../../../project/kinds/audio";
import {
  audioBuses,
  SOUND_EVENT_PATTERN,
  soundBusProblem,
  type SoundFile,
} from "../../../project/kinds/sound";
import { SYNTH_KIND } from "../../../project/kinds/synth";
import { ENGINE_STEP_EVENTS } from "../../../runtime/types";
import { jsonPointer } from "../../../scene/issues";
import {
  editAssetJson,
  useSelectedAssetDoc,
  type AssetDoc,
  type AssetDocPanelProps,
} from "../../audio/asset-doc";
import { AuditionButton } from "../../audio/editor-audio";
import { IconButton, Text } from "../../kit/index";
import { useProjectView } from "../EditorProject";
import {
  AssetCombobox,
  assetOptions,
  danglingAsset,
  type AssetOption,
} from "../inspector/asset-picker";
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
import { DocAssetShell, useStringKeyTable } from "../project-tree/asset-panel";
import { settingScope } from "../settings/settings-doc";
import { soundShapes } from "../settings/settings-schemas";
import { commitSettingsRow, SettingsNote, SettingsRows } from "../settings/SettingsRows";

/** What a sound's variants may name. */
const VARIANT_KINDS = [AUDIO_KIND, SYNTH_KIND] as const;

/** The fields drawn by their own sections, not as plain rows. */
const OWN_ROWS: readonly string[] = ["$schema", "kind", "v", "bus", "variants", "on"];

const isEventName = (text: string) => SOUND_EVENT_PATTERN.test(text);

/** An event the engine doesn't raise may still be the game's own, so it's noted, not refused. */
const eventProblem = (event: string): NameProblem | null =>
  ENGINE_STEP_EVENTS.includes(event)
    ? null
    : { message: `The engine raises no "${event}"; only the game can.`, severity: "info" };

const asSound = (value: Record<string, unknown>) => value as unknown as SoundFile;

/**
 * A `sound` asset: its bus, its plain fields (volume, pitch, loop and the
 * rest) as the settings panels draw them, its variants with a weight and a
 * play button each, and the step events that play it. Every edit is one
 * `editAsset` batch, so it co-edits and undoes in one step.
 */
export function SoundPanel({ asset, session, registry }: AssetDocPanelProps) {
  const doc = useSelectedAssetDoc(asset, session);
  const strings = useStringKeyTable(session);
  return (
    <DocAssetShell asset={asset} doc={doc} noun="sound" label="Sound" className="je-sound-panel">
      {(value) => (
        <SoundFields doc={doc} value={asSound(value)} registry={registry} strings={strings} />
      )}
    </DocAssetShell>
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
      out.push(
        <Locked key={row.path} disabled={doc.readOnly !== null}>
          <SliderField field={row} scope={scope} commit={commit} />
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
    <Locked disabled={doc.readOnly !== null}>
      <OptionsField
        field={row}
        scope={settingScope(doc.docName, "bus")}
        options={options}
        segmented={false}
        commit={(input) => commitSettingsRow(doc, row, input)}
        problem={problem ? `${sentence(problem.message)} ${problem.hint}` : null}
      />
    </Locked>
  );
}

type Shapes = ReturnType<typeof soundShapes>;

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * What each variant is called: its asset's name, or its file name
 * (`clink.wav`, `clink.synth.json`) when another variant has the same name,
 * or its path when another has the same file name too; its id when it
 * names no asset.
 */
export function variantNames(
  clips: readonly string[],
  options: readonly AssetOption[],
): Map<string, string> {
  const byId = new Map(options.map((o) => [o.id, o]));
  const found = clips.map((clip) => byId.get(clip));
  const shared = (i: number, of: (o: AssetOption) => string) => {
    const mine = found[i];
    return (
      mine !== undefined && found.some((o, j) => j !== i && o !== undefined && of(o) === of(mine))
    );
  };
  return new Map(
    clips.map((clip, i) => {
      const o = found[i];
      if (o === undefined) return [clip, clip];
      if (!shared(i, (x) => x.label)) return [clip, o.label];
      return [clip, shared(i, (x) => fileName(x.path)) ? o.path : fileName(o.path)];
    }),
  );
}

/** A variant's or a trigger's heading: what it is, and its buttons at the end. */
function ItemHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="je-insp-line">
      <Text size="xs" className="je-insp-grow je-sp-truncate">
        {title}
      </Text>
      {children}
    </div>
  );
}

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
  const readOnly = doc.readOnly !== null;
  const scope = settingScope(doc.docName, "variants");
  const taken = new Set(value.variants.map((v) => v.clip));
  const names = variantNames(
    value.variants.map((v) => v.clip),
    options,
  );
  return (
    <InspectorSection id="sound:variants" title="Variants">
      <div className="je-insp-stack">
        {value.variants.length === 0 ? (
          <SettingsNote>No variants yet: add a clip or a synth patch.</SettingsNote>
        ) : null}
        {value.variants.map((variant) => {
          const at = keyedItemPointer(jsonPointer(["variants"]), variant.clip);
          const problem = danglingAsset(variant.clip, options, VARIANT_KINDS);
          const name = names.get(variant.clip) ?? variant.clip;
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
              <ItemHead title={name}>
                <AuditionButton id={variant.clip} name={name} />
                <IconButton
                  size="icon-xs"
                  icon={Delete02Icon}
                  label={`Remove the variant ${name}`}
                  tooltip="Remove the variant"
                  disabled={readOnly}
                  onClick={() => editAssetJson(doc, [{ remove: at }], "Remove a variant", scope)}
                />
              </ItemHead>
              <FieldRow label="Clip" error={problem}>
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
                    editAssetJson(
                      doc,
                      [{ set: `${at}/clip`, value: next }],
                      "Change a variant",
                      scope,
                    );
                  }}
                />
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
                  editAssetJson(
                    doc,
                    [{ insert: "/variants", value: { clip: next } }],
                    "Add a variant",
                    scope,
                  );
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
  const readOnly = doc.readOnly !== null;
  const scope = settingScope(doc.docName, "on");
  const triggers = value.on ?? [];
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
              <ItemHead title={`On ${trigger.event}`}>
                <IconButton
                  size="icon-xs"
                  icon={Delete02Icon}
                  label={`Remove the trigger on ${trigger.event}`}
                  tooltip="Remove the trigger"
                  disabled={readOnly}
                  onClick={() =>
                    editAssetJson(
                      doc,
                      [{ remove: jsonPointer(["on", i]) }],
                      "Remove a trigger",
                      scope,
                    )
                  }
                />
              </ItemHead>
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
                  editAssetJson(
                    doc,
                    [{ insert: "/on", value: { event: next } }],
                    "Add a trigger",
                    scope,
                  );
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
