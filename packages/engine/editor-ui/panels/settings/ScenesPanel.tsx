import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ArrowDown01Icon, ArrowUp01Icon, DragDropVerticalIcon } from "@hugeicons/core-free-icons";
import { useId, useState } from "react";

import { settingsEdit } from "../../../editor/settings-model";
import { SCENE_KIND_NAME, type AssetId, type ProjectView } from "../../../project/index";
import { isPlainObject } from "../../../project/kinds/define";
import { assetName } from "../../connect/scene-doc";
import {
  Badge,
  Button,
  IconButton,
  Input,
  MicroLabel,
  Radio,
  Spinner,
  Switch,
  Text,
} from "../../kit/index";
import { useBusy } from "../../pending/use-pending";
import { useProjectView } from "../EditorProject";
import { DocGate } from "./DocGate";
import { RemoveButton } from "./RemoveButton";
import { settingScope, type SettingsDoc } from "./settings-doc";
import { SettingsNote } from "./SettingsRows";

type Entry = Record<string, unknown> & { scene: AssetId };

/** The list's entries as the doc holds them, in order; an entry naming no scene id is left out. */
export function listEntries(value: Record<string, unknown>): Entry[] {
  return Array.isArray(value.scenes)
    ? value.scenes.filter((e): e is Entry => isPlainObject(e) && typeof e.scene === "string")
    : [];
}

