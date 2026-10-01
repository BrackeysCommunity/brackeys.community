import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { useEffect, useEffectEvent, useRef } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

import { CANVAS_LIMITS } from "@/lib/canvas/limits";

/**
 * Text undo history per card, kept after the editor closes: `yCollab` would
 * otherwise start a fresh one on every open, and ⌘Z would forget what you
 * typed a minute ago.
 */
const undoManagers = new WeakMap<Y.Text, Y.UndoManager>();

function undoManagerFor(text: Y.Text): Y.UndoManager {
  let manager = undoManagers.get(text);
  if (!manager) {
    manager = new Y.UndoManager(text);
    undoManagers.set(text, manager);
  }
  return manager;
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "0.875rem", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6", padding: "0.75rem" },
  ".cm-content": { padding: 0, caretColor: "var(--foreground)" },
  ".cm-line": { padding: 0 },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent) !important",
  },
});

/** Past the card's character cap, further input is refused. */
const maxLength = EditorState.changeFilter.of(
  (tr) =>
    tr.newDoc.length <= CANVAS_LIMITS.maxCardText || tr.newDoc.length <= tr.startState.doc.length,
);

/**
 * CodeMirror on one card's `Y.Text`. Only one is ever mounted: every other
 * card renders its text statically and re-renders when it changes.
 */
export function CardTextEditor({ text, onDone }: { text: Y.Text; onDone: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const finish = useEffectEvent(() => onDone());

  useEffect(() => {
    if (!host.current) return;
    // Tearing the editor down blurs it; that blur isn't the member leaving.
    let tearingDown = false;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text.toJSON(),
        extensions: [
          // First, so ⌘Z reaches this card's own text history.
          keymap.of(yUndoManagerKeymap),
          keymap.of([
            {
              key: "Escape",
              run: () => {
                finish();
                return true;
              },
            },
            ...defaultKeymap,
          ]),
          drawSelection(),
          EditorView.lineWrapping,
          markdown(),
          placeholder("Write something…"),
          maxLength,
          theme,
          yCollab(text, null, { undoManager: undoManagerFor(text) }),
          EditorView.domEventHandlers({
            blur: () => {
              if (!tearingDown) finish();
              return false;
            },
          }),
        ],
      }),
    });
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return () => {
      tearingDown = true;
      view.destroy();
    };
  }, [text]);

  return <div ref={host} className="nodrag nowheel nopan nokey h-full cursor-text" />;
}
