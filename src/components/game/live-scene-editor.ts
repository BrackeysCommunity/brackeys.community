import type { GameInstance, PlayOptions, PlayReport, RunRecording } from "@jams/engine";
import {
  actorLabel,
  bindSceneDoc,
  readDoc,
  type AwarenessLike,
  type BindableRuntime,
  type LogEntry,
  type SceneOrigin,
  type ScenePresence,
} from "@jams/engine/collab";
import {
  createEditorSession,
  docRefs,
  openPrefabIsolation,
  selectionBounds,
  type EditorSession,
  type PrefabIsolation,
  type Ref,
} from "@jams/engine/editor";
import { Store } from "@tanstack/store";
import type * as Y from "yjs";

import type { EditorShellProps } from "@/components/game/editor/EditorShell";
import { presenceColor } from "@/lib/canvas/presence";
import { toast } from "@/lib/toast";

import type { SceneDocStatus } from "./use-scene-doc";

/** What the editor's chrome shows besides the session: the connection and play state. */
export type EditorHostState = {
  connection: SceneDocStatus;
  /** The doc moved on since Play started. */
  sceneChanged: boolean;
};

export type EditorIdentity = {
  origin: Extract<SceneOrigin, { kind: "user" }>;
  user: ScenePresence["user"];
};

/** The parts of a `GameInstance` the live editor drives. */
export type EditorGame = Pick<
  GameInstance,
  | "registry"
  | "loadScene"
  | "runtime"
  | "play"
  | "replay"
  | "stop"
  | "setMode"
  | "setPrefabs"
  | "frame"
>;

export type LiveEditorOptions = {
  game: EditorGame;
  doc: Y.Doc;
  awareness?: AwarenessLike | null;
  name: string;
  identity: EditorIdentity;
  issuesDebounceMs?: number;
};

/** A prefab open on its own, and the scene ref the editor goes back to. */
export type OpenPrefab = { isolation: PrefabIsolation; from?: Ref };

export type LiveEditor = {
  session: EditorSession;
  host: Store<EditorHostState>;
  /** The prefab being edited in isolation, if any; the edit world shows it instead of the scene. */
  prefab: Store<OpenPrefab | null>;
  /** Edits `prefab` on its own; `from` (an instance) is framed again on Back. False while playing. */
  openPrefab: (prefab: string, from?: Ref) => boolean;
  /** Back to the scene from an open prefab. */
  closePrefab: () => void;
  /** What the editor's chrome edits with `open` (from `prefab`): the scene, or that prefab with its way back. */
  editing: (
    open: OpenPrefab | null,
  ) => Pick<EditorShellProps, "session" | "prefab" | "onOpenPrefab">;
  /** Plays the doc as it is now (from `opts.at` for "play from here"); false, with a toast, when it can't. */
  play: (opts?: PlayOptions) => boolean;
  /** Plays a recording's input again on the doc as it is now; false, with a toast, when it can't. */
  replay: (recording: RunRecording) => boolean;
  /** True while the play world is a replay. */
  replaying: () => boolean;
  stop: () => void;
  /** Rebuilds the running play world from the latest doc, from where the last Play started. */
  restart: () => void;
  destroy: () => void;
};

/**
 * This tab as an editor: an id per page load, so two tabs are two people
 * with their own undo and colour, named after the signed-in member when
 * there is one.
 */
export function editorIdentity(displayName?: string | null): EditorIdentity {
  const id = `tab-${Math.random().toString(36).slice(2).padEnd(8, "0").slice(0, 8)}`;
  const name = displayName?.trim() || `Guest ${Math.floor(Math.random() * 99) + 1}`;
  return {
    origin: { kind: "user", userId: id, name },
    user: { id, name, color: presenceColor(id).color },
  };
}

const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);

/** Why Play didn't start: the scene's errors, a start inside a solid, or a load that failed. */
function playRefused(report: Extract<PlayReport, { ok: false }>): void {
  const errors = report.issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    toast.error(`Fix ${plural(errors.length, "error")} before you play`, {
      description: errors[0]!.message,
    });
  } else if (report.reason === "spawn-blocked") {
    toast.error("Can't play from here", { description: report.error });
  } else {
    toast.error("The scene failed to load", { description: report.error });
  }
}

/** Agents' and the file's batches land without anyone in the editor doing them, so they're announced. */
function announce(entry: LogEntry): void {
  if (entry.actor.kind === "agent") {
    toast(`${actorLabel(entry.actor)} edited the scene`, { description: entry.label });
  } else if (entry.actor.kind === "disk") {
    toast("The scene file changed on disk", { description: entry.label });
  }
}

/**
 * The editor on a shared doc, driving `game`: the edit world follows the
 * doc through `bindSceneDoc`; Play validates a snapshot of the doc and
 * builds a fresh world from it, leaving the binding paused so nobody's
 * edits reach a running game; Stop discards it and rebuilds from the doc
 * as it is then.
 */
