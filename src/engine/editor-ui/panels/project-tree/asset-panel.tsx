import { Cancel01Icon } from "@hugeicons/core-free-icons";

import type { AssetEntry } from "../../../project/index";
import { IconButton } from "../../kit/button";
import { formatBytes } from "../../kit/format";
import { Icon } from "../../kit/icon";
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
