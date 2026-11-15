import {
  ArrowDown01Icon,
  CenterFocusIcon,
  CircleIcon,
  CloudUploadIcon,
  Cursor01Icon,
  CursorMove01Icon,
  ColorPickerIcon,
  CursorPointer01Icon,
  EraserIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  GridIcon,
  GridTableIcon,
  GroupItemsIcon,
  MagicWand01Icon,
  Magnet01Icon,
  MoreHorizontalIcon,
  PaintBrush01Icon,
  PaintBucketIcon,
  PenTool01Icon,
  PlayIcon,
  Redo02Icon,
  RotateClockwiseIcon,
  RotateRight01Icon,
  Route01Icon,
  SquareIcon,
  Undo02Icon,
  UngroupItemsIcon,
} from "@hugeicons/core-free-icons";
import { useMemo, useState, type ReactNode } from "react";

import {
  drawTypeOptions,
  ENGINE_TOOL_IDS,
  SNAP_STEPS,
  type DrawToolKind,
  type EditorCommand,
  type EditorSession,
  type EditorToolDef,
  type EngineToolId,
  type Keymap,
  type TileToolId,
  type ToolHost,
  type ToolOption,
} from "../../editor/index";
import { DEFAULT_LENGTH_UNIT } from "../../game/defaults";
import { TILE_TOOL_IDS } from "../../game/types";
import { pxPerMetreOf } from "../../game/units";
import type { Registry } from "../../scene/index";
import { useDockRoom, usePanelOpener } from "../frame/EditorFrame";
import type { EditorLiveHost, EditorNotify } from "../host";
import { formatLength } from "../kit/format";
import {
  Button,
  cx,
  Hotkey,
  Icon,
  IconButton,
  KeyHint,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  type IconSvgElement,
} from "../kit/index";
import { useEditorResolved, useEditorStore } from "../session/use-editor-store";
import type { EditorProjectLink } from "../session/use-scene-editor";
import { EDIT_LAYERS, unavailableLayers } from "./canvas-layer/edit-layers";
import { useEditLayers, useExpandedScene } from "./canvas-layer/EditLayers";
import { useHostValue } from "./canvas-layer/tool-host";
import { isTilemapIn } from "./EditorCanvasOverlay";
import { ScenePublishDialog } from "./publish/ScenePublishDialog";
import {
  NewSceneDialog,
  SceneMenuItems,
  ScenePicker,
  scenePickerWidth,
  useScenePicker,
  type ScenePickerRow,
} from "./ScenePicker";

const TOOL_ICONS: Record<EngineToolId, IconSvgElement> = {
  select: Cursor01Icon,
  pan: CursorMove01Icon,
  box: SquareIcon,
  circle: CircleIcon,
  pen: PenTool01Icon,
  waypoints: Route01Icon,
  rotate: RotateClockwiseIcon,
};

const TILE_ICONS: Record<TileToolId, IconSvgElement> = {
  "tile-brush": PaintBrush01Icon,
  "tile-rect": GridTableIcon,
  "tile-fill": PaintBucketIcon,
  "tile-erase": EraserIcon,
  "tile-pick": ColorPickerIcon,
  "tile-auto": MagicWand01Icon,
};

const isEngineTool = (id: string): id is EngineToolId =>
  (ENGINE_TOOL_IDS as readonly string[]).includes(id);

export const isTileTool = (id: string): id is TileToolId =>
  (TILE_TOOL_IDS as readonly string[]).includes(id);

/** A built-in tool's icon; a game's tools draw as text. */
const toolIcon = (id: string): IconSvgElement | null =>
  isEngineTool(id) ? TOOL_ICONS[id] : isTileTool(id) ? TILE_ICONS[id] : null;

/** What `R`, `F` and `V` do to the brush while a tile tool is active. */
export const BRUSH_COMMANDS = [
  { key: "brush-cw", icon: RotateRight01Icon, label: "Rotate the brush", chord: "r" },
  {
    key: "brush-flip-x",
    icon: FlipHorizontalIcon,
    label: "Flip the brush horizontally",
    chord: "f",
  },
  { key: "brush-flip-y", icon: FlipVerticalIcon, label: "Flip the brush vertically", chord: "v" },
] as const;

