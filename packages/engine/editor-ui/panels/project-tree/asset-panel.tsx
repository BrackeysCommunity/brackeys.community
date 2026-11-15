import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Fragment, useEffect, useMemo, useState } from "react";

import { layoutFromDoc, type ProjectSession } from "../../../collab/index";
import { capitalise } from "../../../game/live";
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
import { localeChain, localeFallbacks, stringRowText } from "../../../project/kinds/strings";
import { useAssetDoc, type AssetDocPanelProps } from "../../audio/asset-doc";
import { IconButton } from "../../kit/button";
import { formatBytes } from "../../kit/format";
import { Icon } from "../../kit/icon";
import { Text } from "../../kit/index";
import { useProjectView } from "../EditorProject";
import type { StringKeyTable } from "../inspector/field-widgets";
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

/** An image's or a font's size as its kind's inspection read it. */
function metaLine(entry: AssetEntry): string | null {
  const meta = entry.meta;
  if (!meta) return null;
  const { width, height } = meta as { width?: unknown; height?: unknown };
  return typeof width === "number" && typeof height === "number" ? `${width} × ${height}` : null;
}

/** One asset: what it is and where, and its licence fields. */
export function AssetPanel({ entry, readOnly, onLicence, onClose, notify }: SelectedAsset) {
  const details = [
    entry.kind,
    entry.bytes !== undefined ? formatBytes(entry.bytes) : null,
    metaLine(entry),
  ].filter((d): d is string => d !== null);
  return (
    <div className="je-asset-panel" aria-label="Asset">
      <header className="je-asset-panel-header">
        <Icon icon={kindIcon(entry.kind)} />
        <span className="je-asset-panel-title">{entry.name ?? baseName(entry.path)}</span>
        <IconButton
          size="icon-xs"
          icon={Cancel01Icon}
          tooltip="Back to the scene selection"
          label="Close the asset"
          onClick={onClose}
        />
      </header>
      <dl className="je-asset-panel-details">
        <dt>Id</dt>
        <dd>{entry.id}</dd>
        <dt>Path</dt>
        <dd>{entry.path}</dd>
        <dt>Kind</dt>
        <dd>{details.join(" · ")}</dd>
      </dl>
      <LicenceFields
        entry={entry}
        readOnly={readOnly}
        onLicence={onLicence}
        {...(notify ? { notify } : {})}
      />
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
    const byKind = new Map<AssetKindName, Map<AssetId, unknown>>();
    const ids = new Map<AssetKindName, AssetId[]>();
    for (const entry of entries) {
      ids.set(entry.kind, [...(ids.get(entry.kind) ?? []), entry.id]);
      const name = session.docNameFor(entry);
      if (name === null || !values.has(name)) continue;
      const docs = byKind.get(entry.kind) ?? new Map<AssetId, unknown>();
      docs.set(entry.id, values.get(name));
      byKind.set(entry.kind, docs);
    }
    return docLookup(byKind, ids);
  }, [session, view, entries, values]);
}

/** What the string tables and the locales are read from. */
const STRING_SOURCES: readonly AssetKindName[] = [STRINGS_KIND, GAME_SETTINGS_KIND];

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
      return issue ? { message: capitalise(issue.message), severity: issue.severity } : null;
    },
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
  const notify = asset.notify ?? { error: (message: string) => console.error(message) };
  const doc = useAssetDoc(session, asset.entry.id, {
    ...(asset.readOnly ? { readOnly: true } : {}),
    notify,
  });
  const settings = useProjectDocs(session, LOCALE_SOURCES);
  return (
    <div className="je-doc-asset">
      <AssetPanel {...asset} />
      <div className="je-asset-panel" aria-label="Strings">
        {doc.entry ? (
          <DocGate doc={doc} noun="string table">
            {(value) => (
              <StringsSummary
                file={value as unknown as StringsFile}
                lookup={settings ?? docLookup(new Map())}
              />
            )}
          </DocGate>
        ) : (
          <SettingsNote>This string table isn't in the project any more.</SettingsNote>
        )}
      </div>
    </div>
  );
}

const isLocaleColumn = (column: string) => column !== "key" && column !== "note";

function StringsSummary({ file, lookup }: { file: StringsFile; lookup: DocLookup }) {
  const locales = projectLocales(lookup);
  const rows = Array.isArray(file.strings) ? file.strings : [];
  const columns = new Set(rows.flatMap((row) => Object.keys(row).filter(isLocaleColumn)));
  const listed = [locales.default, ...locales.available.filter((l) => l !== locales.default)];
  const shown = [...listed, ...[...columns].filter((c) => !listed.includes(c)).sort(byCodeUnit)];
  return (
    <>
      <Text as="p" size="xs" variant="muted">
        {rows.length === 1 ? "1 key" : `${rows.length} keys`}. Edit the file to change them.
      </Text>
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
                {missing === 0 ? "All keys" : `${missing} missing`}
                {offered ? "" : ", not offered by the game settings"}
              </dd>
            </Fragment>
          );
        })}
      </dl>
    </>
  );
}

/** A dialogue, read only: its nodes, lines, speakers and endings, and what its checks find. */
export function DialoguePanel({ asset, session }: Omit<AssetDocPanelProps, "registry">) {
  const notify = asset.notify ?? { error: (message: string) => console.error(message) };
  const doc = useAssetDoc(session, asset.entry.id, {
    ...(asset.readOnly ? { readOnly: true } : {}),
    notify,
  });
  return (
    <div className="je-doc-asset">
      <AssetPanel {...asset} />
      <div className="je-asset-panel" aria-label="Dialogue">
        {doc.entry ? (
          <DocGate doc={doc} noun="dialogue">
            {(value) => <DialogueSummary file={value as unknown as DialogueFile} />}
          </DocGate>
        ) : (
          <SettingsNote>This dialogue isn't in the project any more.</SettingsNote>
        )}
      </div>
    </div>
  );
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function DialogueSummary({ file }: { file: DialogueFile }) {
  const nodes = Array.isArray(file.nodes) ? file.nodes : [];
  const lines = nodes.reduce((n, node) => n + (node.lines?.length ?? 0), 0);
  const choices = nodes.reduce((n, node) => n + (node.choices?.length ?? 0), 0);
  const endings = [...new Set(nodes.flatMap((node) => (node.end ? [node.end] : [])))];
  const issues = dialogueIssues(file);
  return (
    <>
      <dl className="je-asset-panel-details" aria-label="Contents">
        <dt>Starts at</dt>
        <dd>{file.start}</dd>
        <dt>Nodes</dt>
        <dd>
          {count(nodes.length, "node")}, {count(lines, "line")}, {count(choices, "choice")}
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
                {capitalise(issue.message)}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
