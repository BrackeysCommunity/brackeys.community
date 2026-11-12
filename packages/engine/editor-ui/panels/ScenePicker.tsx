import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useId, useState } from "react";

import { applyProjectBatch } from "../../collab/index";
import { ID_PATTERN } from "../../game/fields";
import {
  SCENE_KIND_NAME,
  SCENE_LIST_KIND,
  sceneListEntries,
  type AssetId,
  type ProjectOp,
  type ProjectOpBatch,
  type ProjectView,
  type SceneListFlow,
} from "../../project/index";
import { folderOf } from "../../project/kinds/define";
import { assetName } from "../connect/scene-doc";
import type { EditorNotify } from "../host";
import {
  Badge,
  Button,
  Confirm,
  Icon,
  Input,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  MicroLabel,
  Switch,
  Text,
} from "../kit/index";
import type { EditorProjectLink } from "../session/use-scene-editor";
import { useProjectView } from "./EditorProject";

/** One scene as the picker lists it. */
export type ScenePickerRow = {
  id: AssetId;
  /** The scene list's title, else the scene's display name. */
  label: string;
  path: string;
  listed: boolean;
  sublevel: boolean;
  /** The scene a new game starts in. */
  start: boolean;
};

const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * The project's live scenes as the picker lists them: the listed ones in
 * list order with their titles, then the rest by path. An entry naming no
 * live scene is left out.
 */
export function scenePickerRows(view: ProjectView, flow: SceneListFlow): ScenePickerRow[] {
  const scenes = [...view.byId.values()].filter((e) => e.kind === SCENE_KIND_NAME);
  const listed: ScenePickerRow[] = [];
  const seen = new Set<AssetId>();
  for (const entry of flow.scenes) {
    const scene = view.byId.get(entry.scene);
    if (scene?.kind !== SCENE_KIND_NAME || seen.has(scene.id)) continue;
    seen.add(scene.id);
    listed.push({
      id: scene.id,
      label: entry.title ?? assetName(scene),
      path: scene.path,
      listed: true,
      sublevel: entry.sublevel === true,
      start: flow.start === scene.id,
    });
  }
  const rest = scenes
    .filter((e) => !seen.has(e.id))
    .sort(byPath)
    .map((e) => ({
      id: e.id,
      label: assetName(e),
      path: e.path,
      listed: false,
      sublevel: false,
      start: false,
    }));
  return [...listed, ...rest];
}

