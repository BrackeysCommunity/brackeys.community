import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  RotateLeft01Icon,
  RotateRight01Icon,
} from "@hugeicons/core-free-icons";
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import { layoutFromDoc, type ProjectSession, type SessionDoc } from "../../collab/index";
import {
  applyLevels,
  applyToPrefabBatch,
  buildInspectorModel,
  childOverrides,
  createPrefabBatch,
  flipBatch,
  instanceOfRef,
  instanceParamsModel,
  instanceTransformModel,
  instanceZBatch,
  instancesOf,
  lookupRef,
  modelBatch,
  nestedInstanceOf,
  overridePathsOf,
  paramBatch,
  refCandidates,
  revertAllBatch,
  shapeConversions,
  shapeSlots,
  turnBatch,
  unpackBatch,
  withShapeSlot,
  type EditorSession,
  type FieldWidget,
  type InspectorModel,
  type InspectorSectionModel,
  type InspectorWidgetDef,
  type InstanceParamsModel,
  type InstanceTransformModel,
  type ParamModel,
  type ModelField,
  type OpBatch,
  type Pt,
  type Ref,
  type RefTarget,
  type SceneDefinition,
  type ShapeTuple,
} from "../../editor/index";
import {
  articled,
  fieldTitle,
  lengthStep,
  overlappingKeys,
  paramOverriddenBy,
  withArticle,
} from "../../editor/inspector-model";
import { BEHAVIOR_CATEGORIES, BEHAVIORS_FIELD } from "../../game/behaviors";
import { ticksFor } from "../../game/time";
import { pxPerMetreOf } from "../../game/units";
import { sourceClipsIn } from "../../project/clip-source";
import {
  assetInfo,
  isRuntimeKind,
  parseAssetDoc,
  type AssetId,
  type AssetKindName,
  type ProjectView,
} from "../../project/index";
import { ANIMATION_KIND } from "../../project/kinds/animation";
import type { PrefabLibrary } from "../../scene/index";
import { snapToPixel } from "../../scene/units";
import { STORAGE_PREFIX } from "../host";
import {
  Button,
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Confirm,
  Icon,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuTrigger,
  MicroLabel,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Text,
  useComboboxAnchor,
  useKit,
} from "../kit/index";
import { useBrowserState } from "../kit/ssr";
import { openPrefabScope } from "../session/live-scene-editor";
import { readStored, storedFlags, writeStored } from "../session/stored";
import {
  useEditorDoc,
  useEditorPrefabs,
  useEditorResolved,
  useEditorStore,
} from "../session/use-editor-store";
import { useProjectView } from "./EditorProject";
import {
  AssetCombobox,
  assetOptions,
  danglingAsset,
  FrameSelect,
  frameFor,
} from "./inspector/asset-picker";
import { ColorWidget } from "./inspector/color-widget";
import {
  AngleField,
  asPt,
  EditError,
  FieldRow,
  Hinted,
  MIXED,
  NestedField,
  NumberField,
  NumberInput,
  OptionsField,
  PointField,
  PT_BOUNDS,
  ReadonlyField,
  resolveNumber,
  SwitchField,
  TextField,
  UnitSuffix,
  unsetText,
  type Bounds,
} from "./inspector/field-widgets";
import { AssetPanel, type SelectedAsset } from "./project-tree/asset-panel";

/** Why an edit didn't land in a read-only inspector. */
const READ_ONLY = "This scene is read-only.";

const ReadOnlyContext = createContext(false);

/** Makes every inspector below it take no edits, as `EditorInspector`'s `readOnly` does. */
export const InspectorReadOnly = ReadOnlyContext.Provider;

/** Where an edit lands: the selection's targets in the doc they were read from. */
/**
 * `targets` come from the session's resolved view, so instance children and
 * group members read in world coordinates and their edits go through
 * `toSourceBatch`; `def` is the document, for the `base` hash.
 */
type Ctx = {
  session: EditorSession;
  targets: RefTarget[];
  def: SceneDefinition;
  /** For one instance child: its scene instance, its id there, and the override keys naming it. */
  overrides?: { instance: string; child: string; keys: string[] };
  /** For one instance child: the paths on it (`behaviors.character-side-view.maxSpeed`) each param its instance sets feeds. */
  params?: readonly { name: string; paths: readonly string[] }[];
  /** Builds the batch for an edit instead of `modelBatch`; it's written against the document. */
  edit?: (field: ModelField, input: unknown) => Edit;
  /** Builds one batch for several edits instead of joining `edit`'s, when they can touch one value. */
  editAll?: (label: string, edits: readonly (readonly [ModelField, unknown])[]) => Edit;
  /** Every edit is refused. */
  readOnly?: boolean;
  /** Where asset fields find the project's assets; without it they're text fields. */
  project?: ProjectSession | null;
  /** The model's fields by path, for widgets that edit a sibling (an atlas's frame). */
  fields?: ReadonlyMap<string, ModelField>;
  /** Fields an asset picker draws as its frame or clip row, so they aren't drawn again. */
  drawnBy?: ReadonlySet<string>;
  /** The clips an animation or atlas offers (`useClips`), for an asset picker's clip row. */
  clips?: ClipLookup;
};

type ClipLookup = (source: AssetId) => readonly string[] | null;

type Edit = { ok: true; batch: OpBatch } | { ok: false; error: string };

function valueAt(target: RefTarget, path: string): unknown {
  if (target.kind === "bulk") return path.includes(".") ? undefined : target.value;
  let cur: unknown = target.entity;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const OP_REFUSAL = /^([^:]+): \/ops\/\d+(?:\/(?:set|unset)\/([^:\s]+))?: (.+)$/s;

/**
 * An op's refusal as a field shows it: the field it names by its title, not
 * the op path, and "needs a value" for a missing one; the entity's ref only
 * when several are selected.
 */
function refusalText(ctx: Ctx, message: string): string {
  const m = OP_REFUSAL.exec(message);
  if (!m) return message;
  const [, ref, path, detail] = m as unknown as [string, string, string | undefined, string];
  const who = ctx.targets.length > 1 ? `${ref}: ` : "";
  if (path === undefined) return `${who}${detail}`;
  const segs = path.split(".");
  const behavior =
    segs.length === 2 && segs[0] === BEHAVIORS_FIELD
      ? ctx.session.registry.behaviors.get(segs[1]!)
      : undefined;
  const title =
    ctx.fields?.get(path)?.title ?? behavior?.inspector?.label ?? fieldTitle(segs.at(-1) ?? path);
  return /received undefined$/.test(detail)
    ? `${who}${title} needs a value`
    : `${who}${title}: ${detail}`;
}

function dispatch(ctx: Ctx, batch: OpBatch): string | null {
  if (batch.ops.length === 0) return null;
  if (ctx.readOnly) return READ_ONLY;
  const result = ctx.session.dispatch(batch, ctx.edit ? {} : { resolved: true });
  return result.ok ? null : refusalText(ctx, result.issue.message);
}

/** A batch written against the document itself (prefab commands), not the resolved view. */
function dispatchSource(
  session: EditorSession,
  batch: OpBatch | null,
  readOnly: boolean,
): string | null {
  if (!batch) return null;
  if (readOnly) return READ_ONLY;
  const result = session.dispatch(batch);
  return result.ok ? null : result.issue.message;
}

function batchFor(ctx: Ctx, field: ModelField, input: unknown, targets = ctx.targets): Edit {
  return ctx.edit
    ? ctx.edit(field, input)
    : modelBatch(field, input, targets, ctx.def, ctx.session.registry);
}

/** Sets each field to its input on every target, as one batch. */
function commitFields(
  ctx: Ctx,
  label: string,
  edits: readonly (readonly [ModelField, unknown])[],
): string | null {
  if (ctx.editAll) {
    const edit = ctx.editAll(label, edits);
    return edit.ok ? dispatch(ctx, edit.batch) : edit.error;
  }
  const ops: OpBatch["ops"] = [];
  let base: string | undefined;
  for (const [field, input] of edits) {
    const edit = batchFor(ctx, field, input);
    if (!edit.ok) return edit.error;
    ops.push(...edit.batch.ops);
    base ??= edit.batch.base;
  }
  return dispatch(ctx, { label, ...(base ? { base } : {}), ops });
}

/** Sets `field` to `input` on every target, as one batch. */
function commitField(ctx: Ctx, field: ModelField, input: unknown): string | null {
  const edit = batchFor(ctx, field, input);
  return edit.ok ? dispatch(ctx, edit.batch) : edit.error;
}

/** A shared field widget's commit: `commitField` on this field. */
const committer = (ctx: Ctx, field: ModelField) => (input: unknown) =>
  commitField(ctx, field, input);

/**
 * Sets `field` on each target to what `next` makes of that target's own
 * value (one coordinate of a point, one slot of a shape), as one batch.
 */
function commitEach(
  ctx: Ctx,
  field: ModelField,
  next: (current: unknown, target: RefTarget) => unknown,
): string | null {
  const ops: OpBatch["ops"] = [];
  let base: string | undefined;
  for (const t of ctx.targets) {
    const value = next(valueAt(t, field.path), t);
    if (value instanceof EditError) return value.message;
    const edit = batchFor(ctx, field, value, [t]);
    if (!edit.ok) return edit.error;
    ops.push(...edit.batch.ops);
    base ??= edit.batch.base;
  }
  return dispatch(ctx, { label: `Set ${field.title}`, ...(base ? { base } : {}), ops });
}

const ppmOf = (ctx: Ctx) => pxPerMetreOf(ctx.session.registry);

// ─── Building blocks ─────────────────────────────────────

/**
 * The label column's share of the inspector's width and its bounds in px;
 * a longer title widens it up to `fit` of the width so it isn't clipped.
 */
const LABEL_COLUMN = { min: 64, share: 0.3, max: 120, fit: 0.45 } as const;

/** The label column for an inspector `width` px wide whose longest title is `longest` px. */
const labelColumnPx = (width: number, longest: number): number => {
  const base = Math.min(LABEL_COLUMN.max, Math.max(LABEL_COLUMN.min, width * LABEL_COLUMN.share));
  return Math.round(Math.max(base, Math.min(Math.ceil(longest), width * LABEL_COLUMN.fit)));
};

const fieldTitles = (el: HTMLElement) => el.querySelectorAll<HTMLElement>(".je-insp-field-title");

/** A title's text width in px, fractions kept: `scrollWidth` rounds down, which clips the last letter. */
function titleWidth(t: HTMLElement): number {
  const range = t.ownerDocument.createRange();
  range.selectNodeContents(t);
  return Math.max(t.scrollWidth, range.getBoundingClientRect?.().width ?? 0);
}

function fitLabelColumn(el: HTMLElement) {
  let longest = 0;
  for (const t of fieldTitles(el)) longest = Math.max(longest, titleWidth(t));
  el.style.setProperty("--je-label-col", `${labelColumnPx(el.clientWidth, longest)}px`);
}

/**
 * Sets `--je-label-col` on the element from its own width and its titles,
 * so nested fields line up with the top-level ones: again on each resize
 * and once web fonts load, and on a re-render only when the titles shown changed, so a scrub doesn't
 * measure every frame. Without a `ResizeObserver` the stylesheet's token
 * sizes each row.
 */
function useLabelColumn() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const fitted = useRef<{ el: HTMLElement; titles: string } | null>(null);
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => fitLabelColumn(el);
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    // Titles measured in a fallback face are narrower than in the web font that replaces it.
    const fonts = el.ownerDocument.fonts as FontFaceSet | undefined;
    fonts?.addEventListener("loadingdone", fit);
    return () => {
      observer.disconnect();
      fonts?.removeEventListener("loadingdone", fit);
    };
  }, [el]);
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const titles = Array.from(fieldTitles(el), (t) => t.textContent).join("\n");
    if (fitted.current?.el === el && fitted.current.titles === titles) return;
    fitted.current = { el, titles };
    fitLabelColumn(el);
  });
  return setEl;
}

