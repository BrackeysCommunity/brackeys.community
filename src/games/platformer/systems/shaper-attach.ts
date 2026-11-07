import { TOOL_PRIORITY } from "@jams/engine/game";
import type {
  GameAttachment,
  GameKeyBinding,
  GameShell,
  SceneRuntimeHandle,
  ToolConsumer,
} from "@jams/engine/game";

import type { GrappleAnchorSystem } from "../entities/grapple-anchor";
import {
  CONSTRUCT_CONFIGS,
  CONSTRUCT_TYPES,
  type ConstructSystem,
  type ConstructType,
} from "../entities/shaper-constructs";
import { TYPE } from "../type-names";
import { createShaperSystem } from "./shaper";

const TOGGLE = "platformer:shaper";
const PICK = "platformer:construct:";

/**
 * The Shaper's keys, as the editor's keymap shows and routes them. Without
 * the editor the Shaper's own consumer reads the same table, so both paths
 * end in `onCommand`.
 */
export const SHAPER_KEYS: readonly GameKeyBinding[] = [
  { key: "Tab", scope: "play", command: TOGGLE, description: "Toggle the Shaper" },
  ...CONSTRUCT_TYPES.map(
    (type): GameKeyBinding => ({
      key: String(CONSTRUCT_CONFIGS[type].hotkey),
      scope: "play",
      command: `${PICK}${type}`,
      description: `Shaper: pick ${CONSTRUCT_CONFIGS[type].label}`,
    }),
  ),
];

function pickedType(command: string): ConstructType | undefined {
  if (!command.startsWith(PICK)) return undefined;
  return CONSTRUCT_TYPES.find((t) => t === command.slice(PICK.length));
}

/** Shift is the dash, so a key pressed mid-dash still counts. */
function keyCommand(e: KeyboardEvent): string | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  return SHAPER_KEYS.find((b) => b.key === e.key)?.command;
}

/**
 * The Shaper in play mode: Tab toggles it, 1-6 pick a construct, the wheel
 * rotates it, left click places, right click or Escape cancels.
 */
export function attachShaper(shell: GameShell, runtime: SceneRuntimeHandle): GameAttachment {
  const constructs = runtime.ctx.system<ConstructSystem>(TYPE.construct);
  const anchors = runtime.ctx.system<GrappleAnchorSystem>(TYPE.anchor);
  if (!constructs || !anchors) return { destroy() {} };

  const shaper = createShaperSystem({
    view: shell.view,
    constructs,
    anchors,
    bounds: runtime.ctx.bounds,
  });
  let active = false;
  const playing = () => shell.getMode() === "play";

  function setActive(next: boolean): void {
    active = next;
    shaper.setActive(next);
    if (!next) shaper.clearSelection();
  }

  /** Whether `command` does something now: the toggle always in play, a pick while the Shaper is out. */
  function applies(command: string): boolean {
    if (!playing()) return false;
    return command === TOGGLE || (active && pickedType(command) !== undefined);
  }

  function onCommand(command: string): boolean {
    if (!applies(command)) return false;
    const type = pickedType(command);
    if (type) shaper.selectType(type);
    else setActive(!active);
    return true;
  }

  function onCancel(): boolean {
    if (!playing() || shaper.getSelectedType() == null) return false;
    shaper.clearSelection();
    return true;
  }

  const consumer: ToolConsumer = {
    id: "platformer:shaper",
    priority: TOOL_PRIORITY.game,
    accepts(e) {
      if (!playing()) return false;
      if (e.kind === "key") {
        // Keys from elsewhere on the page (a focused button) are left to it, as play input does.
        if (e.type !== "down" || e.outsideTarget) return false;
        if (e.key === "Escape") return shaper.getSelectedType() != null;
        const command = keyCommand(e.native);
        return command !== undefined && applies(command);
      }
      if (!active) return false;
      if (e.type === "wheel") return true;
      return e.type === "down" && (e.button === 0 || e.button === 2) && !!shaper.getSelectedType();
    },
    handle(e) {
      if (e.kind === "key") {
        // Marked handled, so neither focus (Tab) nor a page-level Escape (stop play) acts on it too.
        e.native.preventDefault();
        if (e.key === "Escape") onCancel();
        else onCommand(keyCommand(e.native)!);
      } else if (e.type === "wheel") {
        shaper.rotatePreview(e.deltaY > 0 ? 1 : -1);
      } else if (e.button === 0) {
        const result = shaper.place();
        if (!result.valid && shell.dev)
          console.log(`[shaper] placement rejected: ${result.reason}`);
      } else {
        shaper.clearSelection();
      }
    },
  };
  const unregister = shell.router.register(consumer);

  return {
    onTick(dtMs, mouseWorld) {
      if (active) shaper.updatePreview(mouseWorld, dtMs);
    },
    onModeChange(mode) {
      if (mode === "edit") setActive(false);
    },
    onCommand,
    onCancel,
    destroy() {
      unregister();
      shaper.destroy();
    },
  };
}