type BrushCommand = (typeof BRUSH_COMMANDS)[number];

/** The brush command's key: the keymap's binding, else the default. */
const brushChord = (keymap: Keymap, c: BrushCommand) =>
  keymap.bindings.find((b) => b.command === c.key)?.key ?? c.chord;

/** The first chord that picks a tool: the engine's `tool:<id>`, or a game key bound to `tool:<id>[:<arg>]`. */
function toolChord(keymap: Keymap, id: string): string | undefined {
  if (isEngineTool(id)) return keymap.chordOf(`tool:${id}` as EditorCommand);
  return keymap.bindings.find(
    (b) =>
      b.scope === "edit" && (b.command === `tool:${id}` || b.command.startsWith(`tool:${id}:`)),
  )?.key;
}

const Divider = () => <span className="je-toolbar-divider" aria-hidden />;

/** The selection commands the toolbar offers beside the tools, each also on a key. */
const ARRANGE = [
  { key: "group", icon: GroupItemsIcon, label: "Group", selection: true },
  { key: "ungroup", icon: UngroupItemsIcon, label: "Ungroup", selection: true },
  { key: "frame", icon: CenterFocusIcon, label: "Frame", selection: false },
] as const satisfies readonly {
  key: EditorCommand;
  icon: IconSvgElement;
  label: string;
  selection: boolean;
}[];

type ArrangeCommand = (typeof ARRANGE)[number];

/** What an arrange command says it does, now: framing takes the whole scene when nothing is selected. */
const arrangeText = (command: ArrangeCommand, hasSelection: boolean) =>
  command.key === "frame"
    ? hasSelection
      ? "Frame the selection"
      : "Frame the whole scene"
    : command.key === "group"
      ? "Group the selection"
      : "Ungroup the selection";

/** The edit overlay's grid on or off for this viewer; off and disabled while the scene has none to draw. */
function GridToggle({ session }: { session: EditorSession }) {
  const [layers, setLayer] = useEditLayers(session);
  const scene = useExpandedScene(session);
  const missing = unavailableLayers(scene, session.registry).grid;
  const on = layers.grid;
  return (
    <IconButton
      icon={GridIcon}
      label="Show the grid"
      variant={on ? "secondary" : "ghost"}
      aria-pressed={on}
      disabled={missing !== undefined && !on}
      onClick={() => setLayer("grid", !on)}
      tooltip={missing ?? "Show the grid"}
    />
  );
}

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
  const icon = toolIcon(tool.id);
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

