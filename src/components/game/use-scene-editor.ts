import type { GameInstance } from "@jams/engine";
import type { EditorSession } from "@jams/engine/editor";
import {
  expandScene,
  sceneHash,
  validateScene,
  type SceneDefinition,
  type SceneHash,
} from "@jams/engine/scene";
import { createElement, useEffect, useState, type ComponentType, type ReactNode } from "react";

import type { EditorShellProps } from "@/components/game/editor/EditorShell";
import { openConfirmModal } from "@/components/ui/confirm";
import { toast } from "@/lib/toast";

type LoadedEditor = {
  session: EditorSession;
  Shell: ComponentType<EditorShellProps>;
  sync: DiskSync;
};

export type SceneSource = {
  /** The scene as last read from disk. */
  get(): SceneDefinition;
  /** Notifies when the file changes on disk; returns an unsubscribe. */
  subscribe(listener: (doc: SceneDefinition) => void): () => void;
};

type SceneEditorOptions = {
  game: GameInstance | null;
  /** Read once when the editor opens; later disk changes arrive through `subscribe`. */
  source: SceneSource;
  /** The scene file the dev sink writes, `src/game/scenes/<name>.json`. */
  name: string;
  enabled: boolean;
};

/**
 * `diskHash` is the file as the session last agreed with it, `savingHash`
 * a save in flight (its own write can come back as a file change before the
 * response), `playedHash` the doc that play started from.
 */
type DiskSync = {
  diskHash: SceneHash;
  savingHash: SceneHash | null;
  playedHash: SceneHash | null;
};

type SaveResponse = {
  ok: boolean;
  hash?: SceneHash;
  error?: string;
  issues?: { message: string }[];
};

async function saveScene(
  name: string,
  doc: SceneDefinition,
  base: SceneHash | null,
): Promise<{ status: number; body: SaveResponse }> {
  const query = base ? `?base=${encodeURIComponent(base)}` : "";
  const res = await fetch(`/__scene/${name}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  return { status: res.status, body: (await res.json()) as SaveResponse };
}

function play(game: GameInstance, session: EditorSession, sync: DiskSync): void {
  const doc = session.getDoc();
  const errors = validateScene(doc).filter((i) => i.severity === "error");
  if (errors.length > 0) {
    toast.error("Fix the scene's errors before you play", { description: errors[0]!.message });
    return;
  }
  const report = game.loadScene(expandScene(structuredClone(doc)));
  if (!report.ok) {
    toast.error("The scene failed to load", { description: report.error });
    return;
  }
  sync.playedHash = session.getHash();
  game.setMode("play");
  session.setMode("play");
}

function stop(game: GameInstance, session: EditorSession, sync: DiskSync): void {
  // Leaving play restores the scene that was played; reload only if the doc moved on meanwhile.
  game.setMode("edit");
  if (session.getHash() !== sync.playedHash) game.loadScene(expandScene(session.getDoc()));
  sync.playedHash = null;
  session.setMode("edit");
}

async function save(name: string, session: EditorSession, sync: DiskSync): Promise<void> {
  const fail = (description?: string) => toast.error(`Couldn't save ${name}`, { description });
  sync.savingHash = session.getHash();
  try {
    let res = await saveScene(name, session.getDoc(), sync.diskHash);
    if (res.status === 409) {
      const overwrite = await openConfirmModal({
        title: `${name} changed on disk`,
        message:
          "Someone else wrote this scene since you loaded it. Overwrite their version with yours?",
        confirmText: "Overwrite",
        variant: "destructive",
      });
      if (!overwrite) return;
      res = await saveScene(name, session.getDoc(), null);
    }
    if (!res.body.ok) {
      fail(res.body.issues?.[0]?.message ?? res.body.error);
      return;
    }
    if (res.body.hash) sync.diskHash = res.body.hash;
    session.markSaved();
    toast.success(`Saved ${name}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    sync.savingHash = null;
  }
}

/** A write from outside the editor: reload when clean, ask when there are unsaved edits. */
async function onDiskChange(
  name: string,
  session: EditorSession,
  sync: DiskSync,
  doc: SceneDefinition,
): Promise<void> {
  const hash = sceneHash(doc);
  if (hash === sync.diskHash) return;
  sync.diskHash = hash;
  if (hash === session.getHash() || hash === sync.savingHash) return;
  if (session.store.state.dirty) {
    const reload = await openConfirmModal({
      title: `${name} changed on disk`,
      message:
        "The file was written outside the editor. Reload it and lose your unsaved edits, or keep them (your next save overwrites the file)?",
      confirmText: "Reload",
      cancelText: "Keep my edits",
      variant: "destructive",
    });
    if (!reload || sync.diskHash !== hash) return;
  }
  session.replaceDoc(structuredClone(doc));
}

/** `null` in production builds, so the editor's chunks are never emitted there. */
const loadEditor = import.meta.env.DEV
  ? () =>
      Promise.all([import("@jams/engine/editor"), import("@/components/game/editor/EditorShell")])
  : null;

/**
 * The in-game scene editor, in dev builds with `?edit=1`. Each commit
 * rebuilds the running scene; the shell owns the editor keyboard.
 */
export function useSceneEditor({ game, source, name, enabled }: SceneEditorOptions): ReactNode {
  const [editor, setEditor] = useState<LoadedEditor | null>(null);

  useEffect(() => {
    if (!loadEditor || !enabled || !game) return;

    let cancelled = false;
    let teardown: (() => void) | null = null;

    void loadEditor().then(([{ createEditorSession }, { EditorShell }]) => {
      if (cancelled) return;
      const initial = source.get();
      const session = createEditorSession({ doc: structuredClone(initial), name });
      const sync: DiskSync = { diskHash: sceneHash(initial), savingHash: null, playedHash: null };
      game.setMode("edit");
      const unsubscribe = session.subscribe((e) => {
        if (game.getMode() !== "edit") return;
        const report = game.loadScene(expandScene(e.doc));
        if (!report.ok) toast.error("The edit failed to load", { description: report.error });
      });
      const unwatch = source.subscribe((doc) => void onDiskChange(name, session, sync, doc));
      teardown = () => {
        unwatch();
        unsubscribe();
        session.destroy();
        game.setMode("play");
      };
      setEditor({ session, Shell: EditorShell, sync });
    });

    return () => {
      cancelled = true;
      teardown?.();
      setEditor(null);
    };
  }, [game, source, name, enabled]);

  if (!editor || !game) return null;
  const { session, Shell, sync } = editor;
  return createElement(Shell, {
    session,
    onPlay: () => play(game, session, sync),
    onStop: () => stop(game, session, sync),
    onSave: () => void save(name, session, sync),
  });
}
