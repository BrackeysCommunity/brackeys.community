import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { z } from "zod";

import { settingsEdit, settingsRows } from "../../../editor/settings-model";
import type { JsonEdit } from "../../../project/index";
import { keyedItemPointer } from "../../../project/json-edit";
import { AUDIO_KIND } from "../../../project/kinds/audio";
import { audioBuses, soundKind, type SoundFile } from "../../../project/kinds/sound";
import { SYNTH_KIND } from "../../../project/kinds/synth";
import { jsonPointer } from "../../../scene/issues";
import { unwrapSchema } from "../../../scene/schema";
import { useAssetDoc, type AssetDoc, type AssetDocPanelProps } from "../../audio/asset-doc";
import { AuditionButton, formatLengthRange, useEditorAudio } from "../../audio/editor-audio";
import { Button, IconButton, MicroLabel, Text } from "../../kit/index";
import { useProjectView } from "../EditorProject";
import { AssetCombobox, assetOptions, danglingAsset } from "../inspector/asset-picker";
import { FieldRow, OptionsField } from "../inspector/field-widgets";
import { AssetPanel } from "../project-tree/asset-panel";
import { DocGate } from "../settings/DocGate";
import { settingScope } from "../settings/settings-doc";
import { SettingsNote, SettingsRows } from "../settings/SettingsRows";

/** What a sound's variants may name. */
const VARIANT_KINDS = [AUDIO_KIND, SYNTH_KIND] as const;

/** The fields drawn by their own sections, not as plain rows. */
const OWN_ROWS: readonly string[] = ["$schema", "kind", "v", "bus", "variants", "on"];

/** The step event a new trigger listens for until the author changes it. */
const NEW_TRIGGER_EVENT = "contact:start";

const objectOf = (schema: unknown): z.ZodObject | null => {
  const inner = schema instanceof z.ZodType ? unwrapSchema(schema) : null;
  return inner instanceof z.ZodObject ? inner : null;
};

/** The sound schema's object, a variant's and a trigger's, under `registry`'s buses. */
function soundShapes(registry: AssetDocPanelProps["registry"]) {
  const root = objectOf(soundKind.schema({ registry, project: null }));
  const shape = (root?.shape ?? {}) as Record<string, z.ZodType>;
  const element = (key: string) => {
    const list = shape[key] ? unwrapSchema(shape[key]) : null;
    return list instanceof z.ZodArray ? objectOf(list.element) : null;
  };
  return { root, variant: element("variants"), trigger: element("on") };
}