/** `entries` with `scene` moved to `to` (an index into the list without it). */
export function moved(entries: readonly Entry[], scene: AssetId, to: number): Entry[] {
  const item = entries.find((e) => e.scene === scene);
  if (!item) return [...entries];
  const rest = entries.filter((e) => e !== item);
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** The project's live scenes the list doesn't name, by path. */
function unlistedScenes(view: ProjectView, entries: readonly Entry[]) {
  const listed = new Set(entries.map((e) => e.scene));
  return [...view.byId.values()]
    .filter((e) => e.kind === SCENE_KIND_NAME && !listed.has(e.id))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

type ListCtx = {
  doc: SettingsDoc;
  value: Record<string, unknown>;
  entries: Entry[];
  readOnly: boolean;
};

const edit = (ctx: ListCtx, path: string, next: unknown) =>
  settingsEdit(ctx.doc.entry!.id, path, next, { doc: ctx.value, layout: ctx.doc.layout! });

const LIST_SCOPE = "scenes";

function reorder(ctx: ListCtx, scene: AssetId, to: number, label: string) {
  const next = moved(ctx.entries, scene, to);
  if (next.every((e, i) => e === ctx.entries[i])) return;
  void ctx.doc.edit([edit(ctx, "scenes", next)], label, settingScope(ctx.doc.docName, LIST_SCOPE));
}

function TitleField({ ctx, entry, name }: { ctx: ListCtx; entry: Entry; name: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const title = typeof entry.title === "string" ? entry.title : "";
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === title) return;
    void ctx.doc.edit(
      [edit(ctx, `scenes.@${entry.scene}.title`, text === "" ? undefined : text)],
      text === "" ? `Clear ${name}'s title` : `Title ${name} "${text}"`,
      settingScope(ctx.doc.docName, `scenes.${entry.scene}.title`),
    );
  };
  return (
    <Input
      size="sm"
      aria-label={`${entry.scene} title`}
      placeholder={name}
      value={draft ?? title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** Whether an edit to the list, its start or one of `entry`'s own fields is landing. */
function useRowBusy(ctx: ListCtx, entry: Entry): boolean {
  const scope = (path: string) => settingScope(ctx.doc.docName, path);
  const list = useBusy(scope(LIST_SCOPE));
  const start = useBusy(scope("start"));
  const title = useBusy(scope(`scenes.${entry.scene}.title`));
  const sublevel = useBusy(scope(`scenes.${entry.scene}.sublevel`));
  return [list, start, title, sublevel].some((t) => t !== undefined);
}

function SceneRow({
  ctx,
  entry,
  index,
  view,
}: {
  ctx: ListCtx;
  entry: Entry;
  index: number;
  view: ProjectView;
}) {
  const { doc, value, entries, readOnly } = ctx;
  const asset = view.byId.get(entry.scene);
  const name = asset?.kind === SCENE_KIND_NAME ? assetName(asset) : entry.scene;
  const start = value.start === entry.scene;
  const sublevel = entry.sublevel === true;
  const busy = useRowBusy(ctx, entry);
  const startId = useId();
  const locked = readOnly || busy;
  const drag = useDraggable({ id: entry.scene, disabled: locked });
  const drop = useDroppable({ id: entry.scene });
  const setRef = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  };
  const from = entries.findIndex((e) => e.scene === drop.active?.id);
  const over = drop.isOver && !drag.isDragging ? (from < index ? "after" : "before") : undefined;
  const scope = (part: string) => settingScope(doc.docName, `scenes.${entry.scene}.${part}`);
  return (
    <li
      ref={setRef}
      className="je-insp-field je-scene-entry"
      aria-label={name}
      aria-busy={busy || undefined}
      data-dragging={drag.isDragging ? "" : undefined}
      data-over={over}
      style={drag.transform ? { transform: `translate3d(0, ${drag.transform.y}px, 0)` } : undefined}
    >
      <div className="je-insp-field-label">
        <IconButton
          size="icon-xs"
          icon={DragDropVerticalIcon}
          label={`Drag ${name}`}
          tooltip={null}
          cue={null}
          {...drag.listeners}
          {...drag.attributes}
          disabled={locked}
        />
        <span className="je-insp-field-title">{name}</span>
        {busy ? <Spinner size={11} label={null} /> : null}
        {!asset ? (
          <Badge size="label" variant="warning">
            missing
          </Badge>
        ) : null}
      </div>
      <div className="je-insp-field-control">
        <TitleField ctx={ctx} entry={entry} name={name} />
        <div className="je-insp-row je-insp-line je-insp-wrap" data-gap="tight">
          <label className="je-insp-row je-insp-line" data-gap="tight" htmlFor={startId}>
            <Radio
              id={startId}
              name={`${doc.docName ?? "scene-list"}:start`}
              aria-label={`Start in ${name}`}
              checked={start}
              disabled={locked || sublevel}
              onChange={() =>
                void doc.edit(
                  [edit(ctx, "start", entry.scene)],
                  `Start in ${name}`,
                  settingScope(doc.docName, "start"),
                )
              }
            />
            <Text size="xs">Start</Text>
          </label>
          <span className="je-insp-row je-insp-line" data-gap="tight">
            <Switch
              aria-label={`${name} is a sublevel`}
              checked={sublevel}
              disabled={locked || start}
              onCheckedChange={(on) =>
                void doc.edit(
                  [edit(ctx, `scenes.@${entry.scene}.sublevel`, on ? true : undefined)],
                  on ? `Make ${name} a sublevel` : `Make ${name} a main scene`,
                  scope("sublevel"),
                )
              }
            />
            <Text size="xs" aria-hidden>
              Sublevel
            </Text>
          </span>
          <span className="je-insp-row je-insp-line je-scene-entry-moves" data-gap="tight">
            <IconButton
              size="icon-xs"
              icon={ArrowUp01Icon}
              label={`Move ${name} up`}
              disabled={locked || index === 0}
              onClick={() => reorder(ctx, entry.scene, index - 1, `Move ${name} up`)}
            />
            <IconButton
              size="icon-xs"
              icon={ArrowDown01Icon}
              label={`Move ${name} down`}
              disabled={locked || index === entries.length - 1}
              onClick={() => reorder(ctx, entry.scene, index + 1, `Move ${name} down`)}
            />
            <RemoveButton
              label={`Remove ${name} from the list`}
              title={`Remove ${name} from the scene list?`}
              message={
                start
                  ? "It's the start scene: the game has no start until you pick another. The scene itself stays in the project."
                  : "Flow can no longer load it. The scene itself stays in the project."
              }
              disabled={locked}
              onConfirm={() =>
                doc.edit(
                  [
                    edit(
                      ctx,
                      "scenes",
                      entries.filter((e) => e !== entry),
                    ),
                    ...(start ? [edit(ctx, "start", null)] : []),
                  ],
                  `Remove ${name} from the scene list`,
                  settingScope(doc.docName, LIST_SCOPE),
                )
              }
            />
          </span>
        </div>
      </div>
    </li>
  );
}

/**
 * The project's scene list: listed scenes in order (drag a row, or its
 * arrows, to reorder), the start, titles and sublevels; then the scenes it
 * doesn't list, each added at the end.
 */
export function ScenesPanel({ doc }: { doc: SettingsDoc }) {
  const view = useProjectView(doc.session);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  return (
    <DocGate doc={doc} noun="scene list">
      {(value) => {
        const entries = listEntries(value);
        const ctx: ListCtx = { doc, value, entries, readOnly: doc.readOnly !== null };
        const onDragEnd = ({ active, over }: DragEndEvent) => {
          if (!over || active.id === over.id) return;
          const to = entries.findIndex((e) => e.scene === over.id);
          if (to < 0) return;
          const name = String(active.id);
          reorder(ctx, name, to, `Move ${view.byId.get(name)?.name ?? name}`);
        };
        const rest = unlistedScenes(view, entries);
        return (
          <>
            <div className="je-insp-stack" role="group" aria-label="Scene list">
              <MicroLabel>Listed</MicroLabel>
              {entries.length === 0 ? (
                <SettingsNote>No scenes are listed: flow has nowhere to start.</SettingsNote>
              ) : null}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <ol className="je-insp-stack" aria-label="Listed scenes">
                  {entries.map((entry, i) => (
                    <SceneRow key={entry.scene} ctx={ctx} entry={entry} index={i} view={view} />
                  ))}
                </ol>
              </DndContext>
            </div>
            {rest.length > 0 ? (
              <div className="je-insp-stack" role="group" aria-label="Not listed">
                <MicroLabel>Not listed</MicroLabel>
                {rest.map((scene) => (
                  <div key={scene.id} className="je-insp-line">
                    <Text size="sm" className="je-insp-grow">
                      {assetName(scene)}
                    </Text>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={`Add ${assetName(scene)}`}
                      disabled={ctx.readOnly}
                      busyScope={settingScope(doc.docName, LIST_SCOPE)}
                      onClick={() =>
                        void doc.edit(
                          [edit(ctx, "scenes", [...entries, { scene: scene.id }])],
                          `List ${assetName(scene)}`,
                          settingScope(doc.docName, LIST_SCOPE),
                        )
                      }
                    >
                      Add
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        );
      }}
    </DocGate>
  );
}
