import {
  ArrowDown01Icon,
  CircleIcon,
  Cursor01Icon,
  CursorMove01Icon,
  CursorPointer01Icon,
  GridIcon,
  Magnet01Icon,
  PenTool01Icon,
  PlayIcon,
  Redo02Icon,
  RotateClockwiseIcon,
  Route01Icon,
  SquareIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ENGINE_TOOL_IDS,
  SNAP_STEPS,
  type EditorCommand,
  type EditorSession,
  type EditorToolDef,
  type EngineToolId,
  type Keymap,
  type ToolHost,
} from "@jams/engine/editor";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useHostValue } from "./canvas-layer/tool-host";
import { KeyHint } from "./key-hint";
import { useEditorStore } from "./use-editor-store";

const TOOL_ICONS: Record<EngineToolId, typeof Cursor01Icon> = {
  select: Cursor01Icon,
  pan: CursorMove01Icon,
  box: SquareIcon,
  circle: CircleIcon,
  pen: PenTool01Icon,
  waypoints: Route01Icon,
  rotate: RotateClockwiseIcon,
};

const isEngineTool = (id: string): id is EngineToolId =>
  (ENGINE_TOOL_IDS as readonly string[]).includes(id);

/** The first chord that picks a tool: the engine's `tool:<id>`, or a game key bound to `tool:<id>[:<arg>]`. */
function toolChord(keymap: Keymap, id: string): string | undefined {
  if (isEngineTool(id)) return keymap.chordOf(`tool:${id}` as EditorCommand);
  return keymap.bindings.find(
    (b) =>
      b.scope === "edit" && (b.command === `tool:${id}` || b.command.startsWith(`tool:${id}:`)),
  )?.key;
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;

function ToolButton({
  tool,
  active,
  chord,
  onPick,
}: {
  tool: EditorToolDef;
  active: boolean;
  chord: string | undefined;
  onPick: () => void;
}) {
  const icon = isEngineTool(tool.id) ? TOOL_ICONS[tool.id] : null;
  const common = {
    variant: active ? ("secondary" as const) : ("ghost" as const),
    "aria-label": tool.label,
    "aria-pressed": active,
    tooltip: <KeyHint text={tool.label} chord={chord} />,
    onClick: onPick,
  };
  return icon ? (
    <Button size="icon-sm" {...common}>
      <HugeiconsIcon icon={icon} />
    </Button>
  ) : (
    <Button size="sm" {...common}>
      {tool.label}
    </Button>
  );
}

/** Snapping on or off, and the grid step it snaps to. */
function SnapControls({ host, keymap }: { host: ToolHost; keymap: Keymap }) {
  const snap = useHostValue(host, (h) => h.snap(), host.snap());
  return (
    <>
      <Button
        variant={snap.enabled ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label="Snap to grid"
        aria-pressed={snap.enabled}
        onClick={() => host.setSnap({ enabled: !snap.enabled })}
        tooltip={<KeyHint text="Snap to grid" chord={keymap.chordOf("toggle-snap")} />}
      >
        <HugeiconsIcon icon={Magnet01Icon} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Grid step ${snap.step}`}
              tooltip="Grid step"
            />
          }
        >
          <HugeiconsIcon icon={GridIcon} data-icon="inline-start" />
          {snap.step}
          <HugeiconsIcon icon={ArrowDown01Icon} data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center" className="w-auto min-w-24 p-1">
          <DropdownMenuRadioGroup
            value={String(snap.step)}
            onValueChange={(value) => host.setSnap({ step: Number(value) })}
          >
            {SNAP_STEPS.map((step) => (
              <DropdownMenuRadioItem key={step} value={String(step)} closeOnClick>
                {step} px
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function EditorToolbar({
  session,
  keymap,
  host,
  onPlay,
  onPlayHere,
}: {
  session: EditorSession;
  keymap: Keymap;
  /** The tool host; the tool and snap controls wait for it. */
  host: ToolHost | null;
  onPlay: () => void;
  onPlayHere: () => void;
}) {
  const canUndo = useEditorStore(session, (s) => s.canUndo);
  const canRedo = useEditorStore(session, (s) => s.canRedo);
  const undoLabel = useEditorStore(session, (s) => s.undoLabel);
  const redoLabel = useEditorStore(session, (s) => s.redoLabel);
  const active = useEditorStore(session, (s) => s.tool);
  const tools = useMemo(() => host?.tools() ?? [], [host]);
  const engineTools = tools.filter((t) => isEngineTool(t.id));
  const gameTools = tools.filter((t) => !isEngineTool(t.id));

  const toolButton = (tool: EditorToolDef) => (
    <ToolButton
      key={tool.id}
      tool={tool}
      active={tool.id === active}
      chord={toolChord(keymap, tool.id)}
      onPick={() => host?.setTool(tool.id)}
    />
  );

  return (
    <div role="toolbar" aria-label="Editor" className="flex items-center gap-1">
      {host ? (
        <>
          {engineTools.map(toolButton)}
          {gameTools.length > 0 ? <Divider /> : null}
          {gameTools.map(toolButton)}
          <Divider />
          <SnapControls host={host} keymap={keymap} />
          <Divider />
        </>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Undo"
        disabled={!canUndo}
        onClick={() => (host ? host.command("undo") : session.undo())}
        tooltip={
          <KeyHint text={undoLabel ? `Undo ${undoLabel}` : "Undo"} chord={keymap.chordOf("undo")} />
        }
      >
        <HugeiconsIcon icon={Undo02Icon} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Redo"
        disabled={!canRedo}
        onClick={() => (host ? host.command("redo") : session.redo())}
        tooltip={
          <KeyHint text={redoLabel ? `Redo ${redoLabel}` : "Redo"} chord={keymap.chordOf("redo")} />
        }
      >
        <HugeiconsIcon icon={Redo02Icon} />
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onPlay}
        tooltip={<KeyHint text="Play from spawn" chord={keymap.chordOf("play")} />}
      >
        <HugeiconsIcon icon={PlayIcon} data-icon="inline-start" />
        Play
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onPlayHere}
        tooltip={
          <KeyHint text="Play from where the pointer was" chord={keymap.chordOf("play-here")} />
        }
      >
        <HugeiconsIcon icon={CursorPointer01Icon} data-icon="inline-start" />
        Play from here
      </Button>
    </div>
  );
}