const asSound = (value: Record<string, unknown>) => value as unknown as SoundFile;

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
  return (
    <div className="je-doc-asset">
      <AssetPanel {...asset} />
      <div className="je-asset-panel je-sound-panel" aria-label="Sound">
        {doc.entry ? (
          <DocGate doc={doc} noun="sound">
            {(value) => <SoundFields doc={doc} value={asSound(value)} registry={registry} />}
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
}: {
  doc: AssetDoc;
  value: SoundFile;
  registry: AssetDocPanelProps["registry"];
}) {
  const audio = useEditorAudio();
  const id = doc.entry!.id;
  const shapes = soundShapes(registry);
  if (!shapes.root) return null;
  const rows = settingsRows(shapes.root, value, "", { registry });
  const bus = rows.find((r) => r.path === "bus");
  const plain = rows.filter((r) => !OWN_ROWS.includes(r.path));
  const length = audio?.lengthMs(id) ?? null;
  return (
    <>
      <div className="je-insp-line">
        <AuditionButton id={id} name={doc.entry!.name ?? id} size="icon-sm" variant="secondary" />
        <Text size="xs" variant="muted">
          {length ? formatLengthRange(length) : "No length yet"}
        </Text>
      </div>
      {bus ? <BusRow doc={doc} row={bus} registry={registry} /> : null}
      <SettingsRows doc={doc} rows={plain} />
      <Variants doc={doc} value={value} shapes={shapes} registry={registry} />
      <Triggers doc={doc} value={value} shapes={shapes} registry={registry} />
    </>
  );
}

/** The bus, picked from the engine's and the game's (`audioBuses`); an unknown one says so. */
function BusRow({
  doc,
  row,
  registry,
}: {
  doc: AssetDoc;
  row: ReturnType<typeof settingsRows>[number];
  registry: AssetDocPanelProps["registry"];
}) {
  const buses = audioBuses(registry);
  const current = typeof row.value === "string" ? row.value : null;
  const unknown = current !== null && !buses.includes(current);
  const options = [
    ...buses.map((b) => ({ value: b, label: b })),
    ...(unknown ? [{ value: current, label: `${current} (not a bus)` }] : []),
  ];
  const scope = settingScope(doc.docName, "bus");
  return (
    <>
      <OptionsField
        field={row}
        scope={scope}
        options={options}
        segmented={false}
        commit={async (input) => {
          if (!doc.value || !doc.layout) return "The sound hasn't opened yet.";
          const op = settingsEdit(doc.entry!.id, "bus", input, {
            doc: doc.value,
            layout: doc.layout,
          });
          await doc.edit([op], "Set Bus", scope);
          return null;
        }}
      />
      {unknown ? (
        <Text as="p" size="xs" variant="danger">
          No bus "{current}": pick one of {buses.join(", ")}, or declare it in the game's audio
          buses.
        </Text>
      ) : null}
    </>
  );
}

type Shapes = ReturnType<typeof soundShapes>;

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="je-insp-section" data-open="">
      <div className="je-insp-section-head">
        <MicroLabel className="je-sp-truncate je-sound-section-title">{title}</MicroLabel>
        {actions}
      </div>
      <div className="je-insp-stack">{children}</div>
    </section>
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
  const id = doc.entry!.id;
  const readOnly = doc.readOnly !== null;
  const scope = settingScope(doc.docName, "variants");
  const edit = (edits: JsonEdit[], label: string) =>
    void doc.edit([{ op: "editAsset", id, edits }], label, scope);
  const taken = new Set(value.variants.map((v) => v.clip));
  return (
    <Section title="Variants">
      {value.variants.length === 0 ? (
        <SettingsNote>No variants yet: add a clip or a synth patch.</SettingsNote>
      ) : null}
      {value.variants.map((variant) => {
        const at = keyedItemPointer(jsonPointer(["variants"]), variant.clip);
        const problem = danglingAsset(variant.clip, options, VARIANT_KINDS);
        const name = options.find((o) => o.id === variant.clip)?.label ?? variant.clip;
        const weight = shapes.variant
          ? settingsRows(shapes.variant, variant, `variants.@${variant.clip}`, { registry }).filter(
              (r) => r.path.endsWith(".weight"),
            )
          : [];
        return (
          <div key={variant.clip} className="je-sound-variant" data-variant={variant.clip}>
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
    </Section>
  );
}

/** The step events that play it, one row group each, with add and remove. */
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
    <Section
      title="Triggers"
      actions={
        readOnly ? null : (
          <Button
            size="xs"
            variant="ghost"
            icon={Add01Icon}
            busyScope={scope}
            onClick={() =>
              edit([{ insert: "/on", value: { event: NEW_TRIGGER_EVENT } }], "Add a trigger")
            }
          >
            Add trigger
          </Button>
        )
      }
    >
      {triggers.length === 0 ? (
        <SettingsNote>Nothing plays it on its own: a game or a behavior asks for it.</SettingsNote>
      ) : null}
      {triggers.map((trigger, i) => (
        <div key={i} className="je-sound-trigger" data-trigger={i}>
          <div className="je-insp-line">
            <MicroLabel className="je-sp-truncate je-sound-section-title">
              On {trigger.event}
            </MicroLabel>
            <IconButton
              size="icon-xs"
              icon={Delete02Icon}
              label={`Remove the trigger on ${trigger.event}`}
              tooltip="Remove the trigger"
              disabled={readOnly}
              onClick={() => edit([{ remove: jsonPointer(["on", i]) }], "Remove a trigger")}
            />
          </div>
          {shapes.trigger ? (
            <SettingsRows
              doc={doc}
              rows={settingsRows(shapes.trigger, trigger, `on.${i}`, { registry })}
            />
          ) : null}
        </div>
      ))}
    </Section>
  );
}
