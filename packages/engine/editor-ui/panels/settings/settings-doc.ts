import { useEffect, useMemo, useRef } from "react";

import { applyProjectBatch, setProjectPresence, type ProjectSession } from "../../../collab/index";
import { PROJECT_PRESENCE_FIELD, type ProjectPresence } from "../../../collab/types";
import type { Registry } from "../../../game/types";
import type {
  AssetEntry,
  AssetId,
  AssetKindName,
  DocLayout,
  JsonEdit,
  ProjectOp,
} from "../../../project/index";
import { perProjectEntries } from "../../../project/kinds/define";
import type { EditorNotify } from "../../host";
import { useOwnOrSharedPending, type OwnPendingNotify } from "../../pending/use-pending";
import { useDocValue, useSessionDoc } from "../../session/use-project-session";
import type { EditorProjectLink } from "../../session/use-scene-editor";
import { useProjectView } from "../EditorProject";
import type { SelectedAsset } from "../project-tree/asset-panel";

/** One of the project's one-per-project settings docs, as a panel edits it. */
export type SettingsDoc = {
  session: ProjectSession;
  kind: AssetKindName;
  /** The asset in effect; null while the project has none. */
  entry: AssetEntry | null;
  /** Its doc's name; null without an entry. */
  docName: string | null;
  /** The doc's value as it is now; null until it has opened. */
  value: Record<string, unknown> | null;
  layout: DocLayout | null;
  /** Why it takes no edits; null when it does. */
  readOnly: string | null;
  /** Applies `ops` as one batch: one history entry and one undo step, busy in `scope` until it lands. */
  edit(ops: readonly ProjectOp[], label: string, scope: string): Promise<boolean>;
  /** Creates the kind's asset from its `empty` over the project (a scene list lists every scene by path, the first as start), at the project's root. */
  create(): Promise<boolean>;
};

/** The pending scope of one setting: its doc and the dot path the edit writes. */
export const settingScope = (doc: string | null, path: string) => `settings:${doc ?? ""}:${path}`;

const READ_ONLY = "This project is read-only here.";

/** A doc asset opened for editing by id; `entry` is null once the asset is gone, and `create` resolves false. */
export type AssetDoc = SettingsDoc;

function useHeldDoc(
  session: ProjectSession,
  entry: AssetEntry | null,
  kind: AssetKindName,
  opts: { readOnly?: boolean; notify: OwnPendingNotify },
) {
  const docName = entry ? session.docNameFor(entry) : null;
  const held = useSessionDoc(session, docName);
  const value = useDocValue(held.doc);
  const pending = useOwnOrSharedPending(opts.notify);
  const skew = kind ? session.skewFor(kind) : null;
  const readOnly = opts.readOnly
    ? READ_ONLY
    : skew
      ? skew.message
      : held.doc?.readOnly
        ? (held.doc.issue?.message ?? READ_ONLY)
        : null;

  const apply = async (ops: readonly ProjectOp[], label: string, scope: string, error: string) => {
    const result = await pending.run({ label, scope, error }, async () => {
      const applied = await applyProjectBatch(
        session,
        { v: 1, label, ops: [...ops] },
        session.origin,
      );
      if (!applied.ok) throw new Error(applied.issue.message);
    });
    return result.ok;
  };

  const doc: SettingsDoc = {
    session,
    kind,
    entry,
    docName,
    value,
    layout: held.doc?.layout ?? null,
    readOnly,
    edit(ops, label, scope) {
      if (ops.length === 0) return Promise.resolve(true);
      if (readOnly !== null) return Promise.resolve(false);
      return apply(ops, label, scope, "Couldn't change it");
    },
    create: () => Promise.resolve(false),
  };
  return { doc, apply };
}

/**
 * `entry`'s doc, held open while the caller is mounted. Each `edit` is one
 * `applyProjectBatch`: one history entry and one undo step that co-edits
 * like every other project edit, busy in its scope until it lands, a
 * refusal reported through `notify`.
 */
