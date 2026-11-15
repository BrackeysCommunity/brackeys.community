import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Fragment, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";

import { layoutFromDoc, type ProjectSession } from "../../../collab/index";
import { sentence } from "../../../game/live";
import {
  byCodeUnit,
  dialogueIssues,
  docLookup,
  GAME_SETTINGS_KIND,
  mergedStrings,
  projectLocales,
  STRINGS_KIND,
  stringKeyIssues,
  type AssetEntry,
  type AssetId,
  type AssetKindName,
  type DialogueFile,
  type DocLookup,
  type StringsFile,
} from "../../../project/index";
import { docLookupOf } from "../../../project/kinds/define";
import {
  localeChain,
  localeFallbacks,
  isLocaleColumn,
  localeFont,
  stringRowText,
} from "../../../project/kinds/strings";
import { plural } from "../../../scene/plural";
import { useSelectedAssetDoc, type AssetDoc, type AssetDocPanelProps } from "../../audio/asset-doc";
import { AssetAudition, isAudibleKind } from "../../audio/editor-audio";
import { IconButton } from "../../kit/button";
import { formatBytes } from "../../kit/format";
import { Icon } from "../../kit/icon";
import { Text } from "../../kit/index";
import { useProjectView } from "../EditorProject";
import { InspectorSection, type StringKeyTable } from "../inspector/field-widgets";
import { DocGate } from "../settings/DocGate";
import { SettingsNote } from "../settings/SettingsRows";
import { kindIcon } from "./kind-icons";
import { LicenceFields } from "./licence-fields";
import { baseName } from "./tree-rows";
import type { LicenceFieldsProps } from "./types";

/** The asset picked in the project tree, as the inspector shows it. */
export type SelectedAsset = Pick<
  LicenceFieldsProps,
  "entry" | "readOnly" | "onLicence" | "notify"
> & {
  /** Back to the scene selection. */
  onClose: () => void;
};

const CHANNELS: Readonly<Record<number, string>> = { 1: "mono", 2: "stereo" };

/** What its kind's inspection read: an image's or a font's size, a clip's rate and channels. */
function metaLine(entry: AssetEntry): string | null {
  const meta = entry.meta;
  if (!meta) return null;
  const { width, height, sampleRate, channels } = meta as Record<string, unknown>;
  if (typeof width === "number" && typeof height === "number") return `${width} × ${height}`;
  const audio = [
    typeof sampleRate === "number" ? `${Number((sampleRate / 1000).toFixed(2))} kHz` : null,
    typeof channels === "number" ? (CHANNELS[channels] ?? `${channels} channels`) : null,
  ].filter((part): part is string => part !== null);
  return audio.length > 0 ? audio.join(" · ") : null;
}

/** The audition row's own patch, length and controls, where a panel has them. */
export type AssetPanelAudition = Pick<
  ComponentProps<typeof AssetAudition>,
  "patch" | "lengthMs" | "actions"
>;

/**
 * One asset: what it is and where, a play row for a clip, sound or patch,
 * and its licence fields. Where the kind has its own editor below, the file
 * and licence sections start collapsed to leave it the room.
 */
export function AssetPanel({
  entry,
  readOnly,
  onLicence,
  onClose,
  notify,
  audition,
  editor = false,
}: SelectedAsset & { audition?: AssetPanelAudition; editor?: boolean }) {
  const details = [
    entry.kind,
    entry.bytes !== undefined ? formatBytes(entry.bytes) : null,
    metaLine(entry),
  ].filter((d): d is string => d !== null);
  const name = entry.name ?? baseName(entry.path);
  return (
    <div className="je-asset-panel" aria-label="Asset">
      <header className="je-asset-panel-header">
        <Icon icon={kindIcon(entry.kind)} />
        <span className="je-asset-panel-title">{name}</span>
        <IconButton
          size="icon-xs"
          icon={Cancel01Icon}
          tooltip="Back to the scene selection"
          label="Close the asset"
          onClick={onClose}
        />
      </header>
      {isAudibleKind(entry.kind) ? (
        <AssetAudition id={entry.id} name={name} size="icon-sm" {...audition} />
      ) : null}
      <InspectorSection id={`asset:${entry.kind}:details`} title="File" defaultOpen={!editor}>
        <dl className="je-asset-panel-details">
          <dt>Id</dt>
          <dd>{entry.id}</dd>
          <dt>Path</dt>
          <dd>{entry.path}</dd>
          <dt>Kind</dt>
          <dd>{details.join(" · ")}</dd>
        </dl>
      </InspectorSection>
      <InspectorSection id={`asset:${entry.kind}:licence`} title="Licence" defaultOpen={!editor}>
        <LicenceFields
          entry={entry}
          readOnly={readOnly}
          onLicence={onLicence}
          titled={false}
          {...(notify ? { notify } : {})}
        />
      </InspectorSection>
    </div>
  );
}

