import type { Store } from "@tanstack/store";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  actorLabel,
  applyProjectBatch,
  observeProjectLog,
  observeProjectPeers,
  projectPeers,
  projectPeersByDoc,
  readProjectLog,
  type ProjectLogEntry,
  type ProjectPeer,
  type ProjectSession,
} from "../../collab/index";
import {
  assetInfo,
  parseDocName,
  type AssetEntry,
  type AssetKey,
  type ProjectApplyResult,
  type ProjectOp,
  type ProjectView,
  type Referrer,
} from "../../project/index";
import type { EditorNotify, ProjectBlobs } from "../host";
import type { EditorProjectLink } from "../session/use-scene-editor";
import { useStoreValue } from "../session/use-store-value";
import type { SelectedAsset } from "./project-tree/asset-panel";
import { planImport } from "./project-tree/import-files";
import { ProjectTree } from "./project-tree/project-tree";
import type { DeleteRefused, ProjectTreeProps } from "./project-tree/types";

export type { EditorProjectLink };

type SessionSource<T> = {
  read(session: ProjectSession): T;
  subscribe(session: ProjectSession, changed: () => void): () => void;
};

/** `source.read(session)`, read again whenever `source` says it changed. */
function useSessionValue<T>(session: ProjectSession | null, source: SessionSource<T>): T | null {
  const [held, setHeld] = useState(() =>
    session ? { session, value: source.read(session) } : null,
  );
  useEffect(() => {
    if (!session) return;
    const update = () => setHeld({ session, value: source.read(session) });
    update();
    return source.subscribe(session, update);
  }, [session, source]);
  if (!session) return null;
  return held?.session === session ? held.value : source.read(session);
}

const VIEW: SessionSource<ProjectView> = {
  read: (session) => session.view(),
  subscribe(session, changed) {
    session.projectDoc.on("update", changed);
    return () => session.projectDoc.off("update", changed);
  },
};

const PEERS: SessionSource<ProjectPeer[]> = {
  read: (session) => projectPeers(session.awareness),
  subscribe: (session, changed) => observeProjectPeers(session.awareness, changed),
};

/** The project view, recomputed whenever the project doc changes; null without a session. */
export function useProjectView(session: ProjectSession): ProjectView;
export function useProjectView(session: ProjectSession | null): ProjectView | null;
export function useProjectView(session: ProjectSession | null): ProjectView | null {
  return useSessionValue(session, VIEW);
}

/** Everyone else in the project and the doc each is in. */
function useProjectPeers(session: ProjectSession): ReadonlyMap<string | null, ProjectPeer[]> {
  const peers = useSessionValue(session, PEERS);
  return useMemo(() => projectPeersByDoc(peers ?? []), [peers]);
}

/**
 * Agents' and the disk's changes to the project land without anyone here
 * doing them, so they're announced. Batches that wrote the scene on screen
 * are left to the scene editor, which announces them itself.
 */
function useProjectAnnouncements(session: ProjectSession, sceneDoc: string, notify: EditorNotify) {
  const scene = useRef(sceneDoc);
  const say = useRef(notify);
  useEffect(() => {
    scene.current = sceneDoc;
    say.current = notify;
  });
  useEffect(() => {
    let seen = new Set(readProjectLog(session.projectDoc).map((e) => e.id));
    const announce = (entry: ProjectLogEntry) => {
      if (entry.docs.some((d) => d.doc === scene.current)) return;
      if (entry.actor.kind === "agent") {
        say.current(`${actorLabel(entry.actor)} changed the project`, {
          description: entry.label,
        });
      } else if (entry.actor.kind === "disk") {
        say.current("The project's files changed on disk", { description: entry.label });
      }
    };
    return observeProjectLog(session.projectDoc, (entries) => {
      const fresh = entries.filter((e) => !seen.has(e.id));
      seen = new Set(entries.map((e) => e.id));
      for (const entry of fresh) announce(entry);
    });
  }, [session]);
}

const apply = (session: ProjectSession, ops: ProjectOp[], label?: string) =>
  applyProjectBatch(session, { v: 1, ...(label ? { label } : {}), ops }, session.origin);

/** A refused batch as the error the tree reports. */
function must(result: ProjectApplyResult): void {
  if (!result.ok) throw new Error(result.issue.message);
}

/** `asset-in-use`'s referrers, with each one's kind from the registry. */
function inUse(
  result: Extract<ProjectApplyResult, { ok: false }>,
  view: ProjectView,
): DeleteRefused | null {
  if (result.issue.code !== "asset-in-use") return null;
  const listed = (result.issue.detail as { referrers?: unknown } | undefined)?.referrers;
  if (!Array.isArray(listed)) return null;
  const referrers = listed.flatMap((r: { id?: unknown; pointer?: unknown }): Referrer[] =>
    typeof r?.id === "string" && typeof r.pointer === "string"
      ? [{ id: r.id, pointer: r.pointer, kind: view.byId.get(r.id)?.kind ?? "" }]
      : [],
  );
  return referrers.length > 0 ? { inUse: referrers } : null;
}

const plural = (n: number) => (n === 1 ? "1 file" : `${n} files`);

