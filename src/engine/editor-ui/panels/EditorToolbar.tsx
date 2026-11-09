import {
  ArrowDown01Icon,
  CircleIcon,
  Cursor01Icon,
  CursorMove01Icon,
  CursorPointer01Icon,
  GridIcon,
  Magnet01Icon,
  MoreHorizontalIcon,
  PenTool01Icon,
  PlayIcon,
  Redo02Icon,
  RotateClockwiseIcon,
  Route01Icon,
  SquareIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { useMemo, type ReactNode } from "react";

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
import { useBottomRow } from "../frame/EditorFrame";
import {
  Button,
  Hotkey,
  Icon,
  IconButton,
  KeyHint,
  Menu,
  MenuContent,
  MenuGroup,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
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

type Snap = ReturnType<ToolHost["snap"]>;

/** Snapping on or off. */
function SnapToggle({ host, snap, keymap }: { host: ToolHost; snap: Snap; keymap: Keymap }) {
  return (
    <IconButton
      icon={Magnet01Icon}
      label="Snap to grid"
      variant={snap.enabled ? "secondary" : "ghost"}
      aria-pressed={snap.enabled}
      onClick={() => host.setSnap({ enabled: !snap.enabled })}
      tooltip={<KeyHint text="Snap to grid" chord={keymap.chordOf("toggle-snap")} />}
    />
  );
}

function StepItems({ host, snap }: { host: ToolHost; snap: Snap }) {
  return (
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
  );
}

/** The grid step snapping uses. */
function GridStep({ host, snap }: { host: ToolHost; snap: Snap }) {
  return (
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
        <StepItems host={host} snap={snap} />
      </MenuContent>
    </Menu>
  );
}

// The toolbar's widths, matching the stylesheet: an island's padding and
// border, the toolbar's gap, a small icon button, a divider with its margins,
// and a small text button's padding plus a generous 12 px glyph.
const W = { island: 10, gap: 4, icon: 24, divider: 5, char: 6.5, textPad: 16 } as const;

const textWidth = (label: string) => W.textPad + Math.ceil(label.length * W.char);
/** The grid step's button: its icon, the step, the chevron and the label's gaps. */
const stepWidth = (step: number) =>
  W.textPad + 14 + 4 + Math.ceil(String(step).length * W.char) + 6 + 13;

/** Tools that never move into the overflow menu. */
const isPinned = (id: string) => id === "select" || id === "pan";

/** One control in the toolbar; `drop` orders what moves into the overflow menu, lowest first. */
export type DockPart = { key: string; width: number; drop?: number; game?: true };

/** What the toolbar draws, in order, before anything overflows. */
export function dockParts(tools: readonly EditorToolDef[], step: number | null): DockPart[] {
  const engine = tools.filter((t) => isEngineTool(t.id));
  const game = tools.filter((t) => !isEngineTool(t.id));
  const parts: DockPart[] = engine.map((t, i) => ({
    key: `tool:${t.id}`,
    width: W.icon,
    drop: isPinned(t.id) ? undefined : 200 + engine.length - i,
  }));
  if (game.length > 0) parts.push({ key: "divider:game", width: W.divider });
  game.forEach((t, i) =>
    parts.push({
      key: `tool:${t.id}`,
      width: textWidth(t.label),
      drop: game.length - i,
      game: true,
    }),
  );
  if (step !== null) {
    parts.push(
      { key: "divider:snap", width: W.divider },
      { key: "snap", width: W.icon },
      { key: "step", width: stepWidth(step), drop: 100 },
    );
  }
  if (parts.length > 0) parts.push({ key: "divider:history", width: W.divider });
  parts.push(
    { key: "undo", width: W.icon },
    { key: "redo", width: W.icon },
    { key: "divider:play", width: W.divider },
    { key: "play", width: W.icon },
    { key: "play-here", width: W.icon },
  );
  return parts;
}

/** The toolbar's width with `hidden` in the overflow menu (and its trigger drawn when any is). */
export function dockWidth(parts: readonly DockPart[], hidden: ReadonlySet<string>): number {
  const anyGame = parts.some((p) => p.game && !hidden.has(p.key));
  const shown = parts.filter((p) => !hidden.has(p.key) && (p.key !== "divider:game" || anyGame));
  const widths = shown.map((p) => p.width);
  if (hidden.size > 0) widths.push(W.icon);
  return W.island + widths.reduce((a, b) => a + b, 0) + W.gap * Math.max(0, widths.length - 1);
}

/** What moves into the overflow menu so the toolbar fits in `room`: game tools, the grid step, then shape tools. */
export function fitDock(parts: readonly DockPart[], room: number): Set<string> {
  const hidden = new Set<string>();
  const order = parts
    .filter((p): p is DockPart & { drop: number } => p.drop !== undefined)
    .sort((a, b) => a.drop - b.drop);
  for (const part of order) {
    if (dockWidth(parts, hidden) <= room) break;
    hidden.add(part.key);
  }
  return hidden;
}

const allDroppable = (parts: readonly DockPart[]) =>
  new Set(parts.filter((p) => p.drop !== undefined).map((p) => p.key));

/** The tools and the grid step that didn't fit, in a menu at the end of the tools. */
function OverflowMenu({
  tools,
  active,
  keymap,
  host,
  snap,
}: {
  tools: readonly EditorToolDef[];
  active: string;
  keymap: Keymap;
  host: ToolHost;
  snap: Snap | null;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            icon={MoreHorizontalIcon}
            aria-label="More tools"
            tooltip="More tools"
          />
        }
      />
      <MenuContent side="top" align="center" className="je-dock-overflow">
        {tools.length > 0 ? (
          <MenuRadioGroup value={active} onValueChange={(id) => host.setTool(String(id))}>
            {tools.map((tool) => {
              const chord = toolChord(keymap, tool.id);
              const icon = isEngineTool(tool.id) ? TOOL_ICONS[tool.id] : null;
              return (
                <MenuRadioItem key={tool.id} value={tool.id} closeOnClick>
                  {icon ? <Icon icon={icon} size={14} /> : null}
                  {tool.label}
                  {chord ? (
                    <MenuShortcut>
                      <Hotkey chord={chord} />
                    </MenuShortcut>
                  ) : null}
                </MenuRadioItem>
              );
            })}
          </MenuRadioGroup>
        ) : null}
        {snap ? (
          <>
            {tools.length > 0 ? <MenuSeparator /> : null}
            <MenuGroup>
              <MenuLabel>Grid step</MenuLabel>
              <StepItems host={host} snap={snap} />
            </MenuGroup>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

const NO_SNAP: Snap | null = null;

/**
 * The tools, snapping, undo and redo, and Play. What doesn't fit in the room
 * the frame leaves between the status and the columns moves into a "More
 * tools" menu: game tools first, then the grid step, then the shape tools.
 */
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
  const snap = useHostValue(host, (h) => h.snap(), host?.snap() ?? NO_SNAP);

  const parts = useMemo(() => dockParts(tools, snap?.step ?? null), [tools, snap?.step]);
  const full = useMemo(() => dockWidth(parts, new Set()), [parts]);
  const least = useMemo(() => dockWidth(parts, allDroppable(parts)), [parts]);
  const room = useBottomRow("dock", { full, least }).dock;
  const hidden = useMemo(() => fitDock(parts, room), [parts, room]);

  const shownTools = tools.filter((t) => !hidden.has(`tool:${t.id}`));
  const hiddenTools = tools.filter((t) => hidden.has(`tool:${t.id}`));
  const engineTools = shownTools.filter((t) => isEngineTool(t.id));
  const gameTools = shownTools.filter((t) => !isEngineTool(t.id));

  const toolButton = (tool: EditorToolDef) => (
    <ToolButton
      key={tool.id}
      tool={tool}
      active={tool.id === active}
      chord={toolChord(keymap, tool.id)}
      onPick={() => host?.setTool(tool.id)}
    />
  );

  let overflow: ReactNode = null;
  if (host && hidden.size > 0) {
    overflow = (
      <OverflowMenu
        tools={hiddenTools}
        active={active}
        keymap={keymap}
        host={host}
        snap={hidden.has("step") ? snap : null}
      />
    );
  }

  return (
    <div role="toolbar" aria-label="Editor" className="je-toolbar">
      {host ? (
        <>
          {engineTools.map(toolButton)}
          {gameTools.length > 0 ? <Divider /> : null}
          {gameTools.map(toolButton)}
          {overflow}
          {snap ? (
            <>
              <Divider />
              <SnapToggle host={host} snap={snap} keymap={keymap} />
              {hidden.has("step") ? null : <GridStep host={host} snap={snap} />}
            </>
          ) : null}
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
      <Divider />
      <IconButton
        icon={PlayIcon}
        label="Play"
        variant="secondary"
        onClick={onPlay}
        tooltip={<KeyHint text="Play from spawn" chord={keymap.chordOf("play")} />}
      />
      <IconButton
        icon={CursorPointer01Icon}
        label="Play from here"
        onClick={onPlayHere}
        tooltip={
          <KeyHint text="Play from where the pointer was" chord={keymap.chordOf("play-here")} />
        }
      />
    </div>
  );
}
