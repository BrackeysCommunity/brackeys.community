import type {
  AssetId,
  AssetKey,
  AssetKindName,
  AssetPath,
  ProjectId,
  Sha256,
} from "../project/types";

/** The stateless message type the server sends on a project doc when a binary's bytes change. */
export const ASSET_CHANGED = "asset:changed";

/** What an `asset:changed` stateless message holds, as JSON: hot reload refetches `sha256`. */
export type AssetChangedMessage = {
  type: typeof ASSET_CHANGED;
  project: ProjectId;
  key: AssetKey;
  id: AssetId;
  kind: AssetKindName;
  path: AssetPath;
  sha256: Sha256;
  bytes: number;
  /** The hash it held before. */
  previous: Sha256 | null;
};