/** A scene id from a typed name: lower case, words joined by dashes; "" when nothing is left. */
export function sceneIdFor(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

/** Why `name` can't name a new scene in `view`; null when it can. */
export function newSceneProblem(view: ProjectView, name: string): string | null {
  const id = sceneIdFor(name);
  if (!ID_PATTERN.test(id)) return "Give it a name with a letter or a digit.";
  const holder = view.byId.get(id);
  if (holder) return `The id "${id}" is taken by ${holder.path}.`;
  return null;
}

/**
 * The batch "New scene…" applies: the scene (the game's template, beside
 * `near`) and, with `list`, its entry at the end of the project's scene
 * list, titled with the typed name when that isn't its id. One batch, so
 * one undo step.
 */
export function newSceneBatch(
  view: ProjectView,
  { name, near, list }: { name: string; near?: string; list: boolean },
): { id: AssetId; batch: ProjectOpBatch } {
  const id = sceneIdFor(name);
  const folder = folderOf(near);
  const ops: ProjectOp[] = [
    { op: "createAsset", kind: SCENE_KIND_NAME, id, path: folder === "" ? "" : `${folder}/` },
  ];
  const [sceneList] = sceneListEntries(view);
  const title = name.trim();
  if (list && sceneList) {
    ops.push({
      op: "editAsset",
      id: sceneList.id,
      edits: [{ insert: "/scenes/-", value: { scene: id, ...(title === id ? {} : { title }) } }],
    });
  }
  return { id, batch: { v: 1, label: `New scene ${title}`, ops } };
}

const NO_FLOW: SceneListFlow = { start: null, scenes: [] };

/** The picker's rows over the project's view, and the open scene's label. */
export function useScenePicker(
  project: EditorProjectLink | undefined,
): { rows: ScenePickerRow[]; label: string } | null {
  const view = useProjectView(project?.session ?? null);
  if (!project || !view || !project.scene || !project.openScene) return null;
  const rows = scenePickerRows(view, project.flow ?? NO_FLOW);
  const label = rows.find((r) => r.id === project.scene)?.label ?? project.scene;
  return { rows, label };
}

// The trigger's widths, as the toolbar's: a small text button's padding, a 12 px glyph, the chevron.
const LABEL_CHARS = 20;
const CHAR = 6.5;

/** The picker's button at `label`, its label cut short past twenty glyphs. */
export const scenePickerWidth = (label: string): number =>
  16 + Math.ceil(Math.min(label.length, LABEL_CHARS) * CHAR) + 6 + 13;

function SceneRow({ row }: { row: ScenePickerRow }) {
  return (
    <MenuRadioItem value={row.id} closeOnClick>
      <span className="je-option-choice">
        <span>
          {row.label}
          {row.start ? (
            <>
              {" "}
              <Badge size="label" variant="secondary">
                Start
              </Badge>
            </>
          ) : null}
          {row.sublevel ? (
            <>
              {" "}
              <Badge size="label" variant="outline">
                Sublevel
              </Badge>
            </>
          ) : null}
        </span>
        <span className="je-option-choice-description">{row.path}</span>
      </span>
    </MenuRadioItem>
  );
}

/**
 * The scene menu's items: the listed scenes first, in list order with their
 * titles, then the rest by path, sublevels tagged and the open one checked.
 * Picking one opens it in place of this one; "New scene…" calls `onNewScene`.
 */
export function SceneMenuItems({
  project,
  rows,
  onNewScene,
  onProjectSettings,
}: {
  project: EditorProjectLink;
  rows: readonly ScenePickerRow[];
  onNewScene: () => void;
  /** Adds "Project settings…", for a frame with the settings panel. */
  onProjectSettings?: (() => void) | null;
}) {
  const { session, scene, openScene } = project;
  const listed = rows.filter((r) => r.listed);
  const rest = rows.filter((r) => !r.listed);
  const writable = !project.readOnly && session.skewFor(SCENE_KIND_NAME) === null;
  const pick = (id: unknown) => {
    if (typeof id === "string" && id !== scene) openScene?.(id);
  };
  return (
    <>
      {listed.length > 0 ? (
        <MenuGroup>
          <MenuLabel>Scene list</MenuLabel>
          <MenuRadioGroup value={scene} onValueChange={pick}>
            {listed.map((row) => (
              <SceneRow key={row.id} row={row} />
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      ) : null}
      {listed.length > 0 && rest.length > 0 ? <MenuSeparator /> : null}
      {rest.length > 0 ? (
        <MenuGroup>
          <MenuLabel>{listed.length > 0 ? "Not listed" : "Scenes"}</MenuLabel>
          <MenuRadioGroup value={scene} onValueChange={pick}>
            {rest.map((row) => (
              <SceneRow key={row.id} row={row} />
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      ) : null}
      <MenuSeparator />
      <MenuItem disabled={!writable} onClick={onNewScene}>
        New scene…
      </MenuItem>
      {onProjectSettings ? (
        <MenuItem onClick={onProjectSettings}>Project settings…</MenuItem>
      ) : null}
    </>
  );
}

/** The toolbar's scene menu, on a button naming the open scene. */
export function ScenePicker({
  project,
  rows,
  label,
  onNewScene,
  onProjectSettings,
}: {
  project: EditorProjectLink;
  rows: readonly ScenePickerRow[];
  label: string;
  onNewScene: () => void;
  onProjectSettings?: (() => void) | null;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            style={{ maxWidth: scenePickerWidth(label) }}
            aria-label={`Scene: ${label}`}
            tooltip="Open another scene"
          />
        }
      >
        <span className="je-sp-truncate">{label}</span>
        <Icon icon={ArrowDown01Icon} size={13} />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="je-option-menu">
        <SceneMenuItems
          project={project}
          rows={rows}
          onNewScene={onNewScene}
          onProjectSettings={onProjectSettings}
        />
      </MenuContent>
    </Menu>
  );
}

/**
 * Asks for the new scene's name, and whether to add it to the scene list
 * (offered while the project has one this build may write). Create applies
 * one batch, beside the open scene, says so and opens the new scene (an
 * undo of it returns to this one); a refusal stays in the dialog.
 */
export function NewSceneDialog({
  project,
  notify,
  onClose,
}: {
  project: EditorProjectLink;
  notify?: EditorNotify;
  onClose: () => void;
}) {
  const { session, scene: near, openScene } = project;
  const view = useProjectView(session);
  const [name, setName] = useState("");
  const [list, setList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const typed = name.trim() !== "";
  const problem = typed ? newSceneProblem(view, name) : null;
  const canList = sceneListEntries(view).length > 0 && session.skewFor(SCENE_LIST_KIND) === null;
  const id = sceneIdFor(name);
  const nameId = useId();

  const create = async () => {
    const made = newSceneBatch(view, {
      name,
      ...(near ? { near: view.byId.get(near)?.path ?? "" } : {}),
      list: list && canList,
    });
    const result = await applyProjectBatch(session, made.batch, session.origin);
    if (!result.ok) {
      setError(result.issue.message);
      return false;
    }
    notify?.success(`Created ${name.trim()}`);
    openScene?.(made.id, near ? { madeFrom: near } : {});
    return true;
  };

  return (
    <Confirm
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="New scene"
      confirmText="Create"
      confirmDisabled={!typed || problem !== null}
      onConfirm={create}
      message={
        <>
          <label htmlFor={nameId} className="je-run-field">
            <MicroLabel>Name</MicroLabel>
            <Input
              id={nameId}
              value={name}
              placeholder="Level 2"
              // oxlint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              aria-invalid={problem !== null || undefined}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          </label>
          <Text as="p" size="xs" variant={problem ? "warning" : "muted"}>
            {problem ?? (typed ? `Its id: ${id}` : "The scene starts from the game's template.")}
          </Text>
          {canList ? (
            <div className="je-insp-line" style={{ gap: 8 }}>
              <Switch checked={list} onCheckedChange={setList} aria-label="Add to scene list" />
              <Text size="sm" aria-hidden>
                Add to scene list
              </Text>
            </div>
          ) : null}
          {error ? (
            <Text as="p" size="xs" variant="danger" role="alert">
              {error}
            </Text>
          ) : null}
        </>
      }
    />
  );
}
