import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  TOOL_PRIORITY,
  type GameInstance,
  type PlayOptions,
  type RapierModule,
  type RunRecording,
  type ToolEvent,
} from "@jams/engine";
import {
  createKeymap,
  selectionBounds,
  toolKeyEventOf,
  type EditorCommand,
  type EditorSession,
  type Keymap,
  type KeyMatch,
  type Ref,
  type SceneIssue,
  type ToolHost,
} from "@jams/engine/editor";
import type { AssetKey } from "@jams/engine/project";
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useEffect, useMemo } from "react";

import { Island, type CanvasShellSlots } from "@/components/canvas/shell/CanvasShell";
import type { EditorHostState } from "@/components/game/live-scene-editor";
import { Button } from "@/components/ui/button";
import { inOverlay, isEditableTarget } from "@/lib/dom/editable-target";
import { toast } from "@/lib/toast";

import { CanvasLayer } from "./canvas-layer/CanvasLayer";
import {
  createToolHostCell,
  useToolHost,
  useToolHostLifecycle,
  type ToolHostCell,
} from "./canvas-layer/tool-host";
import { CodeSkewNotice } from "./CodeSkewNotice";
import { EditorCanvasOverlay } from "./EditorCanvasOverlay";
import { EditorHistory } from "./EditorHistory";
import { EditorInspector } from "./EditorInspector";
import { EditorOutliner } from "./EditorOutliner";
import { EditorPlayBar, nextTimeScale } from "./EditorPlayBar";
import { EditorProject, useSelectedAsset, type EditorProjectLink } from "./EditorProject";
import { EditorStatusBar } from "./EditorStatusBar";
import { EditorToolbar } from "./EditorToolbar";
import { createLoadedRunStore, type LoadedRun } from "./loaded-run";
import { LoadRunPanel } from "./LoadRunPanel";
import { ProblemsPanel } from "./ProblemsPanel";
import { useEditorStore } from "./use-editor-store";
import { usePhysicalIssues } from "./use-physical-issues";

/** The parts of the game the editor's chrome reads and drives. */
export type EditorChromeGame = Pick<
  GameInstance,
  | "getStore"
  | "registry"
  | "router"
  | "pause"
  | "resume"
  | "step"
  | "setTimeScale"
  | "command"
  | "cancel"
  | "pointerWorld"
  | "screenToWorld"
  | "panBy"
  | "zoomAt"
  | "frame"
  | "runtime"
>;

export type EditorShellProps = {
  session: EditorSession;
  /** The connection and play state the host keeps. */
  host: Store<EditorHostState>;
  /** The game the editor drives: its camera, its router for keys and pointers, its sim controls. */
  game: EditorChromeGame;
  onPlay: (opts?: PlayOptions) => void;
  /** Plays a recording's input again in place of the keyboard's. */
  onReplay: (recording: RunRecording) => void;
  onStop: () => void;
  /** Rebuilds the play world from the latest doc. */
  onRestart: () => void;
  /** Rapier, for the physical checks; null until it has loaded. */
  rapier?: RapierModule | null;
  /** The run loaded into the editor; one is made when absent. */
  runStore?: Store<LoadedRun | null>;
  /** The game's canvas, which takes the active tool's cursor. */
  canvas?: () => HTMLElement | null;
  /** Opens a prefab on its own; absent while one is open. */
  onOpenPrefab?: (prefab: string, from: Ref) => void;
  /** The prefab `session` edits in isolation, and the way back to its scene. */
  prefab?: { id: string; scene: string; onBack: () => void };
  /** The project the scene belongs to: its tree goes above the outliner. */
  project?: EditorProjectLink;
};

