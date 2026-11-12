import type { Store } from "@tanstack/store";
import { useEffect, useMemo } from "react";

import {
  toolKeyEventOf,
  type EditorCommand,
  type Keymap,
  type KeyMatch,
  type Ref,
  type ToolHost,
} from "../../editor/index";
import { TOOL_PRIORITY, type PlayOptions, type RapierModule, type ToolEvent } from "../../index";
import type { EditorNotify } from "../host";
import { inOverlay, isEditableTarget } from "../kit/index";
import type { ToolHostCell } from "../panels/canvas-layer/tool-host";
import { nextTimeScale } from "../panels/EditorPlayBar";
import type { LoadedRun } from "../session/loaded-run";
import type { EditorProps } from "../session/use-scene-editor";

/** What `editorChrome` is drawn from: the editor's props and where its notices go. */
export type EditorChromeProps = EditorProps & {
  /** Refusals, failed drops and remote changes; the host's `notify` or the frame's toasts. */
  notify: EditorNotify;
};

/** What the dock, the keys and the panels share. */
export type EditorControls = Omit<EditorChromeProps, "runStore" | "rapier"> & {
  rapier: RapierModule | null;
  runStore: Store<LoadedRun | null>;
  keymap: Keymap;
  /** The tool host, once it's up. */
  tools: ToolHostCell;
  playHere: () => void;
  /** Plays live from a start, such as where a loaded run started. */
  playFrom: (opts: PlayOptions) => void;
  /** Frames `refs` in the editor camera; false when none of them has geometry. */
  frame: (refs: readonly Ref[]) => boolean;
};

/** Commands the shell carries out itself, in edit and play. */
const SHELL_COMMANDS: readonly EditorCommand[] = [
  "save",
  "play",
  "play-here",
  "stop",
  "pause",
  "step",
  "slower",
  "faster",
  "leave-prefab",
];

/** Left to the browser: its copy, cut and paste events carry the clipboard, and the game's debug overlay takes F3. */
const UNHANDLED: readonly EditorCommand[] = ["copy", "cut", "paste", "debug"];

/** Escape's cascade, which the tool host runs as one. */
const ESCAPE: readonly EditorCommand[] = [
  "cancel-gesture",
  "leave-sub-object",
  "clear-tool",
  "clear-selection",
];

/** Held, these repeat; every other command fires once per press. */
const repeats = (command: string) =>
  command === "step" || command.startsWith("nudge-") || command.startsWith("rotate-");

const isToolCommand = (command: string) => command.startsWith("tool:");

const CONTROL =
  'button, a[href], summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"]';

/** Enter or Space on a focused control presses it, so the editor leaves those to it. */
function pressesControl(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "Enter" && e.key !== " ")) return false;
  return e.target instanceof Element && e.target.closest(CONTROL) !== null;
}

/** Text selected on the page, which a copy should take instead of the scene's selection. */
function hasTextSelection(): boolean {
  const sel = window.getSelection();
  return sel !== null && !sel.isCollapsed && sel.toString() !== "";
}

type KeyEvent = Extract<ToolEvent, { kind: "key" }>;

/**
 * The editor's keyboard as a consumer on the game's router, above the
 * game's tools: it sees keys from anywhere in the key target (the panels
 * too) and, for Mod+S, keys typed into fields. In edit mode the active tool
 * sees each key first (the pen's Enter and Backspace), then the keymap,
 * whose edit commands go to the tool host.
 */