function StepItems({ host, snap, ppm }: { host: ToolHost; snap: Snap; ppm: number }) {
  return (
    <MenuRadioGroup
      value={String(snap.step)}
      onValueChange={(value) => host.setSnap({ step: Number(value) })}
    >
      {SNAP_STEPS.map((step) => (
        <MenuRadioItem key={step} value={String(step)} closeOnClick>
          {formatLength(step, ppm)}
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}

/** A small button showing a value, opening a menu of the values to pick from. */
function PickerMenu({
  text,
  label,
  tooltip,
  icon,
  minWidth,
  menuClassName,
  children,
}: {
  text: string;
  label: string;
  tooltip: string;
  icon?: IconSvgElement;
  /** Keeps the button one width whichever value it shows. */
  minWidth?: number;
  menuClassName?: string;
  children: ReactNode;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            {...(icon ? { icon } : {})}
            {...(minWidth ? { style: { minWidth } } : {})}
            aria-label={label}
            tooltip={tooltip}
          />
        }
      >
        {text}
        <Icon icon={ArrowDown01Icon} size={13} />
      </MenuTrigger>
      <MenuContent side="bottom" align="center" className={cx("je-snap-menu", menuClassName)}>
        {children}
      </MenuContent>
    </Menu>
  );
}

/** The grid step snapping uses, and the View layers drawn over the canvas. */
function GridStep({
  session,
  host,
  snap,
  ppm,
}: {
  session: EditorSession;
  host: ToolHost;
  snap: Snap;
  ppm: number;
}) {
  return (
    <PickerMenu
      text={formatLength(snap.step, ppm)}
      label={`Grid step ${formatLength(snap.step, ppm)}`}
      tooltip="Grid step and view layers"
    >
      <MenuGroup>
        <MenuLabel>Grid step</MenuLabel>
        <StepItems host={host} snap={snap} ppm={ppm} />
      </MenuGroup>
      <MenuSeparator />
      <ViewItems session={session} />
    </PickerMenu>
  );
}

/**
 * The edit overlay's View layers, each on or off for this viewer. A layer
 * the scene gives nothing to draw says why, and can't be turned on.
 */
function ViewItems({ session }: { session: EditorSession }) {
  const [layers, setLayer] = useEditLayers(session);
  const scene = useExpandedScene(session);
  const missing = unavailableLayers(scene, session.registry);
  return (
    <MenuGroup>
      <MenuLabel>View</MenuLabel>
      {EDIT_LAYERS.map(({ id, label, description }) => (
        <MenuCheckboxItem
          key={id}
          checked={layers[id]}
          disabled={missing[id] !== undefined && !layers[id]}
          onCheckedChange={(checked) => setLayer(id, checked)}
        >
          <span className="je-option-choice">
            {label}
            <span className="je-option-choice-description">{missing[id] ?? description}</span>
          </span>
        </MenuCheckboxItem>
      ))}
    </MenuGroup>
  );
}

const optionText = (option: ToolOption) =>
  option.choices.find((c) => c.value === option.value)?.label ?? option.value;

function OptionItems({ host, option }: { host: ToolHost; option: ToolOption }) {
  return (
    <MenuRadioGroup
      value={option.value}
      onValueChange={(value) => host.command(`${option.command}${String(value)}`)}
    >
      {option.choices.map((choice) => (
        <MenuRadioItem key={choice.value} value={choice.value} closeOnClick>
          <span className="je-option-choice">
            {choice.label}
            {choice.description ? (
              <span className="je-option-choice-description">{choice.description}</span>
            ) : null}
          </span>
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}

/** The active tool's setting: the type a draw tool adds. */
function ToolOptionMenu({
  host,
  option,
  width,
}: {
  host: ToolHost;
  option: ToolOption;
  width: number;
}) {
  const text = optionText(option);
  return (
    <PickerMenu
      text={text}
      label={`${option.label}: ${text}`}
      tooltip={option.label}
      minWidth={width}
      menuClassName="je-option-menu"
    >
      <OptionItems host={host} option={option} />
    </PickerMenu>
  );
}

/** The option's slot while the active tool has none, so the dock keeps its place. */
function NoToolOption({ width }: { width: number }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled
      style={{ minWidth: width }}
      aria-label="Draw type: the active tool adds no type"
    >
      —
      <Icon icon={ArrowDown01Icon} size={13} />
    </Button>
  );
}

const DRAW_TOOLS: readonly DrawToolKind[] = ["box", "circle", "pen"];

type OptionChoices = {
  choices: readonly { label: string }[];
  /** The choice the slot shows now; absent while the active tool has no option. */
  shown?: string;
};

/**
 * The widest choices the dock's option slot holds: the active tool's, or any
 * of the built-in draw tools' that offers two or more types, with the active
 * tool's choice as `shown`. Null when no tool has an option, and the dock has
 * no slot.
 */
export function optionSlot(
  tools: readonly EditorToolDef[],
  registry: Registry,
  option: ToolOption | null,
): OptionChoices | null {
  const candidates: OptionChoices[] = option ? [option] : [];
  for (const kind of DRAW_TOOLS) {
    if (!tools.some((t) => t.id === kind)) continue;
    const choices = drawTypeOptions(registry, kind);
    if (choices.length > 1) candidates.push({ choices });
  }
  let widest: OptionChoices | null = null;
  for (const c of candidates) if (!widest || optionWidth(c) > optionWidth(widest)) widest = c;
  return widest && option ? { choices: widest.choices, shown: optionText(option) } : widest;
}

// The toolbar's widths, matching the stylesheet: an island's padding and
// border, the toolbar's gap, a small icon button, a divider with its margins,
// and a small text button's padding plus a generous 12 px glyph.
const W = {
  island: 10,
  gap: 4,
  icon: 24,
  divider: 5,
  char: 6.5,
  narrow: 3.5,
  textPad: 16,
} as const;

/** A label's glyphs at `W.char`, its points at `W.narrow`. */
const glyphs = (label: string) =>
  [...label].reduce((sum, ch) => sum + (ch === "." ? W.narrow : W.char), 0);

const textWidth = (label: string) => W.textPad + Math.ceil(label.length * W.char);
/** The grid step's button: the step in metres, the chevron and the gap before it. */
const stepWidth = (step: number, ppm: number) =>
  W.textPad + Math.ceil(glyphs(formatLength(step, ppm))) + 6 + 13;
/** A picker button showing `chars` glyphs, its chevron and the gap before it. */
const pickerWidth = (chars: number) => W.textPad + Math.ceil(chars * W.char) + 6 + 13;
/** A tool option's button at its longest choice, so picking another doesn't refit the dock. */
const optionWidth = (option: OptionChoices) =>
  pickerWidth(Math.max(...option.choices.map((c) => c.label.length)));

/** The glyphs the option slot keeps room for when the dock is short, unless its choice is longer. */
const SLOT_GLYPHS = 8;

/**
 * The option slot's width in a short dock: room for `SLOT_GLYPHS`, or for
 * the shown choice when that is longer, never more than its full width. One
 * long type name then costs room only while it is picked.
 */
const narrowOptionWidth = (option: OptionChoices) =>
  Math.min(optionWidth(option), pickerWidth(Math.max(SLOT_GLYPHS, option.shown?.length ?? 0)));

/** Tools that never move into the overflow menu. */
const isPinned = (id: string) => id === "select" || id === "pan";

/**
 * One control in the toolbar; `drop` orders what moves into the overflow
 * menu, lowest first, and a part with `narrow` shrinks to it before any part
 * moves there.
 */
export type DockPart = { key: string; width: number; narrow?: number; drop?: number; game?: true };

const NARROW = "narrow:";

/** The key `fitDock` adds when it shrinks a part to its `narrow` width. */
export const narrowed = (key: string) => `${NARROW}${key}`;

/** Whether `fitDock` moved anything into the overflow menu, not only narrowed a part. */
export const overflows = (hidden: ReadonlySet<string>) =>
  [...hidden].some((key) => !key.startsWith(NARROW));

/**
 * What the toolbar draws, in order, before anything overflows; `option` is
 * the slot's (`optionSlot`), the grid step is shown in metres at `ppm`,
 * `scene` is the scene picker's label when the toolbar has one, and
 * `publish` adds Publish scene after Play.
 */
export function dockParts(
  tools: readonly EditorToolDef[],
  step: number | null,
  option: OptionChoices | null = null,
  ppm: number = DEFAULT_LENGTH_UNIT,
  scene: string | null = null,
  publish = false,
): DockPart[] {
  const engine = tools.filter((t) => isEngineTool(t.id));
  const tile = tools.filter((t) => isTileTool(t.id));
  const game = tools.filter((t) => !isEngineTool(t.id) && !isTileTool(t.id));
  const parts: DockPart[] = [];
  if (scene !== null) {
    // Into "More tools" after the grid step and the tool's option, so long as there is that menu.
    parts.push({
      key: "scene",
      width: scenePickerWidth(scene),
      ...(tools.length > 0 ? { drop: 160 } : {}),
    });
    if (tools.length > 0) parts.push({ key: "divider:scene", width: W.divider });
  }
  engine.forEach((t, i) =>
    parts.push({
      key: `tool:${t.id}`,
      width: W.icon,
      drop: isPinned(t.id) ? undefined : 200 + engine.length - i,
    }),
  );
  if (game.length > 0) parts.push({ key: "divider:game", width: W.divider });
  game.forEach((t, i) =>
    parts.push({
      key: `tool:${t.id}`,
      width: textWidth(t.label),
      drop: game.length - i,
      game: true,
    }),
  );
  if (tile.length > 0) {
    parts.push({ key: "divider:tile", width: W.divider });
    tile.forEach((t, i) =>
      parts.push({ key: `tool:${t.id}`, width: W.icon, drop: 170 + tile.length - i }),
    );
    BRUSH_COMMANDS.forEach((c, i) => parts.push({ key: c.key, width: W.icon, drop: 165 + i }));
  }
  if (option) {
    parts.push(
      { key: "divider:option", width: W.divider },
      { key: "option", width: optionWidth(option), narrow: narrowOptionWidth(option), drop: 150 },
    );
  }
  if (step !== null) {
    parts.push(
      { key: "divider:snap", width: W.divider },
      { key: "snap", width: W.icon },
      { key: "step", width: stepWidth(step, ppm), drop: 100 },
      { key: "grid", width: W.icon, drop: 105 },
    );
  }
  if (tools.length > 0) {
    parts.push({ key: "divider:arrange", width: W.divider });
    ARRANGE.forEach((c, i) => parts.push({ key: c.key, width: W.icon, drop: 60 + i }));
  }
  parts.push(
    { key: "undo", width: W.icon },
    { key: "redo", width: W.icon },
    { key: "divider:play", width: W.divider },
    { key: "play", width: W.icon },
    { key: "play-here", width: W.icon },
  );
  if (publish)
    parts.push({ key: "divider:publish", width: W.divider }, { key: "publish", width: W.icon });
  return parts;
}

/** The toolbar's width with `hidden` in the overflow menu (and its trigger drawn when any is). */
export function dockWidth(parts: readonly DockPart[], hidden: ReadonlySet<string>): number {
  const anyGame = parts.some((p) => p.game && !hidden.has(p.key));
  const anyArrange = ARRANGE.some((c) => parts.some((p) => p.key === c.key) && !hidden.has(c.key));
  const anyTile = parts.some(
    (p) =>
      ((p.key.startsWith("tool:") && isTileTool(p.key.slice(5))) ||
        BRUSH_COMMANDS.some((c) => c.key === p.key)) &&
      !hidden.has(p.key),
  );
  const shown = parts.filter(
    (p) =>
      !hidden.has(p.key) &&
      (p.key !== "divider:game" || anyGame) &&
      (p.key !== "divider:tile" || anyTile) &&
      (p.key !== "divider:arrange" || anyArrange) &&
      (p.key !== "divider:option" || !hidden.has("option")) &&
      (p.key !== "divider:scene" || !hidden.has("scene")),
  );
  const widths = shown.map((p) =>
    p.narrow !== undefined && hidden.has(narrowed(p.key)) ? p.narrow : p.width,
  );
  if (overflows(hidden)) widths.push(W.icon);
  return W.island + widths.reduce((a, b) => a + b, 0) + W.gap * Math.max(0, widths.length - 1);
}

/**
 * What gives way so the toolbar fits in `room`: first the parts that can
 * narrow do (their `narrowed` keys), then these move into the overflow menu:
 * game tools, Group, Ungroup and Frame, the grid step, the grid toggle, the
 * tool's option, the scene picker, the brush's turns, the tile tools, then
 * shape tools.
 */
export function fitDock(parts: readonly DockPart[], room: number): Set<string> {
  const hidden = new Set<string>();
  const steps = [
    ...parts
      .filter((p) => p.narrow !== undefined && p.narrow < p.width)
      .map((p) => narrowed(p.key)),
    ...parts
      .filter((p): p is DockPart & { drop: number } => p.drop !== undefined)
      .sort((a, b) => a.drop - b.drop)
      .map((p) => p.key),
  ];
  for (const key of steps) {
    if (dockWidth(parts, hidden) <= room) break;
    hidden.add(key);
  }
  return hidden;
}

/** The scene picker as "More tools" holds it: a submenu naming the open scene. */
type OverflowScene = {
  project: EditorProjectLink;
  rows: readonly ScenePickerRow[];
  label: string;
  onNewScene: () => void;
  onProjectSettings: (() => void) | null;
  onPublish: (() => void) | null;
};

/**
 * The tools, the tool's option, the grid menu (the step and the View
 * layers) and the scene picker that didn't fit, in a menu at the end of the
 * tools.
 */
function OverflowMenu({
  session,
  tools,
  active,
  keymap,
  host,
  snap,
  option,
  ppm,
  scene,
  arrange,
  brush,
  hasSelection,
}: {
  session: EditorSession;
  tools: readonly EditorToolDef[];
  active: string;
  keymap: Keymap;
  host: ToolHost;
  snap: Snap | null;
  option: ToolOption | null;
  ppm: number;
  scene: OverflowScene | null;
  /** The selection commands that didn't fit. */
  arrange: readonly ArrangeCommand[];
  /** The brush's turns that didn't fit, while a tile tool is active. */
  brush: readonly BrushCommand[];
  hasSelection: boolean;
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
      <MenuContent side="bottom" align="end" className="je-dock-overflow">
        {tools.length > 0 ? (
          <MenuRadioGroup value={active} onValueChange={(id) => host.setTool(String(id))}>
            {tools.map((tool) => {
              const chord = toolChord(keymap, tool.id);
              const icon = toolIcon(tool.id);
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
        {arrange.length > 0 ? (
          <>
            {tools.length > 0 ? <MenuSeparator /> : null}
            <MenuGroup>
              {arrange.map((c) => {
                const chord = keymap.chordOf(c.key);
                return (
                  <MenuItem
                    key={c.key}
                    disabled={c.selection && !hasSelection}
                    onClick={() => host.command(c.key)}
                  >
                    <Icon icon={c.icon} size={14} />
                    {arrangeText(c, hasSelection)}
                    {chord ? (
                      <MenuShortcut>
                        <Hotkey chord={chord} />
                      </MenuShortcut>
                    ) : null}
                  </MenuItem>
                );
              })}
            </MenuGroup>
          </>
        ) : null}
        {brush.length > 0 ? (
          <>
            {tools.length > 0 || arrange.length > 0 ? <MenuSeparator /> : null}
            <MenuGroup>
              {brush.map((c) => (
                <MenuItem key={c.key} onClick={() => host.command(c.key)}>
                  <Icon icon={c.icon} size={14} />
                  {c.label}
                  <MenuShortcut>
                    <Hotkey chord={brushChord(keymap, c)} />
                  </MenuShortcut>
                </MenuItem>
              ))}
            </MenuGroup>
          </>
        ) : null}
        {option ? (
          <>
            {tools.length > 0 || arrange.length > 0 || brush.length > 0 ? <MenuSeparator /> : null}
            <MenuGroup>
              <MenuLabel>{option.label}</MenuLabel>
              <OptionItems host={host} option={option} />
            </MenuGroup>
          </>
        ) : null}
        {snap ? (
          <>
            {tools.length > 0 || arrange.length > 0 || brush.length > 0 || option ? (
              <MenuSeparator />
            ) : null}
            <MenuGroup>
              <MenuLabel>Grid step</MenuLabel>
              <StepItems host={host} snap={snap} ppm={ppm} />
            </MenuGroup>
            <MenuSeparator />
            <ViewItems session={session} />
          </>
        ) : null}
        {scene ? (
          <>
            {tools.length > 0 || arrange.length > 0 || brush.length > 0 || option || snap ? (
              <MenuSeparator />
            ) : null}
            <MenuSub>
              <MenuSubTrigger>Scene: {scene.label}</MenuSubTrigger>
              <MenuSubContent className="je-option-menu">
                <SceneMenuItems
                  project={scene.project}
                  rows={scene.rows}
                  onNewScene={scene.onNewScene}
                  onProjectSettings={scene.onProjectSettings}
                  onPublish={scene.onPublish}
                />
              </MenuSubContent>
            </MenuSub>
          </>
        ) : null}
      </MenuContent>
    </Menu>
  );
}

/** Publish scene's hint in the toolbar. */
export const PUBLISH_SCENE_TOOLTIP = "Publish this level to players without a new release";

/** Publish scene's icon: one level sent up live, apart from the Publish panel's releases. */
export const PUBLISH_SCENE_ICON = CloudUploadIcon;

const NO_SNAP: Snap | null = null;
const NO_OPTION: ToolOption | null = null;

/**
 * The scene picker (in a project), the tools, the active tool's option,
 * snapping, the grid menu (the step and the View layers), undo and redo,
 * Play, and Publish scene when the host publishes scenes live.
 * What doesn't fit in the room the frame leaves between the status and the
 * columns gives way: the option slot narrows, then things move into a
 * "More tools" menu: game tools first, then the grid step, the tool's
 * option, then the shape tools.
 */
export function EditorToolbar({
  session,
  keymap,
  host,
  onPlay,
  onPlayHere,
  project,
  notify,
  live,
}: {
  session: EditorSession;
  keymap: Keymap;
  /** The tool host; the tool and snap controls wait for it. */
  host: ToolHost | null;
  onPlay: () => void;
  onPlayHere: () => void;
  /** The open scene's project; with a way to open another scene, the toolbar starts with the picker. */
  project?: EditorProjectLink;
  notify?: EditorNotify;
  /** The host's live scene publishing; with it and a project, the toolbar ends with Publish scene. */
  live?: EditorLiveHost;
}) {
  const canUndo = useEditorStore(session, (s) => s.canUndo);
  const canRedo = useEditorStore(session, (s) => s.canRedo);
  const undoLabel = useEditorStore(session, (s) => s.undoLabel);
  const redoLabel = useEditorStore(session, (s) => s.redoLabel);
  const active = useEditorStore(session, (s) => s.tool);
  const hasSelection = useEditorStore(session, (s) => s.selection.length > 0);
  const resolved = useEditorResolved(session);
  const hasTilemap = useMemo(
    () => (resolved.entities ?? []).some((e) => isTilemapIn(session.registry, e.type)),
    [resolved, session.registry],
  );
  const tools = useMemo(
    () => [...(host?.tools() ?? []), ...(hasTilemap ? (host?.tileTools() ?? []) : [])],
    [host, hasTilemap],
  );
  const tileActive = isTileTool(active);
  const snap = useHostValue(host, (h) => h.snap(), host?.snap() ?? NO_SNAP);
  const option = useHostValue(host, (h) => h.option() ?? NO_OPTION, NO_OPTION);
  const slot = useMemo(
    () => optionSlot(tools, session.registry, option),
    [tools, session.registry, option],
  );

  const picker = useScenePicker(project);
  const openSettings = usePanelOpener("settings");
  const openPublish = usePanelOpener("publish");
  const sceneLabel = picker?.label ?? null;
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const publishable = live && project ? { live, project } : null;
  const canPublish = publishable !== null;
  const ppm = pxPerMetreOf(session.registry);
  const parts = useMemo(
    () => dockParts(tools, snap?.step ?? null, slot, ppm, sceneLabel, canPublish),
    [tools, snap?.step, slot, ppm, sceneLabel, canPublish],
  );
  const room = useDockRoom();
  const hidden = useMemo(() => fitDock(parts, room), [parts, room]);
  const slotPart = parts.find((p) => p.key === "option");
  const slotWidth =
    slotPart?.narrow !== undefined && hidden.has(narrowed("option"))
      ? slotPart.narrow
      : (slotPart?.width ?? 0);

  const shownTools = tools.filter((t) => !hidden.has(`tool:${t.id}`));
  const hiddenTools = tools.filter((t) => hidden.has(`tool:${t.id}`));
  const engineTools = shownTools.filter((t) => isEngineTool(t.id));
  const tileTools = shownTools.filter((t) => isTileTool(t.id));
  const gameTools = shownTools.filter((t) => !isEngineTool(t.id) && !isTileTool(t.id));
  const shownBrush = hasTilemap ? BRUSH_COMMANDS.filter((c) => !hidden.has(c.key)) : [];

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
  if (host && overflows(hidden)) {
    overflow = (
      <OverflowMenu
        session={session}
        tools={hiddenTools}
        active={active}
        keymap={keymap}
        host={host}
        snap={hidden.has("step") ? snap : null}
        option={hidden.has("option") ? option : null}
        ppm={ppm}
        arrange={ARRANGE.filter((c) => hidden.has(c.key))}
        brush={tileActive ? BRUSH_COMMANDS.filter((c) => hidden.has(c.key)) : []}
        hasSelection={hasSelection}
        scene={
          picker && project && hidden.has("scene")
            ? {
                project,
                ...picker,
                onNewScene: () => setCreating(true),
                onProjectSettings: openSettings,
                onPublish: openPublish,
              }
            : null
        }
      />
    );
  }

  return (
    <div role="toolbar" aria-label="Editor" className="je-toolbar">
      {picker && project && !hidden.has("scene") ? (
        <>
          <ScenePicker
            project={project}
            rows={picker.rows}
            label={picker.label}
            onNewScene={() => setCreating(true)}
            onProjectSettings={openSettings}
            onPublish={openPublish}
          />
          {!host || tools.length > 0 ? <Divider /> : null}
        </>
      ) : null}
      {creating && project ? (
        <NewSceneDialog
          project={project}
          {...(notify ? { notify } : {})}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {host ? (
        <>
          {engineTools.map(toolButton)}
          {gameTools.length > 0 ? <Divider /> : null}
          {gameTools.map(toolButton)}
          {tileTools.length > 0 || shownBrush.length > 0 ? (
            <span data-tile-tools="" style={{ display: "contents" }}>
              <Divider />
              {tileTools.map(toolButton)}
              {shownBrush.map((c) => (
                <IconButton
                  key={c.key}
                  icon={c.icon}
                  label={c.label}
                  disabled={!tileActive}
                  onClick={() => host.command(c.key)}
                  tooltip={<KeyHint text={c.label} chord={brushChord(keymap, c)} />}
                />
              ))}
            </span>
          ) : null}
          {overflow}
          {slot && !hidden.has("option") ? (
            <>
              <Divider />
              {option ? (
                <ToolOptionMenu host={host} option={option} width={slotWidth} />
              ) : (
                <NoToolOption width={slotWidth} />
              )}
            </>
          ) : null}
          {snap ? (
            <>
              <Divider />
              <SnapToggle host={host} snap={snap} keymap={keymap} />
              {hidden.has("step") ? null : (
                <GridStep session={session} host={host} snap={snap} ppm={ppm} />
              )}
              {hidden.has("grid") ? null : <GridToggle session={session} />}
            </>
          ) : null}
          {tools.length > 0 && ARRANGE.some((c) => !hidden.has(c.key)) ? (
            <>
              <Divider />
              {ARRANGE.filter((c) => !hidden.has(c.key)).map((c) => (
                <IconButton
                  key={c.key}
                  icon={c.icon}
                  label={c.label}
                  disabled={c.selection && !hasSelection}
                  onClick={() => host.command(c.key)}
                  tooltip={
                    <KeyHint text={arrangeText(c, hasSelection)} chord={keymap.chordOf(c.key)} />
                  }
                />
              ))}
            </>
          ) : null}
        </>
      ) : null}
      <span className="je-toolbar-spacer" aria-hidden />
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
      {publishable ? (
        <>
          <Divider />
          <IconButton
            icon={PUBLISH_SCENE_ICON}
            label="Publish scene"
            tooltip={PUBLISH_SCENE_TOOLTIP}
            onClick={() => setPublishing(true)}
          />
          {publishing ? (
            <ScenePublishDialog
              live={publishable.live}
              session={session}
              project={publishable.project}
              {...(notify ? { notify } : {})}
              onClose={() => setPublishing(false)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