/** What the dock, the keys and the panels share. */
export type EditorControls = Omit<EditorShellProps, "runStore" | "rapier"> & {
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

export type EditorChrome = Pick<CanvasShellSlots, "left" | "right" | "dock" | "status" | "overlay">;

/**
 * The editor's islands for `CanvasShell`'s slots. In play mode only the dock
 * stays, as the play controls and the "scene changed" chip.
 */
export function editorChrome(props: EditorShellProps): EditorChrome {
  const { session, host, game } = props;
  const keymap = createKeymap(game.registry.game?.editorKeys);
  if (import.meta.env.DEV) {
    for (const b of keymap.shadowed) {
      console.warn(`[editor] the game's ${b.scope} key "${b.key}" (${b.command}) is the engine's`);
    }
  }
  const physical = new Store<readonly SceneIssue[]>([]);
  const pickedAsset = new Store<AssetKey | null>(null);
  const controls: EditorControls = {
    ...props,
    rapier: props.rapier ?? null,
    runStore: props.runStore ?? createLoadedRunStore(),
    keymap,
    tools: createToolHostCell(),
    playHere() {
      const at = game.pointerWorld();
      if (!at) {
        toast("Point at the scene first", {
          description: "Play from here starts where the pointer last was over the scene.",
        });
        return;
      }
      props.onPlay({ at });
    },
    playFrom: (opts) => props.onPlay(opts),
    frame(refs) {
      const box = selectionBounds(session.getResolved(), session.registry, refs);
      if (!box) return false;
      game.frame(box);
      return true;
    },
  };
  return {
    left: (
      <EditMode session={session}>
        <div className="flex min-h-0 w-full flex-col">
          <CodeSkewNotice host={host} />
          {props.prefab ? <PrefabBreadcrumb {...props.prefab} /> : null}
          {props.project ? (
            <Island className="mb-2 max-h-[45%] min-h-24 w-full shrink-0 flex-col items-stretch overflow-hidden">
              <EditorProject
                project={props.project}
                selected={pickedAsset}
                prefab={props.prefab?.id}
              />
            </Island>
          ) : null}
          <Island className="min-h-0 w-full flex-1 flex-col items-stretch overflow-hidden">
            <OutlinerWithProblems
              session={session}
              physical={physical}
              onOpenPrefab={props.onOpenPrefab}
            />
          </Island>
        </div>
      </EditMode>
    ),
    right: (
      <EditMode session={session}>
        <PhysicalWatch session={session} rapier={controls.rapier} store={physical} />
        <Island className="min-h-0 shrink flex-col items-stretch overflow-y-auto">
          <InspectorWithAsset
            session={session}
            project={props.project}
            picked={pickedAsset}
            onOpenPrefab={props.onOpenPrefab}
            inPrefab={props.prefab !== undefined}
          />
        </Island>
        <Island className="mt-2 max-h-60 min-h-0 shrink-0 flex-col items-stretch overflow-y-auto">
          <ProblemsWithPhysical
            session={session}
            physical={physical}
            onFrame={(refs) => void controls.frame(refs)}
          />
        </Island>
        <Island className="mt-2 shrink-0 flex-col items-stretch">
          <LoadRunPanel
            session={session}
            run={controls.runStore}
            onPlayFrom={controls.playFrom}
            onReplay={(run) => props.onReplay(run.recording)}
          />
        </Island>
        <Island className="mt-2 max-h-72 min-h-24 shrink-0 flex-col items-stretch overflow-hidden">
          <EditorHistory session={session} />
        </Island>
      </EditMode>
    ),
    dock: <EditorDock {...controls} />,
    status: (
      <EditMode session={session}>
        <Island>
          <EditorStatusBar session={session} host={host} />
        </Island>
      </EditMode>
    ),
    overlay: (
      <EditMode session={session}>
        <EditorCanvasOverlay session={session} store={game.getStore()} />
        <EditorCanvasLayer {...controls} />
      </EditMode>
    ),
  };
}

/** Physical validation, run once for the panels that show it. */
function PhysicalWatch({
  session,
  rapier,
  store,
}: {
  session: EditorSession;
  rapier: RapierModule | null;
  store: Store<readonly SceneIssue[]>;
}) {
  const issues = usePhysicalIssues(session, rapier);
  useEffect(() => store.setState(() => issues), [issues, store]);
  return null;
}

function OutlinerWithProblems({
  session,
  physical,
  onOpenPrefab,
}: {
  session: EditorSession;
  physical: Store<readonly SceneIssue[]>;
  onOpenPrefab?: (prefab: string, from: Ref) => void;
}) {
  return (
    <EditorOutliner session={session} physical={useStore(physical)} onOpenPrefab={onOpenPrefab} />
  );
}

/** The inspector, showing the asset picked in the project tree until something in the scene is picked. */
function InspectorWithAsset({
  session,
  project,
  picked,
  onOpenPrefab,
  inPrefab,
}: {
  session: EditorSession;
  project?: EditorProjectLink;
  picked: Store<AssetKey | null>;
  onOpenPrefab?: (prefab: string, from: Ref) => void;
  inPrefab: boolean;
}) {
  const selection = useEditorStore(session, (s) => s.selection);
  const asset = useSelectedAsset(project, picked, selection);
  return (
    <EditorInspector
      session={session}
      onOpenPrefab={onOpenPrefab}
      inPrefab={inPrefab}
      {...(asset ? { asset } : {})}
    />
  );
}

/** Where the editor is while a prefab is open on its own, and the way back. */
function PrefabBreadcrumb({
  id,
  scene,
  onBack,
}: {
  id: string;
  scene: string;
  onBack: () => void;
}) {
  return (
    <Island className="mb-2 w-full items-center gap-2 px-2">
      <Button size="xs" variant="ghost" tooltip={`Back to ${scene}`} onClick={onBack}>
        <HugeiconsIcon icon={ArrowLeft01Icon} data-icon="inline-start" />
        Back
      </Button>
      <nav aria-label="Breadcrumb" className="min-w-0 truncate text-xs">
        <span className="text-muted-foreground">{scene}</span>
        <span className="px-1 text-muted-foreground">›</span>
        <span className="font-medium">{id}</span>
      </nav>
    </Island>
  );
}

function ProblemsWithPhysical({
  session,
  physical,
  onFrame,
}: {
  session: EditorSession;
  physical: Store<readonly SceneIssue[]>;
  onFrame: (refs: Ref[]) => void;
}) {
  return <ProblemsPanel session={session} physical={useStore(physical)} onFrame={onFrame} />;
}

function EditMode({ session, children }: { session: EditorSession; children: React.ReactNode }) {
  const mode = useEditorStore(session, (s) => s.mode);
  return mode === "play" ? null : children;
}

function EditorCanvasLayer({ session, tools, game, runStore, canvas }: EditorControls) {
  const host = useToolHost(tools);
  return (
    <CanvasLayer
      session={session}
      host={host}
      store={game.getStore()}
      runStore={runStore}
      canvas={canvas}
    />
  );
}

/** Commands the shell carries out itself, in edit and play. */
const SHELL_COMMANDS = new Set<EditorCommand>([
  "save",
  "play",
  "play-here",
  "stop",
  "pause",
  "step",
  "slower",
  "faster",
]);

/** Left to the browser: its copy, cut and paste events carry the clipboard, and the game's debug overlay takes F3. */
const UNHANDLED = new Set<EditorCommand>(["copy", "cut", "paste", "debug"]);

/** Escape's cascade, which the tool host runs as one. */
const ESCAPE = new Set<EditorCommand>([
  "cancel-gesture",
  "leave-sub-object",
  "clear-tool",
  "clear-selection",
]);

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
function useEditorKeys(controls: EditorControls, host: ToolHost | null) {
  const { session, game, keymap, onPlay, onStop, playHere } = controls;
  const run = useMemo(
    () => commandRunner({ session, game, onPlay, onStop, playHere }, host),
    [session, game, onPlay, onStop, playHere, host],
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
      const { mode, tool } = session.store.state;
      const live = editing() ? host : null;
      const match = keymap.resolve(e.native, {
        mode,
        editableTarget,
        ...(live ? live.keyContext() : { tool }),
      });
      if (!match) return null;
      if (match.source === "engine") {
        if (UNHANDLED.has(match.command)) return null;
        return SHELL_COMMANDS.has(match.command) || live ? match : null;
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
  }, [session, game, keymap, run, host]);
}

/** Copy, cut and paste through the browser's clipboard events, as `SceneFragment` text in edit mode. */
function useEditorClipboard(session: EditorSession, host: ToolHost | null) {
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
function commandRunner(
  {
    game,
    onPlay,
    onStop,
    playHere,
  }: Pick<EditorControls, "session" | "game" | "onPlay" | "onStop" | "playHere">,
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
        // A game selection (the Shaper's) clears before play stops.
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
      case "save":
        // Every edit is already in the shared doc; this only keeps the browser's save dialog shut.
        return true;
      default:
        if (!host) return false;
        return ESCAPE.has(match.command) ? host.cancel() : host.command(match.command);
    }
  };
}

/** The toolbar, or the play controls while playing; owns the tool host and the editor keyboard. */
function EditorDock(controls: EditorControls) {
  const { session, game, tools } = controls;
  const mode = useEditorStore(session, (s) => s.mode);
  useToolHostLifecycle(tools, session, game);
  const host = useToolHost(tools);
  useEditorKeys(controls, host);
  useEditorClipboard(session, host);

  if (mode === "play") return <EditorPlayBar {...controls} />;
  return (
    <Island>
      <EditorToolbar
        session={session}
        keymap={controls.keymap}
        host={host}
        onPlay={() => controls.onPlay()}
        onPlayHere={controls.playHere}
      />
    </Island>
  );
}
