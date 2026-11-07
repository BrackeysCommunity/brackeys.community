import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  buildOutline,
  outlineOrder,
  type EditorSession,
  type OutlineRow,
} from "@jams/engine/editor";
import { useMemo, useState } from "react";

import { MicroLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { useEditorDoc, useEditorStore } from "./use-editor-store";

const COLLAPSE_KEY = "game-editor:outline-collapsed";

/** Explicit open/closed choices per row key; rows without one use the default. */
function readCollapsed(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeCollapsed(value: Record<string, boolean>) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private windows, blocked site data); collapse state is a convenience.
  }
}

/** Buckets start closed, since one can hold hundreds of rows. */
const collapsedByDefault = (row: OutlineRow) => row.kind === "bucket";

function visibleRows(rows: OutlineRow[], collapsed: Record<string, boolean>): OutlineRow[] {
  const out: OutlineRow[] = [];
  let hiddenBelow: number | null = null;
  for (const row of rows) {
    if (hiddenBelow !== null && row.depth > hiddenBelow) continue;
    hiddenBelow = null;
    out.push(row);
    const closed = collapsed[row.key] ?? collapsedByDefault(row);
    if ((row.kind === "layer" || row.kind === "bucket") && closed) hiddenBelow = row.depth;
  }
  return out;
}

export function EditorOutliner({ session }: { session: EditorSession }) {
  const doc = useEditorDoc(session);
  const sceneName = useEditorStore(session, (s) => s.sceneName);
  const selection = useEditorStore(session, (s) => s.selection);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const rows = useMemo(() => buildOutline(doc), [doc]);
  const shown = useMemo(() => visibleRows(rows, collapsed), [rows, collapsed]);
  const order = useMemo(() => outlineOrder(shown), [shown]);
  const selected = new Set(selection);

  const toggle = (row: OutlineRow) => {
    const next = { ...collapsed, [row.key]: !(collapsed[row.key] ?? collapsedByDefault(row)) };
    setCollapsed(next);
    writeCollapsed(next);
  };

  return (
    <nav aria-label="Outliner" className="flex min-h-0 w-full flex-col gap-1 p-1">
      <div className="px-2 pt-1 text-sm font-medium">{sceneName}</div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((row) => {
          const indent = { paddingLeft: `${row.depth * 12 + 8}px` };
          if (row.kind === "layer" || row.kind === "bucket") {
            const open = !(collapsed[row.key] ?? collapsedByDefault(row));
            return (
              <li key={row.key}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(row)}
                  className="flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left hover:bg-muted"
                  style={indent}
                >
                  <HugeiconsIcon
                    icon={open ? ArrowDown01Icon : ArrowRight01Icon}
                    className="size-3 text-muted-foreground"
                  />
                  {row.kind === "layer" ? (
                    <MicroLabel>{row.label}</MicroLabel>
                  ) : (
                    <span className="text-xs">{row.label}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {row.count}
                  </span>
                </button>
              </li>
            );
          }
          const ref = row.ref;
          return (
            <li key={row.key}>
              <button
                type="button"
                disabled={!ref}
                aria-pressed={ref ? selected.has(ref) : undefined}
                onClick={(e) => {
                  if (!ref) return;
                  const mode = e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "replace";
                  session.select([ref], mode, order);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-xs disabled:cursor-default",
                  ref && selected.has(ref) ? "bg-primary/15 text-foreground" : "hover:bg-muted",
                )}
                style={indent}
              >
                <span className="truncate">{row.label}</span>
                {row.detail ? (
                  <span className="ml-auto shrink-0 text-muted-foreground">{row.detail}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