export function useEditorKeys(controls: EditorControls, host: ToolHost | null): void {
  const { session, game, keymap, onPlay, onStop, playHere } = controls;
  const leavePrefab = controls.prefab?.onBack;
  const run = useMemo(
    () => commandRunner({ session, game, onPlay, onStop, playHere, leavePrefab }, host),
    [session, game, onPlay, onStop, playHere, leavePrefab, host],
  );

  useEffect(() => {
    const editing = () => host !== null && session.store.state.mode === "edit";

    /** Offers a key to the active tool; releases always reach it, so a held Space lets go. */
    const toolKey = (e: KeyEvent): boolean => {
      if (!host || !editing()) return false;
      if (
        e.type === "down" &&
        (e.native.defaultPrevented ||
          inOverlay(e.native.target) ||
          e.editable === true ||
          isEditableTarget(e.native.target) ||
          pressesControl(e.native))
      )
        return false;
      return host.key(toolKeyEventOf(e));
    };

    const resolve = (e: KeyEvent): KeyMatch | null => {
      if (e.type !== "down") return null;
      if (e.native.defaultPrevented || inOverlay(e.native.target)) return null;
      const editableTarget = e.editable === true || isEditableTarget(e.native.target);
      if (!editableTarget && pressesControl(e.native)) return null;
      const { mode, tool, selection } = session.store.state;
      const live = editing() ? host : null;
      const match = keymap.resolve(e.native, {
        mode,
        editableTarget,
        inPrefab: leavePrefab !== undefined,
        ...(live ? live.keyContext() : { tool, hasSelection: selection.length > 0 }),
      });
      if (!match) return null;
      if (match.source === "engine") {
        if (UNHANDLED.includes(match.command)) return null;
        return SHELL_COMMANDS.includes(match.command) || live ? match : null;
      }
      // Like play input, the game's play keys need the canvas focused; a panel keeps Tab.
      if (match.binding.scope === "play" && e.outsideTarget) return null;
      if (isToolCommand(match.command) && !live) return null;
      return match;
    };

    // `accepts` decides and `handle` acts; the router calls them back to back for one event.
    let pending: KeyMatch | "tool" | null = null;
    return game.router.register({
      id: "editor:keys",
      priority: TOOL_PRIORITY.editor,
      editable: true,
      accepts(e) {
        pending = null;
        if (e.kind !== "key") return false;
        if (toolKey(e)) pending = "tool";
        else pending = resolve(e);
        return pending !== null;
      },
      handle(e) {
        const match = pending;
        pending = null;
        if (!match || e.kind !== "key") return;
        if (match === "tool" || match.source === "engine") e.native.preventDefault();
        if (match === "tool") return;
        if (e.native.repeat && !repeats(match.command)) return;
        if (run(match) && match.source === "game") e.native.preventDefault();
      },
    });
  }, [session, game, keymap, run, host, leavePrefab]);
}

/** Copy, cut and paste through the browser's clipboard events, as `SceneFragment` text in edit mode. */
export function useEditorClipboard(
  session: EditorControls["session"],
  host: ToolHost | null,
): void {
  useEffect(() => {
    if (!host) return;
    const skip = (e: ClipboardEvent) =>
      session.store.state.mode !== "edit" ||
      !e.clipboardData ||
      isEditableTarget(e.target) ||
      inOverlay(e.target);
    const onCopy = (e: ClipboardEvent, cut = false) => {
      if (skip(e) || hasTextSelection()) return;
      const text = cut ? host.cut() : host.copy();
      if (!text) return;
      e.preventDefault();
      e.clipboardData!.setData("text/plain", text);
    };
    const onCut = (e: ClipboardEvent) => onCopy(e, true);
    const onPaste = (e: ClipboardEvent) => {
      if (skip(e)) return;
      const text = e.clipboardData!.getData("text/plain");
      if (text && host.paste(text, host.pointerWorld() ?? undefined)) e.preventDefault();
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
      window.removeEventListener("paste", onPaste);
    };
  }, [session, host]);
}

/** Carries out a resolved key; true when it did something. */
export function commandRunner(
  {
    game,
    onPlay,
    onStop,
    playHere,
    leavePrefab,
  }: Pick<EditorControls, "session" | "game" | "onPlay" | "onStop" | "playHere"> & {
    leavePrefab?: () => void;
  },
  host: ToolHost | null,
): (match: KeyMatch) => boolean {
  return (match) => {
    if (match.source === "game") {
      return isToolCommand(match.command)
        ? (host?.command(match.command) ?? false)
        : game.command(match.command);
    }
    const sim = () => game.getStore().state.sim;
    switch (match.command) {
      case "play":
        onPlay();
        return true;
      case "play-here":
        playHere();
        return true;
      case "stop":
        // A game's selection (a tool's, or its mounted UI's) clears before play stops.
        if (!game.cancel()) onStop();
        return true;
      case "pause":
        if (sim().paused) game.resume();
        else game.pause();
        return true;
      case "step":
        if (!sim().paused) game.pause();
        game.step();
        return true;
      case "slower":
      case "faster":
        game.setTimeScale(nextTimeScale(sim().timeScale, match.command === "faster" ? 1 : -1));
        return true;
      case "leave-prefab":
        if (!leavePrefab) return false;
        leavePrefab();
        return true;
      case "save":
        // Every edit is already in the shared doc; this only keeps the browser's save dialog shut.
        return true;
      default:
        if (!host) return false;
        return ESCAPE.includes(match.command) ? host.cancel() : host.command(match.command);
    }
  };
}