/**
 * A doc asset's inspector: the asset's own panel (with `audition` on its
 * play row), then the doc's fields under `label` once it opens, or a note
 * once it has left the project.
 */
export function DocAssetShell({
  asset,
  doc,
  noun,
  label,
  className,
  audition,
  children,
  ...root
}: Omit<ComponentProps<"div">, "children"> & {
  asset: SelectedAsset;
  doc: AssetDoc;
  /** What the doc is called: "This sound isn't in the project any more." */
  noun: string;
  /** The fields panel's accessible name. */
  label: string;
  audition?: AssetPanelAudition;
  children: (value: Record<string, unknown>) => ReactNode;
}) {
  return (
    <div {...root} className="je-doc-asset">
      <AssetPanel {...asset} editor {...(audition ? { audition } : {})} />
      <div
        className={className ? `je-asset-panel ${className}` : "je-asset-panel"}
        aria-label={label}
      >
        {doc.entry ? (
          <DocGate doc={doc} noun={noun}>
            {children}
          </DocGate>
        ) : (
          <SettingsNote>This {noun} isn't in the project any more.</SettingsNote>
        )}
      </div>
    </div>
  );
}

/**
 * Every live doc of `kinds` in `session`, held open while the caller is
 * mounted and read again as each changes, as one `DocLookup` (ids in path
 * order). Null without a session.
 */
export function useProjectDocs(
  session: ProjectSession | null,
  kinds: readonly AssetKindName[],
): DocLookup | null {
  const view = useProjectView(session);
  const entries = useMemo(
    () =>
      view
        ? [...view.byId.values()]
            .filter((e) => kinds.includes(e.kind))
            .sort((a, b) => byCodeUnit(a.path, b.path))
        : [],
    [view, kinds],
  );
  const key = entries.map((e) => session?.docNameFor(e) ?? "").join("\n");
  const [values, setValues] = useState<ReadonlyMap<string, unknown>>(() => new Map());
  useEffect(() => {
    if (!session) return;
    let gone = false;
    const held: { name: string; stop: () => void }[] = [];
    for (const name of key.split("\n")) {
      if (name === "") continue;
      session.open(name).then(
        (doc) => {
          if (gone) return session.release(name);
          const layout = doc.layout;
          const read = () => {
            if (layout) setValues((m) => new Map(m).set(name, layoutFromDoc(doc.doc, layout)));
          };
          doc.doc.on("update", read);
          held.push({ name, stop: () => doc.doc.off("update", read) });
          read();
        },
        () => {},
      );
    }
    return () => {
      gone = true;
      for (const { name, stop } of held) {
        stop();
        session.release(name);
      }
    };
  }, [session, key]);
  return useMemo(() => {
    if (!session || !view) return null;
    return docLookupOf(entries, (entry) => {
      const name = session.docNameFor(entry);
      return name === null ? undefined : values.get(name);
    });
  }, [session, view, entries, values]);
}

/** What the string tables and the locales are read from. */
const STRING_SOURCES: readonly AssetKindName[] = [STRINGS_KIND, GAME_SETTINGS_KIND];

const withFont = (font: AssetId | undefined) => (font === undefined ? {} : { font });

/** The project's string keys, by the shared string rules, as a string-key field picks them. */
export function stringKeyTable(lookup: DocLookup): StringKeyTable {
  const rows = mergedStrings(lookup);
  const locales = projectLocales(lookup);
  const chain = localeChain(locales, locales.default);
  return {
    keys: [...rows.keys()].sort(byCodeUnit),
    text: (key) => {
      const merged = rows.get(key);
      return merged ? stringRowText(merged.row, chain) : undefined;
    },
    problem: (key) => {
      const [issue] = stringKeyIssues(lookup, [{ key, kind: STRINGS_KIND, id: "", pointer: "" }]);
      return issue ? { message: sentence(issue.message), severity: issue.severity } : null;
    },
    ...withFont(localeFont(locales, locales.default)),
  };
}

/** The project's string keys, live, for string-key fields; null without a project. */
export function useStringKeyTable(session: ProjectSession | null): StringKeyTable | null {
  const lookup = useProjectDocs(session, STRING_SOURCES);
  return useMemo(() => (lookup ? stringKeyTable(lookup) : null), [lookup]);
}

const LOCALE_SOURCES: readonly AssetKindName[] = [GAME_SETTINGS_KIND];

/** A string table, read only: how many keys it holds and how many each locale has text for. */
export function StringsPanel({ asset, session }: Omit<AssetDocPanelProps, "registry">) {
  const doc = useSelectedAssetDoc(asset, session);
  const settings = useProjectDocs(session, LOCALE_SOURCES);
  return (
    <DocAssetShell asset={asset} doc={doc} noun="string table" label="Strings">
      {(value) => (
        <StringsSummary
          file={value as unknown as StringsFile}
          lookup={settings ?? docLookup(new Map())}
        />
      )}
    </DocAssetShell>
  );
}

