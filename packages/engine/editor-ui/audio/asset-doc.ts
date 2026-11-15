import { useEffect, useState } from "react";

import {
  applyProjectBatch,
  layoutFromDoc,
  type ProjectSession,
  type SessionDoc,
} from "../../collab/index";
import type { Registry } from "../../game/types";
import type { AssetEntry, AssetId, ProjectOp } from "../../project/index";
import { useProjectView } from "../panels/EditorProject";
import type { SelectedAsset } from "../panels/project-tree/asset-panel";
import type { SettingsDoc } from "../panels/settings/settings-doc";
import { useOwnOrSharedPending, type OwnPendingNotify } from "../pending/use-pending";
import { useSessionDoc } from "../session/use-project-session";

/**
 * One doc asset opened for editing by id, in the shape the settings panels'
 * `DocGate` and `SettingsRows` take. `entry` is null once the asset is gone
 * (deleted or never there); there is nothing to create, so `create`
 * resolves false.
 */
export type AssetDoc = SettingsDoc;

const READ_ONLY = "This project is read-only here.";

/** The doc's value, read again on every update to it. */
function useDocValue(doc: SessionDoc | null): Record<string, unknown> | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!doc) return;
    const changed = () => bump((n) => n + 1);
    doc.doc.on("update", changed);
    return () => doc.doc.off("update", changed);
  }, [doc]);
  return doc?.layout ? layoutFromDoc(doc.doc, doc.layout) : null;
}

/**
 * `entry`'s doc, held open while the caller is mounted. Each `edit` is one
 * `applyProjectBatch` of `editAsset` ops: one history entry and one undo
 * step that co-edits like every other project edit, busy in its scope until
 * it lands, a refusal reported through `notify`.
 */
export function useEntryDoc(
  session: ProjectSession,
  entry: AssetEntry | null,
  opts: { readOnly?: boolean; notify: OwnPendingNotify },
): AssetDoc {
  const docName = entry ? session.docNameFor(entry) : null;
  const held = useSessionDoc(session, docName);
  const value = useDocValue(held.doc);
  const pending = useOwnOrSharedPending(opts.notify);
  const skew = entry ? session.skewFor(entry.kind) : null;
  const readOnly = opts.readOnly
    ? READ_ONLY
    : skew
      ? skew.message
      : held.doc?.readOnly
        ? (held.doc.issue?.message ?? READ_ONLY)
        : null;

  return {
    session,
    kind: entry?.kind ?? "",
    entry,
    docName,
    value,
    layout: held.doc?.layout ?? null,
    readOnly,
    async edit(ops: readonly ProjectOp[], label: string, scope: string) {
      if (ops.length === 0) return true;
      if (readOnly !== null) return false;
      const result = await pending.run({ label, scope, error: "Couldn't change it" }, async () => {
        const applied = await applyProjectBatch(
          session,
          { v: 1, label, ops: [...ops] },
          session.origin,
        );
        if (!applied.ok) throw new Error(applied.issue.message);
      });
      return result.ok;
    },
    create: () => Promise.resolve(false),
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

/** What a doc asset's own panel (`SoundPanel`, `SynthPanel`) takes where the inspector mounts it. */
export type AssetDocPanelProps = {
  /** The asset picked in the project tree, with its licence and close handlers. */
  asset: SelectedAsset;
  /** The project the asset is in. */
  session: ProjectSession;
  /** The game's registry: its buses, its px per metre for metric rows. */
  registry: Registry;
};