/** Uploads dropped files and imports them in one batch; a file the batch refuses is left out and the rest go in. */
async function importDropped(
  project: EditorProjectLink,
  blobs: ProjectBlobs,
  files: File[],
  folder: string,
  notify: EditorNotify,
): Promise<void> {
  const { session } = project;
  const view = session.view();
  const plan = await planImport({
    files,
    folder,
    view,
    kinds: session.kinds,
    env: { registry: session.registry, project: view },
    blobs,
  });
  const skipped = [...plan.skipped];
  let ops = plan.ops;
  while (ops.length > 0) {
    const result = await apply(
      session,
      ops.map((o) => o.op),
      ops.length === 1 ? `Import ${ops[0]!.name}` : `Import ${plural(ops.length)}`,
    );
    if (result.ok) break;
    const failed = ops[result.opIndex];
    if (!failed) throw new Error(result.issue.message);
    skipped.push({ name: failed.name, reason: result.issue.message });
    ops = ops.filter((o) => o !== failed);
  }
  if (ops.length > 0)
    notify.success(`Imported ${ops.length === 1 ? ops[0]!.name : plural(ops.length)}`);
  if (skipped.length > 0) {
    notify.error(
      `Couldn't import ${skipped.length === 1 ? skipped[0]!.name : plural(skipped.length)}`,
      {
        description: skipped
          .map((s) => (skipped.length === 1 ? s.reason : `${s.name}: ${s.reason}`))
          .join(" "),
      },
    );
  }
}

/** The registry key of the doc on screen: the open prefab's, else the scene's. */
function openKey(view: ProjectView, sceneDoc: string, prefab: string | undefined): AssetKey | null {
  if (prefab) return view.byId.get(prefab)?.key ?? null;
  const ref = parseDocName(sceneDoc);
  return ref && ref.kind !== "project" ? ref.key : null;
}

/**
 * The project tree over a live project session: the registry as folders,
 * assets and code, everyone else on the doc they're in, and each edit as a
 * project op (rename, move, trash and restore, and import of dropped
 * files). Picking an asset puts it in `selected`, for the inspector; asset
 * and atlas frame rows drag onto the scene canvas to place them.
 */
export function EditorProject({
  project,
  selected,
  prefab,
  notify,
}: {
  project: EditorProjectLink;
  selected: Store<AssetKey | null>;
  /** The prefab open on its own, by id. */
  prefab?: string;
  /** Where announcements, imports and failed edits are reported. */
  notify: EditorNotify;
}) {
  const { session, doc, blobs, readOnly = false } = project;
  const view = useProjectView(session);
  const peersByDoc = useProjectPeers(session);
  useProjectAnnouncements(session, doc, notify);
  const picked = useStoreValue(selected);
  const nodes = useMemo(() => view.tree(), [view]);
  const infoOf = useMemo<NonNullable<ProjectTreeProps["assetInfo"]>>(
    () => (entry, frame) => assetInfo(view, entry.id, frame),
    [view],
  );

  const handlers: Pick<
    ProjectTreeProps,
    "onOpen" | "onRename" | "onMove" | "onDelete" | "onRestore" | "onDropFiles"
  > = {
    onOpen: (entry) => selected.setState(() => entry.key),
    onRename: async (entry, { file }) =>
      must(await apply(session, [{ op: "renameAsset", id: entry.id, file }])),
    onMove: async (ids, to) => must(await apply(session, [{ op: "moveAsset", ids, to }])),
    async onDelete(entry, { force }) {
      const result = await apply(session, [
        { op: "deleteAsset", id: entry.id, ...(force ? { force: true } : {}) },
      ]);
      if (result.ok) {
        if (selected.state === entry.key) selected.setState(() => null);
        return;
      }
      const refused = inUse(result, session.view());
      if (refused && !force) return refused;
      throw new Error(result.issue.message);
    },
    onRestore: async (entry) => must(await apply(session, [{ op: "restoreAsset", id: entry.id }])),
    ...(blobs
      ? {
          onDropFiles: (files: File[], folder: string) =>
            importDropped(project, blobs, files, folder, notify),
        }
      : {}),
  };

  return (
    <ProjectTree
      projectId={session.project}
      projectName={view.state.meta.name || session.project}
      nodes={nodes}
      trash={view.deleted}
      peersByDoc={peersByDoc}
      activeKey={picked ?? openKey(view, doc, prefab)}
      readOnly={readOnly}
      assetInfo={infoOf}
      notify={notify}
      {...handlers}
    />
  );
}

/**
 * The asset picked in the tree as the inspector shows it, while it is live
 * in the registry; its licence is written through `setLicence`. Picking
 * something in the scene puts the inspector back on the scene's selection.
 */
export function useSelectedAsset(
  project: EditorProjectLink | undefined,
  selected: Store<AssetKey | null>,
  sceneSelection: readonly string[],
  notify?: EditorNotify,
): SelectedAsset | undefined {
  const key = useStoreValue(selected);
  const last = useRef(sceneSelection);
  useEffect(() => {
    if (last.current === sceneSelection) return;
    last.current = sceneSelection;
    if (sceneSelection.length > 0) selected.setState(() => null);
  }, [sceneSelection, selected]);
  const view = useProjectView(project?.session ?? null);
  const entry: AssetEntry | undefined = key && view ? view.byKey.get(key) : undefined;
  if (!project || !entry) return undefined;
  const { session, readOnly } = project;
  return {
    entry,
    readOnly,
    onLicence: async (asset, licence) =>
      must(await apply(session, [{ op: "setLicence", id: asset.id, licence }])),
    onClose: () => selected.setState(() => null),
    ...(notify ? { notify } : {}),
  };
}
