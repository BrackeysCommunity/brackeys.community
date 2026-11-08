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
import { useMemo } from "react";

import {
  ENGINE_TOOL_IDS,
  SNAP_STEPS,
  type EditorCommand,
  type EditorSession,
  type EditorToolDef,
  type EngineToolId,
  type Keymap,
  type ToolHost,
} from "../../editor/index";
import {
  Button,
  Icon,
  IconButton,
  KeyHint,
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  type IconSvgElement,
} from "../kit/index";
import { useEditorStore } from "../session/use-editor-store";
import { useHostValue } from "./canvas-layer/tool-host";

const TOOL_ICONS: Record<EngineToolId, IconSvgElement> = {
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

const Divider = () => <span className="je-toolbar-divider" aria-hidden />;

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
  const variant = active ? "secondary" : "ghost";
  const tooltip = <KeyHint text={tool.label} chord={chord} />;
  return icon ? (
    <IconButton
      icon={icon}
      label={tool.label}
      variant={variant}
      aria-pressed={active}
      tooltip={tooltip}
      onClick={onPick}
    />
  ) : (
    <Button
      size="sm"
      variant={variant}
      aria-label={tool.label}
      aria-pressed={active}
      tooltip={tooltip}
      onClick={onPick}
    >
      {tool.label}
    </Button>
  );
}

/** Snapping on or off, and the grid step it snaps to. */
function SnapControls({ host, keymap }: { host: ToolHost; keymap: Keymap }) {
  const snap = useHostValue(host, (h) => h.snap(), host.snap());
  return (
    <>
      <IconButton
        icon={Magnet01Icon}
        label="Snap to grid"
        variant={snap.enabled ? "secondary" : "ghost"}
        aria-pressed={snap.enabled}
        onClick={() => host.setSnap({ enabled: !snap.enabled })}
        tooltip={<KeyHint text="Snap to grid" chord={keymap.chordOf("toggle-snap")} />}
      />
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              icon={GridIcon}
              aria-label={`Grid step ${snap.step}`}
              tooltip="Grid step"
            />
          }
        >
          {snap.step}
          <Icon icon={ArrowDown01Icon} size={13} />
        </MenuTrigger>
        <MenuContent side="top" align="center" className="je-snap-menu">
          <MenuRadioGroup
            value={String(snap.step)}
            onValueChange={(value) => host.setSnap({ step: Number(value) })}
          >
            {SNAP_STEPS.map((step) => (
              <MenuRadioItem key={step} value={String(step)} closeOnClick>
                {step} px
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
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
    <div role="toolbar" aria-label="Editor" className="je-toolbar">
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
      <IconButton
        icon={Undo02Icon}
        label="Undo"
        disabled={!canUndo}
        onClick={() => (host ? host.command("undo") : session.undo())}
        tooltip={
          <KeyHint text={undoLabel ? `Undo ${undoLabel}` : "Undo"} chord={keymap.chordOf("undo")} />
        }
      />
      <IconButton
        icon={Redo02Icon}
        label="Redo"
        disabled={!canRedo}
        onClick={() => (host ? host.command("redo") : session.redo())}
        tooltip={
          <KeyHint text={redoLabel ? `Redo ${redoLabel}` : "Redo"} chord={keymap.chordOf("redo")} />
        }
      />
      <Button
        variant="secondary"
        size="sm"
        icon={PlayIcon}
        onClick={onPlay}
        tooltip={<KeyHint text="Play from spawn" chord={keymap.chordOf("play")} />}
      >
        Play
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={CursorPointer01Icon}
        onClick={onPlayHere}
        tooltip={
          <KeyHint text="Play from where the pointer was" chord={keymap.chordOf("play-here")} />
        }
      >
        Play from here
      </Button>
    </div>
  );
}
