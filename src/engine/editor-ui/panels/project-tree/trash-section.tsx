import { ArrowDown01Icon, ArrowRight01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";

import type { AssetEntry } from "../../../project/index";
import { Button } from "../../kit/button";
import { Icon } from "../../kit/icon";
import { MicroLabel } from "../../kit/text";
import { TimeAgo } from "../../kit/time-ago";
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
    <section aria-label="Trash" className="je-trash">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="je-trash-toggle"
      >
        <Icon
          icon={open ? ArrowDown01Icon : ArrowRight01Icon}
          size={12}
          className="je-ptree-muted"
        />
        <Icon icon={Delete02Icon} className="je-ptree-muted" />
        <MicroLabel>Trash</MicroLabel>
        <span className="je-ptree-count" data-end="">
          {trash.length}
        </span>
      </button>
      {open ? (
        <ul className="je-trash-list">
          {sorted.length === 0 ? <li className="je-ptree-empty">The trash is empty.</li> : null}
          {sorted.map((entry) => (
            <li key={entry.key} className="je-trash-item">
              <Icon icon={kindIcon(entry.kind)} />
              <span className="je-trash-name">
                <span className="je-ptree-strong">{baseName(entry.path)}</span>
                {parentFolder(entry.path) ? ` in ${parentFolder(entry.path)}` : null}
              </span>
              {entry.deleted ? (
                <span className="je-trash-when">
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