export function useEntryDoc(
  session: ProjectSession,
  entry: AssetEntry | null,
  opts: { readOnly?: boolean; notify: OwnPendingNotify },
): AssetDoc {
  return useHeldDoc(session, entry, entry?.kind ?? "", opts).doc;
}

/**
 * The project's `kind` asset (the first live one by path) with its doc held
 * open while the panel is mounted (`useEntryDoc`), and a Create for when
 * the project has none.
 */
export function useSettingsDoc(
  project: EditorProjectLink,
  kind: AssetKindName,
  notify: EditorNotify,
): SettingsDoc {
  const { session } = project;
  const view = useProjectView(session);
  const entry = perProjectEntries(view, kind)[0] ?? null;
  const { doc, apply } = useHeldDoc(session, entry, kind, {
    readOnly: project.readOnly,
    notify,
  });
  return {
    ...doc,
    create: () => {
      const title = session.kinds.get(kind)?.title.toLowerCase() ?? kind;
      return apply(
        [{ op: "createAsset", kind, path: "" }],
        `Create ${title}`,
        `settings:create:${kind}`,
        `Couldn't create the ${title}`,
      );
    },
  };
}

/** The live asset `id`'s doc, held open while the caller is mounted (`useEntryDoc`). */
export function useAssetDoc(
  session: ProjectSession,
  id: AssetId | null,
  opts: { readOnly?: boolean; notify: OwnPendingNotify },
): AssetDoc {
  const view = useProjectView(session);
  const entry = (id !== null ? view.byId.get(id) : undefined) ?? null;
  return useEntryDoc(session, entry, opts);
}

/** The asset picked in the project tree, its doc held open (`useAssetDoc`); a refusal with no `notify` goes to the console. */
export function useSelectedAssetDoc(asset: SelectedAsset, session: ProjectSession): AssetDoc {
  const notify = asset.notify ?? { error: (message: string) => console.error(message) };
  return useAssetDoc(session, asset.entry.id, {
    ...(asset.readOnly ? { readOnly: true } : {}),
    notify,
  });
}

/** One `editAsset` batch of `edits` to the doc's asset, as one undo step. */
export function editAssetJson(
  doc: AssetDoc,
  edits: readonly JsonEdit[],
  label: string,
  scope: string,
): void {
  if (!doc.entry) return;
  void doc.edit([{ op: "editAsset", id: doc.entry.id, edits: [...edits] }], label, scope);
}

/** What a doc asset's own panel (`SoundPanel`, `SynthPanel`) takes where the inspector mounts it. */
export type AssetDocPanelProps = {
  /** The asset picked in the project tree, with its licence and close handlers. */
  asset: SelectedAsset;
  /** The project the asset is in. */
  session: ProjectSession;
  /** The game's registry: its buses, its px per metre for metric rows. */
  registry: Registry;
};

const presenceDoc = (session: ProjectSession): string | null => {
  const own = session.awareness.getLocalState()?.[PROJECT_PRESENCE_FIELD] as
    | Partial<ProjectPresence>
    | undefined;
  return typeof own?.doc === "string" ? own.doc : null;
};

/**
 * Focus handlers that put `docName` in this client's project presence
 * while focus is inside the element they're spread on, and put back the
 * doc it showed before once focus leaves, unless the editor has moved it
 * elsewhere meanwhile.
 */
export function usePresenceIn(session: ProjectSession, docName: string | null) {
  const before = useRef<{ doc: string | null } | null>(null);
  const leave = useMemo(
    () => () => {
      const was = before.current;
      before.current = null;
      if (was && presenceDoc(session) === docName)
        setProjectPresence(session.awareness, { doc: was.doc });
    },
    [session, docName],
  );
  useEffect(() => leave, [leave]);
  return useMemo(
    () => ({
      onFocus: () => {
        if (!docName || before.current) return;
        before.current = { doc: presenceDoc(session) };
        setProjectPresence(session.awareness, { doc: docName });
      },
      onBlur: (e: { currentTarget: Element; relatedTarget: EventTarget | null }) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        leave();
      },
    }),
    [session, docName, leave],
  );
}
