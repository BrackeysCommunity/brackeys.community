import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AssetEntry } from "@jams/engine/project";

import { formatBytes } from "@/components/canvas/io/markdown-seam";
import { Button } from "@/components/ui/button";

import { kindIcon } from "./kind-icons";
import { LicenceFields } from "./licence-fields";
import { baseName } from "./tree-rows";
import type { LicenceFieldsProps } from "./types";

/** The asset picked in the project tree, as the inspector shows it. */
export type SelectedAsset = Pick<LicenceFieldsProps, "entry" | "readOnly" | "onLicence"> & {
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
export function AssetPanel({ entry, readOnly, onLicence, onClose }: SelectedAsset) {
  const details = [
    entry.kind,
    entry.bytes !== undefined ? formatBytes(entry.bytes) : null,
    metaLine(entry),
  ].filter((d): d is string => d !== null);
  return (
    <div className="flex w-full flex-col gap-3 p-2" aria-label="Asset">
      <header className="flex items-center gap-2 text-xs">
        <HugeiconsIcon icon={kindIcon(entry.kind)} className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {entry.name ?? baseName(entry.path)}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          tooltip="Back to the scene selection"
          aria-label="Close the asset"
          onClick={onClose}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
      </header>
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Id</dt>
        <dd className="truncate">{entry.id}</dd>
        <dt className="text-muted-foreground">Path</dt>
        <dd className="truncate">{entry.path}</dd>
        <dt className="text-muted-foreground">Kind</dt>
        <dd className="truncate">{details.join(" · ")}</dd>
      </dl>
      <LicenceFields entry={entry} readOnly={readOnly} onLicence={onLicence} />
    </div>
  );
}