const COLLAPSED_KEY = `${STORAGE_PREFIX}inspector-collapsed`;

/**
 * A titled group of fields that collapses from its title, remembered per
 * `id` in the host's storage. The title is a `<summary>`, so it stays
 * usable inside a read-only inspector's disabled fieldset.
 */
function Section({
  id,
  title,
  hint,
  actions,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  /** Controls beside the title, such as a behavior's Remove. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { storage } = useKit();
  const [open, setOpen] = useBrowserState(
    () => !readStored(storage, COLLAPSED_KEY, {}, storedFlags)[id],
    true,
  );
  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    const closed = { ...readStored(storage, COLLAPSED_KEY, {}, storedFlags) };
    if (open) closed[id] = true;
    else delete closed[id];
    writeStored(storage, COLLAPSED_KEY, closed);
    setOpen(!open);
  };
  return (
    <section aria-label={title} className="je-insp-section" data-open={open ? "" : undefined}>
      <div className="je-insp-section-head">
        <details open={open} className="je-insp-section-title">
          <Hinted hint={hint}>
            <summary className="je-insp-section-toggle" onClick={toggle}>
              <Icon icon={open ? ArrowDown01Icon : ArrowRight01Icon} size={12} />
              <MicroLabel className="je-sp-truncate">{title}</MicroLabel>
            </summary>
          </Hinted>
        </details>
        {actions}
      </div>
      {open ? children : null}
    </section>
  );
}

/** A point list: one x/y row per point, with add and remove. */
function PointsEditor({
  path,
  pts,
  min = 0,
  ppm,
  onCommit,
}: {
  path: string;
  pts: Pt[];
  min?: number;
  /** The game's px per metre: arrows step one world px, a new point lands 32 px on. */
  ppm: number;
  onCommit: (next: Pt[]) => string | null;
}) {
  const { step, bigStep, decimals } = lengthStep("m", ppm);
  const [error, setError] = useState<string | null>(null);
  const set = (next: Pt[]) => {
    const problem = onCommit(next);
    setError(problem);
    return problem;
  };
  return (
    <div className="je-insp-stack" data-gap="tight">
      {pts.map((pt, i) => (
        <div key={i} className="je-insp-row" data-gap="tight" data-align="start">
          <span className="je-insp-point-index">{i + 1}</span>
          {(["x", "y"] as const).map((name, axis) => (
            <NumberInput
              key={name}
              label={`${path}.${i}.${name}`}
              value={pt[axis]}
              mixed={false}
              step={step}
              bigStep={bigStep}
              decimals={decimals}
              suffix={name}
              onCommit={(text) => {
                const n = resolveNumber(text, pt[axis], PT_BOUNDS);
                if (n instanceof EditError) return n.message;
                const next = pts.map((p): Pt => [...p]);
                next[i]![axis] = n;
                return set(next);
              }}
            />
          ))}
          <UnitSuffix unit="m" />
          <IconButton
            icon={Cancel01Icon}
            size="icon-xs"
            label={`Remove point ${i + 1}`}
            tooltip="Remove point"
            disabled={pts.length <= min}
            onClick={() => set(pts.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button
        size="xs"
        variant="ghost"
        className="je-insp-start"
        onClick={() => {
          const last = pts.at(-1) ?? [0, 0];
          set([...pts, [snapToPixel(last[0] + NEW_POINT_PX / ppm, ppm), last[1]]]);
        }}
      >
        Add point
      </Button>
      {error ? <span className="je-insp-error">{error}</span> : null}
    </div>
  );
}

/** World px between the last point and one Add point appends. */
const NEW_POINT_PX = 32;

const asPts = (v: unknown): Pt[] | undefined =>
  Array.isArray(v) && v.every((p) => asPt(p)) ? (v as Pt[]) : undefined;

function PointsField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const pts = asPts(field.value);
  const min = field.widget.kind === "points" ? field.widget.min : undefined;
  return (
    <FieldRow field={field}>
      {field.mixed || !pts ? (
        <span className="je-insp-line je-insp-muted">
          {field.mixed ? `${MIXED} differs across the selection` : "unset"}
        </span>
      ) : (
        <PointsEditor
          path={field.path}
          pts={pts}
          min={min}
          ppm={ppmOf(ctx)}
          onCommit={(next) => commitField(ctx, field, next)}
        />
      )}
    </FieldRow>
  );
}

function TagsField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "tags" }>;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tags = Array.isArray(field.value) ? (field.value as string[]) : [];
  const left = w.options?.filter((o) => !tags.includes(o)) ?? [];
  const listOf = (cur: unknown) => (Array.isArray(cur) ? (cur as string[]) : []);
  const save = (next: (cur: string[]) => string[]) => {
    const problem = commitEach(ctx, field, (cur) => {
      const out = next(listOf(cur));
      return out.length === 0 && field.optional ? undefined : out;
    });
    setError(problem);
    return problem;
  };
  const add = () => {
    const words = draft.split(/[\s,]+/).filter(Boolean);
    if (words.length === 0) return;
    if (!save((cur) => [...new Set([...cur, ...words])])) setDraft("");
  };
  return (
    <FieldRow field={field} error={error}>
      <div className="je-insp-row je-insp-wrap" data-gap="tight">
        {field.mixed ? <span className="je-insp-muted">{MIXED}</span> : null}
        {tags.map((tag) => (
          <Button
            key={tag}
            size="xs"
            variant="secondary"
            aria-label={`Remove tag ${tag}`}
            onClick={() => save((cur) => cur.filter((t) => t !== tag))}
          >
            {tag}
            <Icon icon={Cancel01Icon} size={12} />
          </Button>
        ))}
        {w.options ? (
          left.length > 0 ? (
            <Select
              value=""
              onValueChange={(v) => {
                if (typeof v === "string" && v) save((cur) => [...new Set([...cur, v])]);
              }}
            >
              <SelectTrigger size="sm" aria-label={field.path} className="je-insp-tag-input">
                <SelectValue>{w.placeholder ?? "Add"}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {left.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        ) : (
          <Input
            aria-label={field.path}
            placeholder={w.placeholder ?? "Add a tag"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
            className="je-insp-tag-input"
          />
        )}
      </div>
    </FieldRow>
  );
}

function RefField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "entity-ref" }>;
  const [error, setError] = useState<string | null>(null);
  const anchor = useComboboxAnchor();
  const prefabs = useEditorPrefabs(ctx.session);
  const self = new Set(ctx.targets.map((t) => t.ref));
  const candidates = w.any
    ? refCandidates(ctx.def, ctx.session.registry, ctx.session.registry.typeNames, prefabs).filter(
        (id) => !self.has(id),
      )
    : refCandidates(ctx.def, ctx.session.registry, w.accepts, prefabs);
  const values = field.mixed
    ? []
    : Array.isArray(field.value)
      ? (field.value as string[])
      : typeof field.value === "string"
        ? [field.value]
        : [];
  const dangling = values.filter((v) => !candidates.includes(v));
  const accepts = w.any || w.accepts.length === 0 ? withArticle("entity") : articled(w.accepts);
  const problem =
    error ??
    (dangling.length > 0
      ? `${dangling.join(", ")} ${dangling.length > 1 ? "aren't" : "isn't"} ${accepts} in this scene.`
      : null);
  const set = (next: unknown) => setError(commitField(ctx, field, next));

  return (
    <FieldRow field={field} error={problem}>
      {w.multiple ? (
        <Combobox
          multiple
          items={candidates}
          value={values}
          onValueChange={(next: string[]) =>
            set(next.length === 0 && field.optional ? undefined : next)
          }
        >
          <ComboboxChips ref={anchor} aria-invalid={problem ? true : undefined}>
            {values.map((v) => (
              <ComboboxChip key={v}>{v}</ComboboxChip>
            ))}
            <ComboboxChipsInput
              aria-label={field.path}
              placeholder={field.mixed ? MIXED : `Add ${accepts}`}
            />
          </ComboboxChips>
          <ComboboxContent anchor={anchor}>
            <ComboboxList>
              {(id: string) => (
                <ComboboxItem key={id} value={id}>
                  {id}
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>No {accepts} in this scene</ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
      ) : (
        <Combobox
          items={candidates}
          value={values[0] ?? null}
          onValueChange={(next: string | null) =>
            set(next ?? (field.optional ? undefined : values[0]))
          }
        >
          <ComboboxInput
            aria-label={field.path}
            aria-invalid={problem ? true : undefined}
            placeholder={field.mixed ? MIXED : `Pick ${accepts}`}
            showClear={field.optional}
          />
          <ComboboxContent>
            <ComboboxList>
              {(id: string) => (
                <ComboboxItem key={id} value={id}>
                  {id}
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>No {accepts} in this scene</ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
      )}
    </FieldRow>
  );
}

/** A shape tuple's turn, in degrees; every other slot is a length. */
const isTurnSlot = (name: string) => name === "rotDeg";

const SHAPE_BOUNDS = (slot: { name: string; size: boolean }): Bounds =>
  isTurnSlot(slot.name)
    ? { integer: true }
    : slot.size
      ? { integer: false, length: true, min: 0, exclusiveMin: true }
      : { integer: false, length: true };

const tupleOf = (v: unknown): ShapeTuple | undefined =>
  Array.isArray(v) && typeof v[0] === "string" ? (v as ShapeTuple) : undefined;

const tuplePts = (t: ShapeTuple): Pt[] => {
  const out: Pt[] = [];
  for (let i = 1; i + 1 < t.length; i += 2) out.push([t[i] as number, t[i + 1] as number]);
  return out;
};

/** A tag switcher that converts each target's shape, asking first when that loses something. */
function ShapeField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "shape" }>;
  const [error, setError] = useState<string | null>(null);
  const [lossy, setLossy] = useState<{ to: string; notes: string[]; batch: OpBatch } | null>(null);
  const tuples = ctx.targets.map((t) => tupleOf(valueAt(t, field.path)));
  const first = tuples[0];
  const tag = first && tuples.every((t) => t?.[0] === first[0]) ? first[0] : null;

  const switchTo = (to: string) => {
    if (to === tag) return;
    const ops: OpBatch["ops"] = [];
    const notes = new Set<string>();
    let base: string | undefined;
    for (const [i, t] of ctx.targets.entries()) {
      const tuple = tuples[i];
      if (!tuple || tuple[0] === to) continue;
      const conv = shapeConversions(tuple, w.types, ppmOf(ctx)).find((c) => c.to === to);
      if (!conv) return setError(`A ${tuple[0]} can't become a ${to}.`);
      if (!conv.lossless && conv.note) notes.add(conv.note);
      const edit = batchFor(ctx, field, conv.tuple, [t]);
      if (!edit.ok) return setError(edit.error);
      ops.push(...edit.batch.ops);
      base ??= edit.batch.base;
    }
    const batch = { label: `Convert to ${to}`, ...(base ? { base } : {}), ops };
    if (notes.size > 0) setLossy({ to, notes: [...notes], batch });
    else setError(dispatch(ctx, batch));
  };

  const slots = tag && first ? shapeSlots(first) : null;
  const { step, bigStep, decimals } = lengthStep("m", ppmOf(ctx));
  return (
    <div className="je-insp-stack">
      <FieldRow field={field} error={error}>
        <SegmentedControl
          size="xs"
          aria-label={`${field.path} type`}
          value={tag ?? ""}
          onChange={switchTo}
          className="je-insp-wrap"
        >
          {w.types.map((t) => (
            <SegmentedControl.Item key={t} value={t}>
              {t}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </FieldRow>
      {slots ? (
        <div className="je-insp-slots">
          {slots.map((slot) => {
            const vals = tuples.map((t) => (t?.[slot.index] as number | undefined) ?? 0);
            const mixed = vals.some((v) => v !== vals[0]);
            const turn = isTurnSlot(slot.name);
            return (
              <label key={slot.name} className="je-insp-row" data-gap="tight" data-align="start">
                <span className="je-insp-slot-name">{slot.name}</span>
                <NumberInput
                  label={`${field.path}.${slot.name}`}
                  value={vals[0]}
                  mixed={mixed}
                  step={turn ? 1 : step}
                  bigStep={turn ? 15 : bigStep}
                  decimals={turn ? undefined : decimals}
                  suffix={turn ? "°" : "m"}
                  onCommit={(text) =>
                    commitEach(ctx, field, (cur) => {
                      const tuple = tupleOf(cur);
                      if (!tuple) return new EditError("No shape to edit.");
                      const n = resolveNumber(text, tuple[slot.index] ?? 0, SHAPE_BOUNDS(slot));
                      return typeof n === "number" ? withShapeSlot(tuple, slot.index, n) : n;
                    })
                  }
                />
              </label>
            );
          })}
        </div>
      ) : tag && first && ctx.targets.length === 1 ? (
        <PointsEditor
          path={field.path}
          pts={tuplePts(first)}
          min={tag === "poly" ? 3 : 2}
          ppm={ppmOf(ctx)}
          onCommit={(pts) => commitField(ctx, field, [tag, ...pts.flat()])}
        />
      ) : (
        <p className="je-insp-note">
          {tag ? `${MIXED} each ${tag} differs` : `${MIXED} the shapes differ`}
        </p>
      )}
      <Confirm
        open={lossy !== null}
        onOpenChange={(open) => !open && setLossy(null)}
        title={`Convert to ${lossy?.to ?? ""}?`}
        message={`This loses detail: ${lossy?.notes.join("; ") ?? ""}. Undo brings it back.`}
        confirmText="Convert"
        onConfirm={() => {
          if (lossy) setError(dispatch(ctx, lossy.batch));
          setLossy(null);
        }}
      />
    </div>
  );
}

/**
 * A [low, high] pair: a number field for each end and the unit. Each end is
 * set on every target from that target's own pair (unset reads [0, 0]), in
 * the shown unit the model divides back.
 */
function RangeField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<ModelField["widget"], { kind: "range" }>;
  const scale = w.scale ?? 1;
  const at = asPt(field.value);
  // With no range yet, the end not typed starts at 0, or at the typed value when 0 would invert it.
  const end = (i: 0 | 1) => (text: string) =>
    commitEach(ctx, field, (cur) => {
      const stored = asPt(cur);
      const n = resolveNumber(text, stored ? stored[i] * scale : 0, { integer: false });
      if (n instanceof EditError) return n;
      if (!stored) return i === 0 ? [n, Math.max(n, 0)] : [Math.min(n, 0), n];
      const pair: Pt = [stored[0] * scale, stored[1] * scale];
      pair[i] = n;
      return pair;
    });
  return (
    <FieldRow field={field}>
      <div className="je-insp-row je-insp-wrap je-insp-range" data-gap="tight" data-align="start">
        {(["low", "high"] as const).map((name, i) => (
          <NumberInput
            key={name}
            label={`${field.path}.${name}`}
            value={at?.[i]}
            mixed={field.mixed}
            step={w.step}
            bigStep={w.bigStep}
            decimals={w.decimals}
            suffix={i === 0 ? "min" : "max"}
            onCommit={end(i as 0 | 1)}
          />
        ))}
        {w.unit ? <UnitSuffix unit={w.unit} /> : null}
      </div>
    </FieldRow>
  );
}

/** Path mode, speed, pause and points, or any object's fields, nested under its title. */
function NestedFields({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  return (
    <NestedField field={field}>
      {(field.children ?? []).map((child) => (
        <FieldView key={child.path} field={child} ctx={ctx} />
      ))}
    </NestedField>
  );
}

/**
 * A list of objects: each item's fields under its title with a Remove, then
 * an Add that copies the last item (or the list's seed), within the list's
 * bounds. A field edits its own item; Add and Remove set the whole list.
 */
function ListField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "list" }>;
  const [error, setError] = useState<string | null>(null);
  const items = Array.isArray(field.value) ? (field.value as unknown[]) : [];
  const set = (next: unknown[]) => setError(commitField(ctx, field, next));
  const last = items.at(-1) ?? w.seed;
  const noun = w.item.toLowerCase();
  // A button disabled for a bound stays hoverable, so its hint can say why.
  const atLeast = items.length <= (w.min ?? 0);
  const full = w.max !== undefined && items.length >= w.max;
  if (field.mixed)
    return (
      <FieldRow field={field}>
        <span className="je-insp-line je-insp-muted">{MIXED} differs across the selection</span>
      </FieldRow>
    );
  return (
    <NestedField field={field}>
      {(field.children ?? []).map((item, i) => (
        <div key={item.path} className="je-insp-row" data-gap="tight" data-align="start">
          <div className="je-insp-grow">
            <FieldView field={item} ctx={ctx} />
          </div>
          <IconButton
            icon={Cancel01Icon}
            size="icon-xs"
            label={`Remove ${item.title}`}
            tooltip={atLeast ? `Keeps at least ${w.min}` : `Remove ${noun}`}
            disabled={atLeast}
            focusableWhenDisabled={atLeast}
            onClick={() => set(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      <Button
        size="xs"
        variant="ghost"
        className="je-insp-start"
        disabled={last === undefined || full}
        focusableWhenDisabled={full}
        {...(full ? { tooltip: `Holds at most ${w.max}` } : {})}
        onClick={() => set([...items, structuredClone(last)])}
      >
        Add {noun}
      </Button>
      {error ? <span className="je-insp-error">{error}</span> : null}
    </NestedField>
  );
}

const DELAY_FORMS = ["ms", "ticks"] as const;
type DelayForm = (typeof DELAY_FORMS)[number];

/** A `Delay` value's number and the form it is in; undefined when unset or of neither form. */
function delayParts(value: unknown): { form: DelayForm; n: number } | undefined {
  if (typeof value === "number") return { form: "ticks", n: value };
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { ms?: unknown }).ms === "number"
  )
    return { form: "ms", n: (value as { ms: number }).ms };
  return undefined;
}

/**
 * A `Delay`: one number in the form the value holds (ms when unset) and a
 * ms/ticks switch, which converts a set value at the game's tick rate.
 */
function DelayField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "delay" }>;
  const [unsetForm, setUnsetForm] = useState<DelayForm>("ms");
  const [error, setError] = useState<string | null>(null);
  const held = field.mixed ? undefined : delayParts(field.value);
  const form = held?.form ?? unsetForm;
  const commit = (text: string) => {
    if (text.trim() === "" && field.optional) return commitField(ctx, field, undefined);
    const n = resolveNumber(text, held?.n, { integer: form === "ticks", min: w.min });
    if (n instanceof EditError) return n.message;
    return commitField(ctx, field, form === "ticks" ? n : { ms: n });
  };
  const switchTo = (next: string) => {
    if (next === form || !(DELAY_FORMS as readonly string[]).includes(next)) return;
    if (!held) return setUnsetForm(next as DelayForm);
    const converted =
      next === "ms"
        ? { ms: Math.max(w.min, Math.round((held.n * 1000) / w.rate)) }
        : held.n === 0
          ? 0
          : Math.max(w.min, ticksFor(held.n, w));
    setError(commitField(ctx, field, converted));
  };
  return (
    <FieldRow field={field} error={error}>
      <div className="je-insp-row" data-gap="tight">
        <NumberInput
          label={field.path}
          value={held?.n}
          fallback={field}
          mixed={field.mixed}
          step={1}
          bigStep={10}
          onCommit={commit}
        />
        <SegmentedControl
          size="xs"
          aria-label={`${field.path} unit`}
          value={form}
          onChange={switchTo}
        >
          {DELAY_FORMS.map((f) => (
            <SegmentedControl.Item key={f} value={f}>
              {f}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>
    </FieldRow>
  );
}

/** A colour field: `0xRRGGBB` or `#rrggbb`, as the field's schema takes. */
function ColorField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <FieldRow field={field} error={error}>
      <ColorWidget
        title={field.title}
        path={field.path}
        value={field.value}
        mixed={field.mixed}
        optional={field.optional}
        numeric={field.schema.safeParse(0).success}
        placeholder={field.mixed ? MIXED : field.optional ? unsetText(field) : undefined}
        onCommit={(value) => commitField(ctx, field, value)}
        onProblem={setError}
      />
    </FieldRow>
  );
}

/**
 * An asset field: a combobox of the project's assets of its kinds. Picking
 * an atlas also sets its linked frame field (the current frame when the
 * atlas has it, else its first) and picking a texture unsets it, one batch
 * each; the frame row then lists the atlas's frames. A linked clip field
 * likewise takes the picked source's current clip, else its first, and its
 * row lists the source's clips. Without a project they're all text fields.
 */
function AssetField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "asset" }>;
  const view = useProjectView(ctx.project ?? null);
  const [error, setError] = useState<string | null>(null);
  const frameField = w.frame ? ctx.fields?.get(w.frame) : undefined;
  const clipField = w.clip ? ctx.fields?.get(w.clip) : undefined;
  if (!view) {
    return (
      <>
        <TextField field={field} commit={committer(ctx, field)} />
        {frameField ? <TextField field={frameField} commit={committer(ctx, frameField)} /> : null}
        {clipField ? <TextField field={clipField} commit={committer(ctx, clipField)} /> : null}
      </>
    );
  }
  const options = assetOptions(view, w.kinds);
  const chosen = field.mixed ? undefined : options.find((o) => o.id === field.value);
  const problem = error ?? (field.mixed ? null : danglingAsset(field.value, options, w.kinds));
  const clipsOf = (id: string | undefined) => (id === undefined ? null : (ctx.clips?.(id) ?? null));
  const clips = chosen ? clipsOf(chosen.id) : null;

  const pick = (id: string | undefined) => {
    const edits: [ModelField, unknown][] = [[field, id]];
    if (frameField) {
      const frames = options.find((o) => o.id === id)?.frames;
      edits.push([frameField, frames ? frameFor(frames, frameField.value) : undefined]);
    }
    const next = clipsOf(id);
    const clip = next ? frameFor(next, clipField?.value) : undefined;
    if (clipField && clip !== undefined) edits.push([clipField, clip]);
    setError(commitFields(ctx, `Set ${field.title}`, edits));
  };

  // A texture draws no frame, so its row shows only to clear a stale one.
  const showFrame =
    chosen?.frames !== undefined ||
    frameField?.mixed === true ||
    frameField?.value !== undefined ||
    (chosen === undefined && (field.mixed || field.value !== undefined));
  return (
    <>
      <FieldRow field={field} error={problem}>
        <AssetCombobox
          path={field.path}
          kinds={w.kinds}
          options={options}
          value={field.value}
          mixed={field.mixed}
          optional={field.optional}
          invalid={problem !== null}
          {...(field.mixed ? { placeholder: MIXED } : {})}
          onPick={pick}
        />
      </FieldRow>
      {frameField && showFrame ? (
        chosen?.frames ? (
          <PartRow field={frameField} names={chosen.frames} owner="atlas" part="frame" ctx={ctx} />
        ) : (
          <TextField field={frameField} commit={committer(ctx, frameField)} />
        )
      ) : null}
      {clipField ? (
        chosen && clips ? (
          <PartRow field={clipField} names={clips} owner={chosen.kind} part="clip" ctx={ctx} />
        ) : (
          <TextField field={clipField} commit={committer(ctx, clipField)} />
        )
      ) : null}
    </>
  );
}

/** A frame or clip field picked from the names its asset has, saying so when it names another. */
function PartRow({
  field,
  names,
  owner,
  part,
  ctx,
}: {
  field: ModelField;
  names: readonly string[];
  /** The asset's kind, as the problem names it. */
  owner: string;
  part: "frame" | "clip";
  ctx: Ctx;
}) {
  const [error, setError] = useState<string | null>(null);
  const current = field.mixed ? undefined : field.value;
  const problem =
    error ??
    (names.length === 0
      ? `This ${owner} has no ${part}s.`
      : typeof current === "string" && !names.includes(current)
        ? `This ${owner} has no ${part} ${current}.`
        : null);
  return (
    <FieldRow field={field} error={problem}>
      <FrameSelect
        path={field.path}
        frames={names}
        value={field.value}
        mixed={field.mixed}
        empty={field.mixed ? MIXED : "unset"}
        onPick={(name) => setError(commitField(ctx, field, name))}
      />
    </FieldRow>
  );
}

function SliderField({
  field,
  ctx,
  def,
}: {
  field: ModelField;
  ctx: Ctx;
  def: Extract<InspectorWidgetDef, { kind: "slider" }>;
}) {
  const value = typeof field.value === "number" ? field.value : def.min;
  const [live, setLive] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = live ?? value;
  return (
    <FieldRow field={field} error={error}>
      <div className="je-insp-row je-insp-line">
        <Slider
          aria-label={field.path}
          min={def.min}
          max={def.max}
          step={def.step ?? 1}
          value={[shown]}
          onValueChange={(v) => setLive(Array.isArray(v) ? (v[0] ?? null) : (v as number))}
          onValueCommitted={(v) => {
            const n = Array.isArray(v) ? v[0] : (v as number);
            setLive(null);
            if (typeof n === "number" && n !== field.value) setError(commitField(ctx, field, n));
          }}
          className="je-insp-grow"
        />
        <span className="je-insp-slider-value">
          {field.mixed && live === null ? MIXED : `${shown}${def.unit ?? ""}`}
        </span>
      </div>
    </FieldRow>
  );
}

function CustomField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "custom" }>;
  const def = w.widget;
  switch (def.kind) {
    case "slider":
      return <SliderField field={field} ctx={ctx} def={def} />;
    case "choice":
      return (
        <OptionsField
          field={field}
          commit={committer(ctx, field)}
          unset={unsetText(field)}
          options={def.options}
          segmented={def.options.length <= 4}
        />
      );
    case "color":
      return <ColorField field={field} ctx={ctx} />;
    case "readonly":
      return <ReadonlyField field={field} json={def.format === "json"} ppm={ppmOf(ctx)} />;
  }
}

/**
 * The override keys that set part of `field` on an instance child: its own
 * path, one above it or one under it. A field drawn as its children leaves
 * the marking to them.
 */
function overridesOf(field: ModelField, ctx: Ctx): string[] {
  const o = ctx.overrides;
  if (!o || (field.children?.length ?? 0) > 0) return [];
  const local = o.keys.map((k) => k.slice(o.child.length + 1));
  return overlappingKeys(local, field.path).map((k) => `${o.child}.${k}`);
}

/** The params its instance sets that feed some of `field` on an instance child. */
function paramsOf(field: ModelField, ctx: Ctx): string[] {
  if (!ctx.params || (field.children?.length ?? 0) > 0) return [];
  return ctx.params
    .filter((p) => overlappingKeys(p.paths, field.path).length > 0)
    .map((p) => p.name);
}

/** A muted line under a field a param sets: an override on it beats the param. */
function ParamNote({ names, overridden }: { names: string[]; overridden: boolean }) {
  if (names.length === 0) return null;
  const list = names.join(", ");
  return (
    <Hinted
      hint={
        overridden
          ? "This override beats the instance's param; Revert to use the param again."
          : "Set by the instance's param; editing it here adds an override that beats the param."
      }
    >
      <p className="je-insp-param-note" data-param={list}>
        {overridden ? `overrides param ${list}` : `from param ${list}`}
      </p>
    </Hinted>
  );
}

/**
 * One field, drawn by the widget the model chose for it; bold with a Revert
 * when an override sets it, with a note when a param of its instance does.
 */
function FieldView({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  if (ctx.drawnBy?.has(field.path)) return null;
  const keys = overridesOf(field, ctx);
  const instance = ctx.overrides?.instance;
  const params = paramsOf(field, ctx);
  if (keys.length > 0 && instance !== undefined)
    return (
      <div className="je-insp-overridden" data-overridden="">
        <div className="je-insp-grow">
          <FieldWidgetView field={field} ctx={ctx} />
          <ParamNote names={params} overridden />
        </div>
        <Button
          size="sm"
          variant="ghost"
          tooltip="Revert to the prefab's value"
          onClick={() =>
            dispatchSource(
              ctx.session,
              {
                label: `Revert ${ctx.targets[0]?.ref ?? instance}'s ${field.path}`,
                ops: [{ op: "revertOverride", ref: instance, paths: keys }],
              },
              !!ctx.readOnly,
            )
          }
        >
          Revert
        </Button>
      </div>
    );
  if (params.length === 0) return <FieldWidgetView field={field} ctx={ctx} />;
  return (
    <div className="je-insp-stack" data-gap="tight" data-param-set="">
      <FieldWidgetView field={field} ctx={ctx} />
      <ParamNote names={params} overridden={false} />
    </div>
  );
}

const FORMS = { entity: "Entity", point: "Point" } as const;

/**
 * A field taking a point or an entity: a switch between the two over the
 * editor for the form its value holds. Switching to a point starts it at
 * each target's own position; switching to an entity unsets it.
 */
function EitherField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const [error, setError] = useState<string | null>(null);
  const form = field.widget.kind === "point" ? "point" : "entity";
  const switchTo = (next: string) => {
    if (next === form) return;
    setError(
      next === "point"
        ? commitEach(ctx, field, (_, t) => {
            const at = valueAt(t, "at");
            return Array.isArray(at) ? [...(at as number[])] : [0, 0];
          })
        : commitField(ctx, field, undefined),
    );
  };
  const inner = { ...field, title: FORMS[form] };
  return (
    <div className="je-insp-stack">
      <FieldRow field={field} error={error}>
        <SegmentedControl
          size="xs"
          aria-label={`${field.path} form`}
          value={form}
          onChange={switchTo}
        >
          {(Object.keys(FORMS) as (keyof typeof FORMS)[]).map((f) => (
            <SegmentedControl.Item key={f} value={f}>
              {FORMS[f]}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </FieldRow>
      {form === "point" ? (
        <PointField
          field={inner}
          ppm={ppmOf(ctx)}
          commitEach={(next) => commitEach(ctx, field, next)}
        />
      ) : (
        <RefField field={inner} ctx={ctx} />
      )}
    </div>
  );
}

function FieldWidgetView({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget;
  if (field.readonly && w.kind !== "custom")
    return (
      <ReadonlyField
        field={field}
        json={w.kind === "readonly" && w.format === "json"}
        ppm={ppmOf(ctx)}
      />
    );
  if ((w.kind === "point" || w.kind === "entity-ref") && w.either)
    return <EitherField field={field} ctx={ctx} />;
  switch (w.kind) {
    case "number":
      return <NumberField field={field} commit={committer(ctx, field)} />;
    case "angle":
      return <AngleField field={field} commit={committer(ctx, field)} />;
    case "segmented":
    case "select":
      return (
        <OptionsField
          field={field}
          commit={committer(ctx, field)}
          unset={unsetText(field)}
          options={w.options}
          segmented={w.kind === "segmented"}
        />
      );
    case "switch":
      return (
        <SwitchField
          field={field}
          commit={committer(ctx, field)}
          {...(typeof field.defaultValue === "boolean"
            ? {
                fallback: field.defaultValue,
                unset: `${field.defaultValue ? "on" : "off"} (default)`,
              }
            : {})}
        />
      );
    case "text":
      return <TextField field={field} commit={committer(ctx, field)} />;
    case "point":
      return (
        <PointField
          field={field}
          ppm={ppmOf(ctx)}
          commitEach={(next) => commitEach(ctx, field, next)}
        />
      );
    case "range":
      return <RangeField field={field} ctx={ctx} />;
    case "points":
      return <PointsField field={field} ctx={ctx} />;
    case "tags":
      return <TagsField field={field} ctx={ctx} />;
    case "entity-ref":
      return <RefField field={field} ctx={ctx} />;
    case "shape":
      return <ShapeField field={field} ctx={ctx} />;
    case "path":
    case "object":
      return <NestedFields field={field} ctx={ctx} />;
    case "list":
      return <ListField field={field} ctx={ctx} />;
    case "delay":
      return <DelayField field={field} ctx={ctx} />;
    case "color":
      return <ColorField field={field} ctx={ctx} />;
    case "asset":
      return <AssetField field={field} ctx={ctx} />;
    case "custom":
      return <CustomField field={field} ctx={ctx} />;
    case "readonly":
      return <ReadonlyField field={field} json={w.format === "json"} ppm={ppmOf(ctx)} />;
  }
}

function fieldsByPath(fields: readonly ModelField[], into = new Map<string, ModelField>()) {
  for (const f of fields) {
    into.set(f.path, f);
    if (f.children) fieldsByPath(f.children, into);
  }
  return into;
}

/** The params `child`'s instance sets, each with the paths on the child it feeds. */
function paramsFeeding(
  doc: SceneDefinition,
  child: { instance: string; child: string },
  registry: EditorSession["registry"],
  prefabs: PrefabLibrary,
): { name: string; paths: string[] }[] {
  const model = instanceParamsModel(doc, child.instance, registry, prefabs);
  const prefix = `${child.child}.`;
  return (model?.params ?? []).flatMap((p) => {
    const paths = p.targets.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
    return p.set && paths.length > 0 ? [{ name: p.name, paths }] : [];
  });
}

/** The frame and clip fields an asset picker among `fields` draws itself. */
function framesDrawn(fields: ReadonlyMap<string, ModelField>): Set<string> {
  const out = new Set<string>();
  for (const f of fields.values()) {
    if (f.widget.kind !== "asset") continue;
    for (const part of [f.widget.frame, f.widget.clip])
      if (part !== undefined && fields.has(part)) out.add(part);
  }
  return out;
}

/**
 * The clip names each animation and atlas asset of `project` offers, as the
 * scene validator reads an `anim` block's source: an atlas's tags, or an
 * animation doc's clips (every animation doc held open while mounted, and
 * read again as one changes). Undefined without a project.
 */
function useClips(project: ProjectSession | null): ClipLookup | undefined {
  const view = useProjectView(project);
  const [, bump] = useState(0);
  const key = project && view ? animationDocs(project, view).join("\n") : "";
  useEffect(() => {
    if (!project || key === "") return;
    const changed = () => bump((n) => n + 1);
    const held: SessionDoc[] = [];
    let gone = false;
    for (const name of key.split("\n")) {
      project.open(name).then(
        (doc) => {
          if (gone) return project.release(name);
          held.push(doc);
          doc.doc.on("update", changed);
          changed();
        },
        // An animation whose doc can't open offers no clips.
        () => {},
      );
    }
    return () => {
      gone = true;
      for (const doc of held) {
        doc.doc.off("update", changed);
        project.release(doc.name);
      }
    };
  }, [project, key]);
  if (!project || !view) return undefined;
  return (source) => clipsOf(project, view, source);
}

const animationDocs = (project: ProjectSession, view: ProjectView) =>
  [...view.byId.values()]
    .filter((e) => e.kind === ANIMATION_KIND)
    .flatMap((e) => project.docNameFor(e) ?? [])
    .sort();

function clipsOf(project: ProjectSession, view: ProjectView, source: AssetId) {
  const env = { registry: project.registry, project: view };
  function doc<T = unknown>(kind: AssetKindName, id: AssetId): T | undefined {
    const entry = view.byId.get(id);
    if (entry?.kind !== kind) return undefined;
    const def = project.kinds.get(kind);
    if (!isRuntimeKind(def)) return undefined;
    const name = project.docNameFor(entry);
    const held = name ? project.get(name) : undefined;
    if (!held?.layout) return undefined;
    const read = parseAssetDoc(def, layoutFromDoc(held.doc, held.layout), env);
    return read.ok ? (read.value as T) : undefined;
  }
  return (
    sourceClipsIn({ asset: (id) => assetInfo(view, id) ?? undefined, doc }, source)?.names ?? null
  );
}

/**
 * A behavior's name as the editor shows it: its inspector label as written,
 * else its key in sentence case ("moving-platform" and "movingPlatform" read
 * "Moving platform") to sit beside the built-in sections.
 */
function behaviorTitle(label: string, name: string): string {
  if (label !== name) return label;
  const text = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => (w.length > 1 && /^[A-Z0-9]+$/.test(w) ? w : w.toLowerCase()))
    .join(" ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : name;
}

/** A behavior's section: its description as the title's hint, and Remove unless the type requires it. */
function BehaviorSection({
  section,
  ctx,
  children,
}: {
  section: InspectorSectionModel;
  ctx: Ctx;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const remove = section.behavior?.remove;
  const title = section.behavior
    ? behaviorTitle(section.title, section.behavior.name)
    : section.title;
  return (
    <Section
      id={section.id}
      title={title}
      hint={section.behavior?.description}
      actions={
        remove ? (
          <Button
            size="sm"
            variant="ghost"
            tooltip={`Remove ${title} from the selection`}
            onClick={() => setError(dispatch(ctx, remove))}
          >
            Remove
          </Button>
        ) : null
      }
    >
      {section.fields.length === 0 ? <p className="je-insp-note">No fields to set.</p> : null}
      {error ? <p className="je-insp-error">{error}</p> : null}
      {children}
    </Section>
  );
}

/**
 * Whether a group's sub-heading would only repeat what is already shown:
 * the first group named for its behavior (Spawner's `spawn`), or a group
 * whose one field has the group's title.
 */
function headingRepeats(
  section: InspectorSectionModel,
  group: string,
  fields: readonly ModelField[],
  first: boolean,
): boolean {
  const title = fieldTitle(group).toLowerCase();
  const name = section.behavior?.name.toLowerCase() ?? "";
  if (
    first &&
    (name.startsWith(group.toLowerCase()) || section.title.toLowerCase().startsWith(title))
  )
    return true;
  return fields.length === 1 && fields[0]!.title.toLowerCase() === title;
}

/**
 * A behavior section's fields under their `meta.group` sub-headings, groups
 * in the order their first field comes; one group shows no heading, nor
 * does one whose heading would repeat the section's title or its one field's.
 */
function groupedFields(section: InspectorSectionModel, render: (f: ModelField) => ReactNode) {
  const groups = new Map<string, ModelField[]>();
  for (const f of section.fields) {
    const key = f.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  if (groups.size < 2) return section.fields.map(render);
  return [...groups].map(([group, fields], i) => (
    <div key={group} className="je-insp-group" data-group={group || undefined}>
      {group && !headingRepeats(section, group, fields, i === 0) ? (
        <MicroLabel as="p" className="je-insp-group-title">
          {fieldTitle(group)}
        </MicroLabel>
      ) : null}
      {fields.map(render)}
    </div>
  ));
}

/** `options` under their categories' headings, in category order, then a game's own under Game; empty headings dropped. */
function menuGroups(options: InspectorModel["addBehaviors"]) {
  const groups = BEHAVIOR_CATEGORIES.map((category) => ({
    title: fieldTitle(category),
    items: options.filter((o) => o.category === category),
  }));
  groups.push({ title: "Game", items: options.filter((o) => o.category === undefined) });
  return groups.filter((g) => g.items.length > 0);
}

/** What an Add behavior item says it picks and brings along: "Uses sparks. Also adds Sprite." */
const addNote = (o: InspectorModel["addBehaviors"][number]) =>
  [o.uses && `Uses ${o.uses.join(", ")}.`, o.adds && `Also adds ${o.adds.join(", ")}.`]
    .filter(Boolean)
    .join(" ");

/**
 * The behaviors the selection's types allow and it doesn't all carry yet,
 * under headings; picking one adds it, and what it requires, in one batch.
 * One that can't be added yet is disabled, with its reason in the item.
 */
function AddBehaviorMenu({ options, ctx }: { options: InspectorModel["addBehaviors"]; ctx: Ctx }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="je-insp-stack" data-gap="tight">
      <Menu>
        <MenuTrigger
          render={
            <Button size="sm" variant="outline" tooltip="Give the selection another behavior">
              Add behavior
            </Button>
          }
        />
        <MenuContent align="start" className="je-insp-behavior-menu">
          {menuGroups(options).map((g) => (
            <MenuGroup key={g.title}>
              <MenuLabel>{g.title}</MenuLabel>
              {g.items.map((o) => (
                <MenuItem
                  key={o.name}
                  className="je-insp-behavior-item"
                  data-behavior={o.name}
                  disabled={o.unavailable !== undefined}
                  onClick={() => setError(dispatch(ctx, o.batch))}
                >
                  <span>{behaviorTitle(o.label, o.name)}</span>
                  <Hinted hint={o.description}>
                    <span className="je-insp-muted je-insp-behavior-description">
                      {o.description}
                    </span>
                  </Hinted>
                  {o.unavailable ? (
                    <span className="je-insp-behavior-note" data-tone="warning">
                      {o.unavailable}
                    </span>
                  ) : o.uses || o.adds ? (
                    <span className="je-insp-behavior-note">{addNote(o)}</span>
                  ) : null}
                </MenuItem>
              ))}
            </MenuGroup>
          ))}
        </MenuContent>
      </Menu>
      {error ? <p className="je-insp-error">{error}</p> : null}
    </div>
  );
}

/**
 * The selection's fields, from its types' schemas (`buildInspectorModel`):
 * a widget per field kind, `.describe()` text as tooltips, and drafts that
 * commit on Enter or blur as one batch. With several selected, only the
 * shared fields show; values that differ read "—", and `+=16` edits each
 * one relatively. Each behavior the selection carries has its own section
 * with Remove, and Add behavior offers the rest. An asset picked in the
 * project tree shows instead, with its licence fields.
 */
export function EditorInspector({
  readOnly,
  ...props
}: InspectorProps & {
  /** Every field and action is disabled and no edit lands; default the nearest `InspectorReadOnly`, else false. */
  readOnly?: boolean;
}) {
  const inherited = useContext(ReadOnlyContext);
  if (!(readOnly ?? inherited)) return <Inspector {...props} />;
  return (
    <ReadOnlyContext.Provider value>
      <fieldset disabled className="je-insp-locked" style={LOCKED}>
        <Inspector {...props} />
      </fieldset>
    </ReadOnlyContext.Provider>
  );
}

// The fieldset only disables what is inside it; it draws nothing of its own.
const LOCKED = { display: "contents" } as const;

type InspectorProps = {
  session: EditorSession;
  /** Opens an instance's prefab on its own. */
  onOpenPrefab?: (prefab: string, from: Ref) => void;
  /** `session` edits a prefab in isolation, where no prefab can be made. */
  inPrefab?: boolean;
  /** The asset picked in the project tree. */
  asset?: SelectedAsset;
  /** The open project, whose assets asset fields pick from; without one they're text fields. */
  project?: ProjectSession | null;
};

function Inspector({ session, onOpenPrefab, inPrefab = false, asset, project }: InspectorProps) {
  const readOnly = useContext(ReadOnlyContext);
  const labelColumn = useLabelColumn();
  const clips = useClips(project ?? null);
  const projectView = useProjectView(project ?? null);
  const selection = useEditorStore(session, (s) => s.selection);
  const doc = useEditorDoc(session);
  const view = useEditorResolved(session);
  const prefabs = useEditorPrefabs(session);
  if (asset) return <AssetPanel {...asset} />;

  const targets = selection.flatMap((ref) => {
    const t = lookupRef(view, ref);
    return t ? [t] : [];
  });
  const only = selection.length === 1 ? selection[0] : undefined;
  const instance =
    only !== undefined &&
    (doc.instances?.some((i) => i.id === only) || nestedInstanceOf(doc, only, prefabs) !== null);
  if (only !== undefined && instance) {
    return (
      <InstancePanel
        session={session}
        doc={doc}
        id={only}
        onOpenPrefab={onOpenPrefab}
        project={project ?? null}
      />
    );
  }
  if (targets.length === 0) {
    return (
      <Text as="p" size="xs" variant="muted" className="je-panel-empty">
        Select something in the scene or the outliner.
      </Text>
    );
  }

  const model = buildInspectorModel(session.registry, targets, {
    def: view,
    ...(clips ? { clips } : {}),
    ...(projectView ? { assetKind: (id: AssetId) => projectView.byId.get(id)?.kind } : {}),
  });
  const child = targets.length === 1 ? childOverrides(doc, targets[0]!.ref) : null;
  const childParams = child ? paramsFeeding(doc, child, session.registry, prefabs) : [];
  const byPath = fieldsByPath(model.sections.flatMap((s) => s.fields));
  const ctx: Ctx = {
    session,
    targets,
    def: doc,
    readOnly,
    project: project ?? null,
    fields: byPath,
    drawnBy: framesDrawn(byPath),
    ...(clips ? { clips } : {}),
    ...(child
      ? {
          overrides: {
            instance: child.instance,
            child: child.child,
            keys: [...child.fields.values()].flat(),
          },
        }
      : {}),
    ...(childParams.length > 0 ? { params: childParams } : {}),
  };
  const prefabBatch = child || inPrefab ? null : createPrefabBatch(doc, selection, prefabs);
  const typeDefs = model.types.map((t) => session.registry.types.get(t));
  const typeLabel = model.types.map((t, i) => typeDefs[i]?.inspector?.label ?? t).join(", ");
  const scope = targets.map((t) => t.ref).join(",");

  return (
    <div ref={labelColumn} className="je-inspector" aria-label="Inspector">
      <header className="je-insp-head">
        {targets.length > 1 ? (
          <span className="je-insp-title">{targets.length} selected</span>
        ) : (
          <span className="je-insp-title je-sp-truncate">{targets[0]!.ref}</span>
        )}
        <Hinted hint={targets.length === 1 ? typeDefs[0]?.description : undefined}>
          <span className="je-insp-grow je-sp-truncate je-insp-muted">{typeLabel}</span>
        </Hinted>
        {prefabBatch ? (
          <Button
            size="sm"
            variant="outline"
            className="je-insp-head-action"
            tooltip="Move the selection into a new prefab, with one instance where it stands"
            onClick={() => dispatchSource(session, prefabBatch, readOnly)}
          >
            Create prefab
          </Button>
        ) : null}
      </header>
      {child ? (
        <p className="je-insp-note">In {child.instance}; bold fields override its prefab.</p>
      ) : null}
      {model.sections.length === 0 ? (
        <p className="je-insp-note">
          {targets.length > 1 ? "Nothing in common to edit." : "Nothing to edit."}
        </p>
      ) : null}
      {model.sections.map((section) => {
        const fieldView = (field: ModelField) => (
          <FieldView key={`${scope}:${field.path}`} field={field} ctx={ctx} />
        );
        const fields = section.fields.map(fieldView);
        return section.behavior ? (
          <BehaviorSection key={`${scope}:${section.id}`} section={section} ctx={ctx}>
            {groupedFields(section, fieldView)}
          </BehaviorSection>
        ) : (
          <Section key={section.id} id={section.id} title={section.title}>
            {fields}
          </Section>
        );
      })}
      {model.addBehaviors.length > 0 ? (
        <AddBehaviorMenu key={scope} options={model.addBehaviors} ctx={ctx} />
      ) : null}
    </div>
  );
}

const paramOf = (model: InstanceParamsModel, field: ModelField): ParamModel | undefined =>
  model.params.find(
    (p) => field.path === p.field.path || field.path.startsWith(`${p.field.path}.`),
  );

/** `model` with param `name` holding what `ops` (one param's `paramBatch`) write. */
function afterParamOps(
  model: InstanceParamsModel,
  name: string,
  ops: OpBatch["ops"],
): InstanceParamsModel {
  if (model.target.kind !== "entity") return model;
  const params = { ...(model.target.entity.params as Record<string, unknown> | undefined) };
  let set = true;
  for (const op of ops) {
    const value =
      op.op === "setParam"
        ? op.value
        : op.op === "override"
          ? Object.values(op.set ?? {})[0]
          : undefined;
    if (value === undefined || value === null) {
      delete params[name];
      set = false;
    } else params[name] = value;
  }
  return {
    ...model,
    target: { ...model.target, entity: { ...model.target.entity, params } },
    params: model.params.map((p) => (p.name === name ? { ...p, set } : p)),
  };
}

/**
 * One batch for several edits to an instance's params: each is read against
 * the value the ones before it left, and only a param's last write is kept,
 * so an atlas and its frame inside one param land together.
 */
function paramsBatch(
  model: InstanceParamsModel,
  label: string,
  edits: readonly (readonly [ModelField, unknown])[],
): Edit {
  let current = model;
  const writes = new Map<string, OpBatch["ops"]>();
  for (const [field, input] of edits) {
    const param = paramOf(current, field);
    if (!param) return { ok: false, error: `${field.path} isn't a parameter` };
    const edit = paramBatch(current, param, input, field);
    if (!edit.ok) return edit;
    writes.set(param.name, edit.batch.ops);
    current = afterParamOps(current, param.name, edit.batch.ops);
  }
  return { ok: true, batch: { label, ops: [...writes.values()].flat() } };
}

/**
 * A param's field with each asset picker inside it pointing at its sibling
 * `frame` or `clip` under the param's own path, where the param's widgets
 * edit it.
 */
function paramFrames(field: ModelField): ModelField {
  if (!field.children) return field;
  const children = field.children.map(paramFrames);
  const frame = children.find((c) => c.name === "frame");
  const clip = children.find((c) => c.name === "clip");
  return {
    ...field,
    children: children.map((c) => {
      if (c.widget.kind !== "asset") return c;
      const w = c.widget;
      return {
        ...c,
        widget: {
          ...w,
          ...(frame && w.frame !== undefined ? { frame: frame.path } : {}),
          ...(clip && w.clip !== undefined ? { clip: clip.path } : {}),
        },
      };
    }),
  };
}

/**
 * The prefab's exposed parameters on an instance, each drawn by its first
 * target's widget and set with `setParam` (an override of the nested
 * instance's param when it sits inside another); a set one is bold, with
 * Reset. Asset params pick from `project`'s assets, as a type's own fields do.
 */
function ParamsSection({
  session,
  doc,
  model,
  project,
}: {
  session: EditorSession;
  doc: SceneDefinition;
  model: InstanceParamsModel;
  project: ProjectSession | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const readOnly = useContext(ReadOnlyContext);
  const clips = useClips(project);
  const params = model.params.map((p) => ({ ...p, field: paramFrames(p.field) }));
  const byPath = fieldsByPath(params.map((p) => p.field));
  const ctx: Ctx = {
    session,
    targets: [model.target],
    def: doc,
    readOnly,
    project,
    fields: byPath,
    drawnBy: framesDrawn(byPath),
    ...(clips ? { clips } : {}),
    edit: (field, input) => {
      const param = paramOf(model, field);
      return param
        ? paramBatch(model, param, input, field)
        : { ok: false, error: `${field.path} isn't a parameter` };
    },
    editAll: (label, edits) => paramsBatch(model, label, edits),
  };
  return (
    <Section id="instance:parameters" title="Parameters">
      {params.map((p) => {
        const beaten = paramOverriddenBy(doc, model, p);
        return (
          <Fragment key={`${model.ref}:${p.name}`}>
            {p.set ? (
              <div className="je-insp-overridden" data-overridden="">
                <div className="je-insp-grow">
                  <FieldWidgetView field={p.field} ctx={ctx} />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  tooltip="Reset to the prefab's value"
                  onClick={() => setError(commitField(ctx, p.field, undefined))}
                >
                  Reset
                </Button>
              </div>
            ) : (
              <FieldWidgetView field={p.field} ctx={ctx} />
            )}
            {beaten.length > 0 ? (
              <p className="je-insp-note" data-param-overridden={p.name}>
                Overridden by {beaten.join(", ")}
              </p>
            ) : null}
          </Fragment>
        );
      })}
      {error ? <p className="je-insp-error">{error}</p> : null}
    </Section>
  );
}

const placementText = ({ rot, flip }: InstanceTransformModel) =>
  [rot > 0 ? `Turned ${rot * 90}°` : "Not turned", ...(flip ? ["flipped"] : [])].join(", ");

/**
 * How an instance sits: Turn and Flip, each one batch about its `at`, and
 * its `z`. A nested instance shows its prefab's placement without editing it.
 */
function PlacementSection({
  session,
  doc,
  model,
}: {
  session: EditorSession;
  doc: SceneDefinition;
  model: InstanceTransformModel;
}) {
  const [error, setError] = useState<string | null>(null);
  const readOnly = useContext(ReadOnlyContext);
  const run = (batch: OpBatch | null) => setError(dispatchSource(session, batch, readOnly));
  const controls = [
    {
      label: "Turn counter-clockwise",
      icon: RotateLeft01Icon,
      batch: () => turnBatch(doc, [model.ref], -1),
    },
    {
      label: "Turn clockwise",
      icon: RotateRight01Icon,
      batch: () => turnBatch(doc, [model.ref], 1),
    },
    {
      label: "Flip horizontally",
      icon: FlipHorizontalIcon,
      batch: () => flipBatch(doc, [model.ref], "x"),
    },
    {
      label: "Flip vertically",
      icon: FlipVerticalIcon,
      batch: () => flipBatch(doc, [model.ref], "y"),
    },
  ];
  return (
    <Section id="instance:placement" title="Placement">
      <div className="je-insp-row" data-gap="tight">
        <span className="je-insp-grow je-sp-truncate je-insp-muted">{placementText(model)}</span>
        {model.editable
          ? controls.map((c) => (
              <IconButton
                key={c.label}
                icon={c.icon}
                size="icon-xs"
                label={c.label}
                onClick={() => run(c.batch())}
              />
            ))
          : null}
      </div>
      <FieldRow label="z" hint="Added to the z of every child; higher draws in front.">
        {model.editable ? (
          <NumberInput
            label="z"
            value={model.z}
            mixed={false}
            step={1}
            bigStep={10}
            onCommit={(text) => {
              const edit = instanceZBatch(model, text);
              return edit.ok ? dispatchSource(session, edit.batch, readOnly) : edit.error;
            }}
          />
        ) : (
          <span className="je-insp-line">{model.z}</span>
        )}
      </FieldRow>
      {error ? <p className="je-insp-error">{error}</p> : null}
    </Section>
  );
}

/**
 * An instance, or an instance nested in one (`room-1/door-1`): its prefab,
 * its placement, its exposed parameters, the overrides it carries in the scene, the prefab Apply writes them to,
 * and Apply to prefab, Revert all, Unpack and Open prefab.
 */
function InstancePanel({
  session,
  doc,
  id,
  onOpenPrefab,
  project,
}: {
  session: EditorSession;
  doc: SceneDefinition;
  id: Ref;
  onOpenPrefab?: (prefab: string, from: Ref) => void;
  /** Where asset params find the project's assets; without it they're text fields. */
  project: ProjectSession | null;
}) {
  const readOnly = useContext(ReadOnlyContext);
  const labelColumn = useLabelColumn();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const prefabs = useEditorPrefabs(session);
  const nested = nestedInstanceOf(doc, id, prefabs);
  const inst = nested?.instance ?? instanceOfRef(doc, id)!;
  const keys = overridePathsOf(doc, id);
  const levels = applyLevels(doc, id, prefabs);
  const target = level !== null && levels.includes(level) ? level : (levels[0] ?? inst.prefab);
  const count = instancesOf(doc, target, prefabs);
  const missing = !prefabs.has(inst.prefab);
  const params = instanceParamsModel(doc, id, session.registry, prefabs);
  const placement = instanceTransformModel(doc, id, prefabs);
  return (
    <div ref={labelColumn} className="je-inspector" aria-label="Inspector">
      <header className="je-insp-head">
        <span className="je-insp-title je-sp-truncate">{id}</span>
        <span className="je-sp-truncate je-insp-muted">
          instance of {inst.prefab}
          {missing ? " (missing)" : ""}
          {nested ? ` in ${nested.holder}` : ""}
        </span>
      </header>
      {placement ? (
        <PlacementSection key={id} session={session} doc={doc} model={placement} />
      ) : null}
      {params && params.params.length > 0 ? (
        <ParamsSection key={id} session={session} doc={doc} model={params} project={project} />
      ) : null}
      <Section id="instance:overrides" title="Overrides">
        {keys.length === 0 ? (
          <p className="je-insp-note">Same as the prefab.</p>
        ) : (
          <ul className="je-insp-overrides">
            {keys.map((k) => (
              <li key={k} className="je-sp-truncate">
                {k}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {levels.length > 1 ? (
        <Section id="instance:apply-to" title="Apply to">
          <SegmentedControl
            size="xs"
            aria-label="Apply to"
            value={target}
            onChange={setLevel}
            className="je-insp-wrap"
          >
            {levels.map((p, i) => (
              <SegmentedControl.Item
                key={p}
                value={p}
                tooltip={
                  i === 0
                    ? `Write the overrides into ${p}, the prefab this instance places`
                    : `Write the overrides into ${p}, nested inside ${levels[i - 1]}`
                }
              >
                {p}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
        </Section>
      ) : null}
      <div className="je-insp-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={keys.length === 0}
          tooltip={`Write these overrides into ${target}, for every instance of it`}
          onClick={() => setConfirming(true)}
        >
          Apply to prefab
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={keys.length === 0}
          tooltip="Drop every override"
          onClick={() => setError(dispatchSource(session, revertAllBatch(doc, id), readOnly))}
        >
          Revert all
        </Button>
        {nested ? null : (
          <Button
            size="sm"
            variant="ghost"
            disabled={missing}
            tooltip="Turn the instance into plain entities"
            onClick={() => setError(dispatchSource(session, unpackBatch(doc, id), readOnly))}
          >
            Unpack
          </Button>
        )}
        {onOpenPrefab ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={missing}
            busyScope={openPrefabScope(id)}
            tooltip="Edit the prefab on its own; every instance follows"
            onClick={() => onOpenPrefab(inst.prefab, id)}
          >
            Open prefab
          </Button>
        ) : null}
      </div>
      {error ? <p className="je-insp-error">{error}</p> : null}
      <Confirm
        open={confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
        title={`Apply to ${target}?`}
        message={`This changes the prefab, so ${count === 1 ? "its one instance changes" : `all ${count} of its instances change`} (those that override the same fields keep theirs). Undo brings it back.`}
        confirmText="Apply"
        onConfirm={() => {
          setError(
            dispatchSource(session, applyToPrefabBatch(doc, id, { to: target, prefabs }), readOnly),
          );
          setConfirming(false);
        }}
      />
    </div>
  );
}
