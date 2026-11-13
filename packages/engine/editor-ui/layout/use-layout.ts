import { useCallback, useEffect, useMemo, useRef } from "react";

import { STORAGE_PREFIX, type EditorStorage } from "../host";
import { useBrowserState } from "../kit/ssr";
import { readStored, writeStored } from "../session/stored";
import {
  DEFAULT_LAYOUT,
  panelGroup,
  parseLayout,
  withPanels,
  type EditorLayout,
  type PanelId,
} from "./model";

export const LAYOUT_KEY = `${STORAGE_PREFIX}layout:v1`;
/** How long a layout change settles before it is stored. */
export const LAYOUT_WRITE_DELAY = 250;

const DEFAULT_PANELS: readonly PanelId[] = [
  ...DEFAULT_LAYOUT.left.groups.flatMap((g) => g.panels),
  ...DEFAULT_LAYOUT.right.groups.flatMap((g) => g.panels),
];

/** `DEFAULT_LAYOUT` with each of `known` it lacks in its home group, and only `known`. */
function defaultFor(known: readonly PanelId[]): EditorLayout {
  if (known === DEFAULT_PANELS) return DEFAULT_LAYOUT;
  return parseLayout(DEFAULT_LAYOUT, known) ?? DEFAULT_LAYOUT;
}

export type LayoutState = {
  layout: EditorLayout;
  /** Applies an edit from `layout/model`; stored once the changes settle. */
  update: (edit: (layout: EditorLayout) => EditorLayout) => void;
  /** Back to `DEFAULT_LAYOUT`, holding the frame's panels. */
  reset: () => void;
};

/**
 * The viewer's layout: read once from storage (after hydration when the
 * server drew the default), written once a change has settled. A null or
 * refusing storage keeps the layout for the page's life.
 */
export function useLayout(
  storage: EditorStorage | null,
  known: readonly PanelId[] = DEFAULT_PANELS,
): LayoutState {
  const knownKey = known.join("\n");
  const fallback = useMemo(() => defaultFor(known), [known]);
  const stored = useRef<EditorLayout>(fallback);
  const [layout, setLayout] = useBrowserState(() => {
    stored.current = readStored(storage, LAYOUT_KEY, fallback, (v) => parseLayout(v, known));
    return stored.current;
  }, fallback);
  const knownWas = useRef(knownKey);
  useEffect(() => {
    if (knownWas.current === knownKey) return;
    knownWas.current = knownKey;
    // A panel that arrives late (the host's Publish panel, once the editor is up, or
    // the panels a rebuild brings back) goes where the viewer last left it, or to its
    // home group; storage never replaces the layout on screen.
    setLayout((now) => {
      const arriving = known.some((panel) => !panelGroup(now, panel));
      const saved = arriving
        ? readStored(storage, LAYOUT_KEY, null, (v) => parseLayout(v, known))
        : null;
      const next = withPanels(now, known, saved);
      if (now === stored.current) stored.current = next;
      return next;
    });
  }, [knownKey, known, storage, setLayout]);
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
      writeStored(target.current, LAYOUT_KEY, layout);
    }, LAYOUT_WRITE_DELAY);
    return () => clearTimeout(timer);
  }, [layout]);

  useEffect(
    () => () => {
      const next = unsaved.current;
      if (!next) return;
      unsaved.current = null;
      stored.current = next;
      writeStored(target.current, LAYOUT_KEY, next);
    },
    [],
  );

  const update = useCallback<LayoutState["update"]>((edit) => setLayout(edit), [setLayout]);
  const reset = useCallback(() => setLayout(fallback), [setLayout, fallback]);
  return { layout, update, reset };
}
