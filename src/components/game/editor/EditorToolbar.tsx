import { FloppyDiskIcon, PlayIcon, Redo02Icon, Undo02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { EditorSession } from "@jams/engine/editor";

import { Button } from "@/components/ui/button";
import { Hotkey } from "@/components/ui/hotkey";

import { useEditorStore } from "./use-editor-store";

function Hint({ text, keys }: { text: string; keys: string }) {
  return (
    <span className="flex items-center gap-2">
      {text}
      <Hotkey value={keys} />
    </span>
  );
}

export function EditorToolbar({
  session,
  onPlay,
  onSave,
}: {
  session: EditorSession;
  onPlay: () => void;
  onSave: () => void;
}) {
  const canUndo = useEditorStore(session, (s) => s.canUndo);
  const canRedo = useEditorStore(session, (s) => s.canRedo);
  const undoLabel = useEditorStore(session, (s) => s.undoLabel);
  const redoLabel = useEditorStore(session, (s) => s.redoLabel);
  const dirty = useEditorStore(session, (s) => s.dirty);

  return (
    <div role="toolbar" aria-label="Editor" className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => session.undo()}
        tooltip={<Hint text={undoLabel ? `Undo ${undoLabel}` : "Undo"} keys="command+z" />}
      >
        <HugeiconsIcon icon={Undo02Icon} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => session.redo()}
        tooltip={<Hint text={redoLabel ? `Redo ${redoLabel}` : "Redo"} keys="shift+command+z" />}
      >
        <HugeiconsIcon icon={Redo02Icon} />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onPlay}
        tooltip={<Hint text="Play from spawn" keys="command+enter" />}
      >
        <HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
        Play
      </Button>
      <Button
        variant={dirty ? "default" : "ghost"}
        size="sm"
        onClick={onSave}
        tooltip={<Hint text="Save scene" keys="command+s" />}
      >
        <HugeiconsIcon icon={FloppyDiskIcon} data-icon="inline-start" />
        Save
      </Button>
    </div>
  );
}