function StringsSummary({ file, lookup }: { file: StringsFile; lookup: DocLookup }) {
  const locales = projectLocales(lookup);
  const rows = Array.isArray(file.strings) ? file.strings : [];
  const columns = new Set(rows.flatMap((row) => Object.keys(row).filter(isLocaleColumn)));
  const listed = [locales.default, ...locales.available.filter((l) => l !== locales.default)];
  const shown = [...listed, ...[...columns].filter((c) => !listed.includes(c)).sort(byCodeUnit)];
  return (
    <>
      <InspectorSection id="strings:locales" title="Locales">
        <div className="je-insp-stack">
          <dl className="je-asset-panel-details" aria-label="Locales">
            {shown.map((locale) => {
              const chain = localeFallbacks(locales, locale);
              const missing = rows.filter((row) => stringRowText(row, chain) === undefined).length;
              const offered = locales.available.includes(locale);
              return (
                <Fragment key={locale}>
                  <dt>
                    {locale}
                    {locale === locales.default ? " (default)" : ""}
                  </dt>
                  <dd data-locale={locale}>
                    {missing === 0 ? "All keys" : <Text variant="warning">{missing} missing</Text>}
                    {offered ? "" : ", not offered by the game settings"}
                  </dd>
                </Fragment>
              );
            })}
          </dl>
          <Text as="p" size="xs" variant="muted">
            {plural(rows.length, "key")}. Change them in the file, or with{" "}
            <Text size="xs" variant="inherit" textWrap="nowrap">
              <code>vp run scene strings import</code>
            </Text>
            .
          </Text>
        </div>
      </InspectorSection>
      <InspectorSection id="strings:keys" title="Keys">
        {rows.length === 0 ? (
          <SettingsNote>This table has no keys yet.</SettingsNote>
        ) : (
          <dl className="je-strings-keys" aria-label="Keys">
            {rows.map((row) => (
              <Fragment key={row.key}>
                <dt>{row.key}</dt>
                <dd>
                  {shown.map((locale) => {
                    const text = row[locale];
                    return (
                      <span key={locale} className="je-strings-text" data-locale={locale}>
                        <span className="je-strings-locale">{locale}</span>
                        {typeof text === "string" && text !== "" ? (
                          <span className="je-strings-value">{text}</span>
                        ) : (
                          <Text variant="warning">missing</Text>
                        )}
                      </span>
                    );
                  })}
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </InspectorSection>
    </>
  );
}

/** A dialogue, read only: its nodes, lines, speakers and endings, and what its checks find. */
export function DialoguePanel({ asset, session }: Omit<AssetDocPanelProps, "registry">) {
  const doc = useSelectedAssetDoc(asset, session);
  return (
    <DocAssetShell asset={asset} doc={doc} noun="dialogue" label="Dialogue">
      {(value) => <DialogueSummary file={value as unknown as DialogueFile} />}
    </DocAssetShell>
  );
}

function DialogueSummary({ file }: { file: DialogueFile }) {
  const nodes = Array.isArray(file.nodes) ? file.nodes : [];
  const lines = nodes.reduce((n, node) => n + (node.lines?.length ?? 0), 0);
  const choices = nodes.reduce((n, node) => n + (node.choices?.length ?? 0), 0);
  const endings = [...new Set(nodes.flatMap((node) => (node.end ? [node.end] : [])))];
  const issues = dialogueIssues(file);
  return (
    <InspectorSection id="dialogue:contents" title="Contents">
      <div className="je-insp-stack">
        <dl className="je-asset-panel-details" aria-label="Contents">
          <dt>Starts at</dt>
          <dd>{file.start}</dd>
          <dt>Nodes</dt>
          <dd>
            {plural(nodes.length, "node")}, {plural(lines, "line")}, {plural(choices, "choice")}
          </dd>
          <dt>Speakers</dt>
          <dd>{(file.speakers ?? []).map((s) => s.id).join(", ") || "None"}</dd>
          <dt>Endings</dt>
          <dd>{endings.join(", ") || "None"}</dd>
        </dl>
        {issues.length === 0 ? (
          <Text as="p" size="xs" variant="muted">
            Every node is reached from the start and leads on or ends.
          </Text>
        ) : (
          <ul className="je-asset-panel-issues" aria-label="Problems">
            {issues.map((issue, i) => (
              <li key={i}>
                <Text size="xs" variant={issue.severity === "error" ? "danger" : "warning"}>
                  {sentence(issue.message)}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </InspectorSection>
  );
}
