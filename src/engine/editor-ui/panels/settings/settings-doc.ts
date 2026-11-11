import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyProjectBatch,
  layoutFromDoc,
  setProjectPresence,
  type ProjectSession,
  type SessionDoc,
} from "../../../collab/index";
import { PROJECT_PRESENCE_FIELD, type ProjectPresence } from "../../../collab/types";
import type { AssetEntry, AssetKindName, DocLayout, ProjectOp } from "../../../project/index";
import { perProjectEntries } from "../../../project/kinds/define";
import type { EditorNotify } from "../../host";
import { useOwnOrSharedPending } from "../../pending/use-pending";
import { useSessionDoc } from "../../session/use-project-session";
import type { EditorProjectLink } from "../../session/use-scene-editor";
import { useProjectView } from "../EditorProject";

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
  /** Creates the kind's asset from its `empty`, at the project's root. */
  create(): Promise<boolean>;
};

/** The pending scope of one setting: its doc and the dot path the edit writes. */
export const settingScope = (doc: string | null, path: string) => `settings:${doc ?? ""}:${path}`;

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
 * The project's `kind` asset (the first live one by path) with its doc held
 * open while the panel is mounted. Edits and Create run through the
 * editor's pending tasks, reporting a refusal through `notify`.
 */
export function useSettingsDoc(
  project: EditorProjectLink,
  kind: AssetKindName,
  notify: EditorNotify,
): SettingsDoc {
  const { session } = project;
  const view = useProjectView(session);
  const entry = perProjectEntries(view, kind)[0] ?? null;
  const docName = entry ? session.docNameFor(entry) : null;
  const held = useSessionDoc(session, docName);
  const value = useDocValue(held.doc);
  const pending = useOwnOrSharedPending(notify);
  const skew = session.skewFor(kind);
  const readOnly = project.readOnly
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

  return {
    session,
    kind,
    entry,
    docName,
    value,
    layout: held.doc?.layout ?? null,
    readOnly,
    edit: (ops, label, scope) =>
      ops.length === 0 ? Promise.resolve(true) : apply(ops, label, scope, "Couldn't change it"),
    create: () => {
      const def = session.kinds.get(kind);
      return apply(
        [{ op: "createAsset", kind, path: "" }],
        `Create ${def?.title.toLowerCase() ?? kind}`,
        `settings:create:${kind}`,
        `Couldn't create the ${def?.title.toLowerCase() ?? kind}`,
      );
    },
  };
}

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
