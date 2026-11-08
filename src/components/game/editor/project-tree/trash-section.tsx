import { ArrowDown01Icon, ArrowRight01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AssetEntry } from "@jams/engine/project";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/ui/time-ago";
import { MicroLabel } from "@/components/ui/typography";

import { kindIcon } from "./kind-icons";
import { baseName, parentFolder } from "./tree-rows";

/** Trashed assets, newest first, each with Restore. Closed until opened. */
export function TrashSection({
  trash,
  readOnly,
  onRestore,
}: {
  trash: readonly AssetEntry[];
  readOnly?: boolean;
  onRestore?: (entry: AssetEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const sorted = useMemo(
    () => [...trash].sort((a, b) => (b.deleted?.at ?? 0) - (a.deleted?.at ?? 0)),
    [trash],
  );
  return (
    <section aria-label="Trash" className="flex flex-col border-t border-border pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 rounded-md py-1 pr-2 pl-2 text-left hover:bg-muted"
      >
        <HugeiconsIcon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          className="size-3 text-muted-foreground"
        />
        <HugeiconsIcon icon={Delete02Icon} className="size-3.5 text-muted-foreground" />
        <MicroLabel>Trash</MicroLabel>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{trash.length}</span>
      </button>
      {open ? (
        <ul className="max-h-48 overflow-y-auto">
          {sorted.length === 0 ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">The trash is empty.</li>
          ) : null}
          {sorted.map((entry) => (
            <li
              key={entry.key}
              className="flex items-center gap-2 rounded-md py-1 pr-1 pl-5 text-xs text-muted-foreground"
            >
              <HugeiconsIcon icon={kindIcon(entry.kind)} className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                <span className="text-foreground">{baseName(entry.path)}</span>
                {parentFolder(entry.path) ? ` in ${parentFolder(entry.path)}` : null}
              </span>
              {entry.deleted ? (
                <span className="shrink-0">
                  <TimeAgo date={new Date(entry.deleted.at)} />
                </span>
              ) : null}
              {!readOnly && onRestore ? (
                <Button
                  size="xs"
                  variant="ghost"
                  tooltip={`Put it back at ${entry.path}`}
                  aria-label={`Restore ${baseName(entry.path)}`}
                  onClick={() => onRestore(entry)}
                >
                  Restore
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
