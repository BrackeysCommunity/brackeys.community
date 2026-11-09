import { useCallback, useEffect, useRef, useState } from "react";

import { STORAGE_PREFIX, type EditorStorage } from "../host";
import { DEFAULT_LAYOUT, parseLayout, type EditorLayout, type PanelId } from "./model";

export const LAYOUT_KEY = `${STORAGE_PREFIX}layout:v1`;
/** How long a layout change settles before it is stored. */
export const LAYOUT_WRITE_DELAY = 250;

const DEFAULT_PANELS: readonly PanelId[] = [
  ...DEFAULT_LAYOUT.left.groups.flatMap((g) => g.panels),
  ...DEFAULT_LAYOUT.right.groups.flatMap((g) => g.panels),
];

export type LayoutState = {
  layout: EditorLayout;
  /** Applies an edit from `layout/model`; stored once the changes settle. */
  update: (edit: (layout: EditorLayout) => EditorLayout) => void;
  /** Back to `DEFAULT_LAYOUT`. */
  reset: () => void;
};

function readLayout(storage: EditorStorage | null, known: readonly PanelId[]): EditorLayout {
  if (!storage) return DEFAULT_LAYOUT;
  try {
    return parseLayout(storage.get(LAYOUT_KEY), known) ?? DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeLayout(storage: EditorStorage | null, layout: EditorLayout): void {
  try {
    storage?.set(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // A refusing storage keeps the layout for the page's life only.
  }
}

/**
 * The viewer's layout: read once from storage, written once a change has
 * settled. A null or refusing storage keeps the layout for the page's life.
 */
export function useLayout(
  storage: EditorStorage | null,
  known: readonly PanelId[] = DEFAULT_PANELS,
): LayoutState {
  const [layout, setLayout] = useState(() => readLayout(storage, known));
  const stored = useRef(layout);
  const unsaved = useRef<EditorLayout | null>(null);
  const target = useRef(storage);
  useEffect(() => {
    target.current = storage;
  }, [storage]);

  useEffect(() => {
    if (layout === stored.current) return;
    unsaved.current = layout;
    const timer = setTimeout(() => {
      unsaved.current = null;
      stored.current = layout;
      writeLayout(target.current, layout);
    }, LAYOUT_WRITE_DELAY);
    return () => clearTimeout(timer);
  }, [layout]);

  useEffect(
    () => () => {
      const next = unsaved.current;
      if (!next) return;
      unsaved.current = null;
      stored.current = next;
      writeLayout(target.current, next);
    },
    [],
  );

  const update = useCallback<LayoutState["update"]>((edit) => setLayout(edit), []);
  const reset = useCallback(() => setLayout(DEFAULT_LAYOUT), []);
  return { layout, update, reset };
}
