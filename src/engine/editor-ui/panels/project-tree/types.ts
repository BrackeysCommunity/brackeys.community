import type { ProjectPeer } from "../../../collab/index";
import type {
  AssetEntry,
  AssetId,
  AssetKey,
  Licence,
  ProjectId,
  AssetInfo,
  ProjectTreeNode,
  Referrer,
} from "../../../project/index";
import type { EditorNotify } from "../../host";
import type { PendingStep } from "../../pending/pending";

/** What a delete asks for: `force` once the person chose "Delete anyway" over `referrers`. */
export type DeleteRequest = { force: boolean; referrers: readonly Referrer[] };

/** A delete the store refused because the asset is still referenced: the dialog reopens listing them. */
export type DeleteRefused = { inUse: readonly Referrer[] };

/**
 * Callbacks may return a promise, which keeps their row busy until it
 * settles; a rejection shows its message through `notify.error`.
 */
type Result<T = void> = T | Promise<T>;

/**
 * The project tree as props: the host passes the view's tree, its trash and
 * the project peers, and turns each callback into a project op. The tree
 * holds no session and talks to no provider.
 */
export type ProjectTreeProps = {
  projectId: ProjectId;
  /** Shown on the root row. */
  projectName: string;
  /** `projectView(state).tree()`. */
  nodes: readonly ProjectTreeNode[];
  /** `projectView(state).deleted`. */
  trash?: readonly AssetEntry[];
  /** `projectPeersByDoc(peers)`: doc name to the peers in it, `null` for the overview. */
  peersByDoc?: ReadonlyMap<string | null, readonly ProjectPeer[]>;
  /** The open asset, highlighted. */
  activeKey?: AssetKey | null;
  /** The registry is still loading. */
  loading?: boolean;
  /** Viewers: no drag, rename, delete, restore or drop. */
  readOnly?: boolean;
  /** Who names an asset, asked before a delete so the dialog can list them. */
  referrersOf?: (id: AssetId) => readonly Referrer[];
  onOpen?: (entry: AssetEntry) => void;
  /** A new file name in the same folder (`renameAsset`'s `file`). */
  onRename?: (entry: AssetEntry, change: { file: string }) => Result;
  /** Into `to`, which ends with "/" or is "" for the root (`moveAsset`). */
  onMove?: (ids: AssetId[], to: string) => Result;
  onDelete?: (entry: AssetEntry, request: DeleteRequest) => Result<void | DeleteRefused>;
  onRestore?: (entry: AssetEntry) => Result;
  /**
   * An asset's info (with `frame`, that frame's). Given, asset and frame
   * rows drag onto the scene canvas carrying it, and an atlas row lists its
   * frames.
   */
  assetInfo?: (entry: AssetEntry, frame?: string) => AssetInfo | null;
  /**
   * Files dropped on the panel or on a folder row; `folder` as `onMove`'s
   * `to`. `step` reports the import's progress (files done of all dropped)
   * and what it's doing now; the folder shows both until it settles.
   */
  onDropFiles?: (files: File[], folder: string, step: PendingStep) => Result;
  /** Where a failed callback is reported; default the console. */
  notify?: Pick<EditorNotify, "error">;
};

/** The licence fields' props: one asset's licence, written whole through `setLicence`. */
export type LicenceFieldsProps = {
  entry: AssetEntry;
  readOnly?: boolean;
  /** `null` when every field is cleared. */
  onLicence?: (entry: AssetEntry, licence: Licence | null) => Result;
  /** Where a failed write is reported; default the console. */
  notify?: Pick<EditorNotify, "error">;
};