export function openLiveEditor({
  game,
  doc,
  awareness,
  name,
  identity,
  issuesDebounceMs,
}: LiveEditorOptions): LiveEditor {
  const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
  const session = createEditorSession({
    doc,
    origin: identity.origin,
    name,
    registry: game.registry,
    ...(awareness ? { awareness } : {}),
    user: identity.user,
    ...(issuesDebounceMs !== undefined ? { issuesDebounceMs } : {}),
  });

  const runtime: BindableRuntime = {
    load: (scene) => game.loadScene(scene),
    add: (entities) => game.runtime()?.add(entities) ?? { ok: false },
    update: (entities) => game.runtime()?.update(entities) ?? { ok: false },
    remove: (ids) => game.runtime()?.remove(ids),
  };

  let playing = false;
  let started: PlayOptions | undefined;
  let replayed: RunRecording | null = null;
  game.stop();
  const bind = (target: Y.Doc) =>
    bindSceneDoc(target, runtime, game.registry, {
      onChange: () => {
        if (playing && !host.state.sceneChanged)
          host.setState((s) => ({ ...s, sceneChanged: true }));
      },
      onSkipped: (errors) =>
        toast.warning("Some entities couldn't be built", {
          id: "scene-skipped",
          description: errors[0],
        }),
    });
  let binding = bind(doc);
  const prefab = new Store<OpenPrefab | null>(null);

  /** Points the edit world at `target`'s doc, framing what `refs` cover in it. */
  function show(target: EditorSession, refs: readonly Ref[]) {
    binding.destroy();
    binding = bind(target.doc);
    const box = selectionBounds(target.getResolved(), target.registry, refs);
    if (box) game.frame(box);
  }

  function closePrefab() {
    const open = prefab.state;
    if (!open || playing) return;
    prefab.setState(() => null);
    open.isolation.close();
    show(session, open.from ? [open.from] : []);
  }

  function openPrefab(id: string, from?: Ref): boolean {
    if (playing) return false;
    if (prefab.state) closePrefab();
    const isolation = openPrefabIsolation(session, id, {
      ...(issuesDebounceMs !== undefined ? { issuesDebounceMs } : {}),
      onGone: () => {
        if (prefab.state?.isolation !== isolation) return;
        prefab.setState(() => null);
        binding.destroy();
        binding = bind(doc);
        toast("The prefab was deleted", {
          description: `${id} is gone, so you're back in the scene.`,
        });
      },
    });
    if (!isolation) {
      toast.error(`No prefab ${id} in this scene`);
      return false;
    }
    prefab.setState(() => ({ isolation, ...(from ? { from } : {}) }));
    show(isolation.session, docRefs(isolation.session.getDoc()));
    return true;
  }

  const unsubscribe = session.subscribe((e) => {
    if (e.source === "remote") for (const entry of e.logged) announce(entry);
  });

  /** Plays the doc as it is now; on a refusal the world that was running keeps running. */
  function launch(opts: PlayOptions | undefined, recording: RunRecording | null): boolean {
    const { def: scene, prefabs } = readDoc(doc);
    game.setPrefabs(prefabs);
    const report = recording ? game.replay(scene, recording) : game.play(scene, opts);
    if (!report.ok) {
      playRefused(report);
      return false;
    }
    host.setState((s) => ({ ...s, sceneChanged: false }));
    return true;
  }

  function enter(given: PlayOptions | undefined, recording: RunRecording | null): boolean {
    let opts = given;
    if (!playing && prefab.state) {
      // Play is the scene's; a point picked inside the prefab means nothing there.
      closePrefab();
      if (opts?.at) {
        const { at: _at, ...rest } = opts;
        opts = rest;
      }
    }
    if (playing || !launch(opts, recording)) return false;
    binding.setPaused(true);
    playing = true;
    started = opts;
    replayed = recording;
    session.setMode("play");
    return true;
  }

  return {
    session,
    host,
    prefab,
    openPrefab,
    closePrefab,
    editing(open) {
      return open
        ? {
            session: open.isolation.session,
            prefab: { id: open.isolation.prefab, scene: name, onBack: closePrefab },
          }
        : { session, onOpenPrefab: openPrefab };
    },
    play(opts) {
      return enter(opts, null);
    },
    replay(recording) {
      return enter(undefined, recording);
    },
    replaying: () => playing && replayed !== null,
    stop() {
      if (!playing) return;
      playing = false;
      game.stop();
      binding.setPaused(false);
      host.setState((s) => ({ ...s, sceneChanged: false }));
      session.setMode("edit");
    },
    restart() {
      if (playing) launch(started, replayed);
    },
    destroy() {
      unsubscribe();
      binding.destroy();
      prefab.state?.isolation.close();
      prefab.setState(() => null);
      session.destroy();
      playing = false;
      game.setMode("play");
    },
  };
}
