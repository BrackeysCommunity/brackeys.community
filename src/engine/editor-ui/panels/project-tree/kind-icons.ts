import {
  CheckListIcon,
  CubeIcon,
  File01Icon,
  GameController01Icon,
  Grid02Icon,
  Image01Icon,
  KeyboardIcon,
  Layers01Icon,
  MusicNote01Icon,
  PaintBoardIcon,
  PuzzleIcon,
  Settings02Icon,
  SourceCodeIcon,
  Table01Icon,
  TextFontIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";

import type { IconSvgElement } from "../../kit/icon";

/** The engine's asset kinds and code. */
const ICONS: Readonly<Record<string, IconSvgElement>> = {
  scene: Layers01Icon,
  prefab: CubeIcon,
  material: PaintBoardIcon,
  "game-settings": Settings02Icon,
  "data-table": Table01Icon,
  "input-script": KeyboardIcon,
  "input-map": GameController01Icon,
  checks: CheckListIcon,
  texture: Image01Icon,
  atlas: Grid02Icon,
  font: TextFontIcon,
  audio: MusicNote01Icon,
  recording: Video01Icon,
  code: SourceCodeIcon,
};

/** A kind's icon; a game's own kinds (`<gameId>/<name>`) share one. */
export function kindIcon(kind: string): IconSvgElement {
  return ICONS[kind] ?? (kind.includes("/") ? PuzzleIcon : File01Icon);
}
