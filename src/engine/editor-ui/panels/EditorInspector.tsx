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
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import type { ProjectSession } from "../../collab/index";
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
  parseRelative,
  refCandidates,
  revertAllBatch,
  revertFieldBatch,
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
import { lengthStep } from "../../editor/inspector-model";
import { pxPerMetreOf } from "../../game/units";
import { fieldKind } from "../../scene/index";
import { LENGTH_UNITS, roundLength, snapToPixel, type LengthUnitName } from "../../scene/units";
import { STORAGE_PREFIX } from "../host";
import { formatQuantity } from "../kit/format";
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
  Hint,
  Icon,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  MicroLabel,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Text,
  useComboboxAnchor,
  useKit,
} from "../kit/index";
import { useBrowserState } from "../kit/ssr";
import { openPrefabScope } from "../session/live-scene-editor";
import { readStored, storedFlags, writeStored } from "../session/stored";
import { useEditorDoc, useEditorStore } from "../session/use-editor-store";
import { useProjectView } from "./EditorProject";
import {
  AssetCombobox,
  assetOptions,
  danglingAsset,
  FrameSelect,
  frameFor,
} from "./inspector/asset-picker";
import { ColorWidget } from "./inspector/color-widget";
import { AssetPanel, type SelectedAsset } from "./project-tree/asset-panel";

/** Why an edit didn't land in a read-only inspector. */
const READ_ONLY = "This scene is read-only.";

const ReadOnlyContext = createContext(false);

/** Makes every inspector below it take no edits, as `EditorInspector`'s `readOnly` does. */
export const InspectorReadOnly = ReadOnlyContext.Provider;

/** What a field shows when the selection disagrees. */
const MIXED = "—";
/** Pointer pixels per step when scrubbing a number label. */
const SCRUB_PX = 4;

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
  /** For one instance child: the fields its instance overrides, with the keys behind each. */
  overrides?: Map<string, string[]>;
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
  /** Fields an asset picker draws as its frame row, so they aren't drawn again. */
  drawnBy?: ReadonlySet<string>;
};

type Edit = { ok: true; batch: OpBatch } | { ok: false; error: string };

/** Why a draft can't become a value. */
class EditError {
  constructor(readonly message: string) {}
}

/** An unset field's placeholder: its default when it has one, else what it falls back to. */
const unsetText = ({
  defaultValue,
  placeholder,
}: Pick<ModelField, "defaultValue" | "placeholder">) =>
  defaultValue === undefined || defaultValue === ""
    ? (placeholder ?? "unset")
    : `${typeof defaultValue === "string" ? defaultValue : JSON.stringify(defaultValue)} (default)`;

function valueAt(target: RefTarget, path: string): unknown {
  if (target.kind === "bulk") return path.includes(".") ? undefined : target.value;
  let cur: unknown = target.entity;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function dispatch(ctx: Ctx, batch: OpBatch): string | null {
  if (batch.ops.length === 0) return null;
  if (ctx.readOnly) return READ_ONLY;
  const result = ctx.session.dispatch(batch, ctx.edit ? {} : { resolved: true });
  return result.ok ? null : result.issue.message;
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
  return ctx.edit ? ctx.edit(field, input) : modelBatch(field, input, targets, ctx.def);
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

/**
 * Sets `field` on each target to what `next` makes of that target's own
 * value (one coordinate of a point, one slot of a shape), as one batch.
 */
function commitEach(
  ctx: Ctx,
  field: ModelField,
  next: (current: unknown) => unknown,
): string | null {
  const ops: OpBatch["ops"] = [];
  let base: string | undefined;
  for (const t of ctx.targets) {
    const value = next(valueAt(t, field.path));
    if (value instanceof EditError) return value.message;
    const edit = batchFor(ctx, field, value, [t]);
    if (!edit.ok) return edit.error;
    ops.push(...edit.batch.ops);
    base ??= edit.batch.base;
  }
  return dispatch(ctx, { label: `Set ${field.title}`, ...(base ? { base } : {}), ops });
}

type Bounds = {
  integer: boolean;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  /** A length in metres: written by the one rounding rule (micrometres). */
  length?: boolean;
};

function numberProblem(b: Bounds, n: number): string | null {
  if (!Number.isFinite(n)) return "Enter a number.";
  if (b.integer && !Number.isInteger(n)) return "Whole numbers only.";
  if (b.min !== undefined && (b.exclusiveMin ? n <= b.min : n < b.min))
    return b.exclusiveMin ? `Must be above ${b.min}.` : `Must be ${b.min} or more.`;
  if (b.max !== undefined && n > b.max) return `Must be ${b.max} or less.`;
  return null;
}

/** A typed number, or a relative edit against `current`, checked against `bounds`. */
function resolveNumber(text: string, current: unknown, b: Bounds): number | EditError {
  const n = parseRelative(text, current);
  if (n === undefined)
    return new EditError(text.trim() === "" ? "Enter a number." : "Enter a number, or +=16.");
  const out = b.integer && /[+\-*/]=/.test(text) ? Math.round(n) : b.length ? roundLength(n) : n;
  const problem = numberProblem(b, out);
  return problem ? new EditError(problem) : out;
}

/**
 * What's wrong with a whole-field number draft before it reaches the
 * targets: not a number, or a plain number out of bounds. Relative edits are
 * checked per target by the model.
 */
function draftProblem(text: string, b: Bounds): string | null {
  if (parseRelative(text, 0) === undefined)
    return text.trim() === "" ? "Enter a number." : "Enter a number, or +=16.";
  const plain = parseRelative(text, undefined);
  return plain === undefined ? null : numberProblem(b, plain);
}

const relative = (delta: number) => (delta >= 0 ? `+=${delta}` : `-=${-delta}`);

/** A metric unit a field declares, or undefined for any other. */
const metricUnit = (unit: unknown): LengthUnitName | undefined =>
  (LENGTH_UNITS as readonly unknown[]).includes(unit) ? (unit as LengthUnitName) : undefined;

const ppmOf = (ctx: Ctx) => pxPerMetreOf(ctx.session.registry);

/** A unit after a pair of number inputs, centred on their line. */
const UnitSuffix = ({ unit }: { unit: string }) => (
  <span className="je-insp-line je-insp-suffix">{unit}</span>
);

/** A number as an input shows it: to `decimals` places when given, trailing zeros dropped. */
const shownNumber = (n: number, decimals: number | undefined) =>
  decimals === undefined ? String(n) : String(Number(n.toFixed(decimals)) + 0);

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

function fitLabelColumn(el: HTMLElement) {
  let longest = 0;
  for (const t of fieldTitles(el)) longest = Math.max(longest, t.scrollWidth);
  el.style.setProperty("--je-label-col", `${labelColumnPx(el.clientWidth, longest)}px`);
}

/**
 * Sets `--je-label-col` on the element from its own width and its titles,
 * so nested fields line up with the top-level ones: again on each resize,
 * and on a re-render only when the titles shown changed, so a scrub doesn't
 * measure every frame. Without a `ResizeObserver` the stylesheet's token
 * sizes each row.
 */
function useLabelColumn() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const fitted = useRef<{ el: HTMLElement; titles: string } | null>(null);
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitLabelColumn(el));
    observer.observe(el);
    return () => observer.disconnect();
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

function Hinted({ hint, children }: { hint?: string; children: ReactElement }) {
  return (
    <Hint content={hint} disabled={!hint}>
      {children}
    </Hint>
  );
}

function FieldRow({
  field,
  label,
  hint,
  children,
  error,
}: {
  field?: ModelField;
  /** A string is drawn as the field's title, hinted; an element stands as it is. */
  label?: ReactNode;
  hint?: string;
  children: ReactNode;
  error?: string | null;
}) {
  const text = label ?? field?.title;
  return (
    <div className="je-insp-field">
      <div className="je-insp-field-label">
        {typeof text === "string" ? (
          <Hinted hint={hint ?? field?.description}>
            <span className="je-insp-field-title">{text}</span>
          </Hinted>
        ) : (
          text
        )}
      </div>
      <div className="je-insp-field-control">
        {children}
        {error ? <span className="je-insp-error">{error}</span> : null}
      </div>
    </div>
  );
}

/** A label that scrubs its number: drag sideways to change it, one batch at release. */
function ScrubLabel({
  field,
  step,
  bigStep,
  onPreview,
  onCommit,
}: {
  field: ModelField;
  step: number;
  bigStep: number;
  onPreview: (delta: number | null) => void;
  onCommit: (text: string) => void;
}) {
  const drag = useRef<{ x: number; delta: number } | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      drag.current = null;
      setActive(false);
      onPreview(null);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [active, onPreview]);

  const end = () => {
    const d = drag.current;
    drag.current = null;
    setActive(false);
    onPreview(null);
    if (d && d.delta !== 0) onCommit(relative(d.delta));
  };

  return (
    <Hinted hint={field.description}>
      <span
        className="je-insp-field-title je-insp-scrub"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, delta: 0 };
          setActive(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.delta = roundLength(
            Math.round((e.clientX - d.x) / SCRUB_PX) * (e.shiftKey ? bigStep : step),
          );
          onPreview(d.delta);
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          drag.current = null;
          setActive(false);
          onPreview(null);
        }}
      >
        {field.title}
      </span>
    </Hinted>
  );
}

/**
 * A number with a local draft: Enter or blur commits, Escape drops it,
 * arrows step (Shift: `bigStep`). `+=16` and friends edit relatively. A
 * draft that doesn't pass shows why and isn't committed.
 */
function NumberInput({
  label,
  value,
  fallback,
  mixed,
  step,
  bigStep,
  preview,
  suffix,
  decimals,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  /** The field whose default an unset value shows in its place. */
  fallback?: Pick<ModelField, "defaultValue" | "placeholder">;
  mixed: boolean;
  step: number;
  bigStep: number;
  preview?: string | null;
  suffix?: string;
  /** Decimals the value shows; all of them when omitted. */
  decimals?: number;
  onCommit: (text: string) => string | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (text: string) => {
    const problem = onCommit(text);
    setError(problem);
    if (!problem) setDraft(null);
  };
  const shown =
    preview ?? draft ?? (mixed || value === undefined ? "" : shownNumber(value, decimals));
  return (
    <div className="je-insp-number">
      <div className="je-insp-row" data-gap="tight">
        <Input
          inputMode="decimal"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          placeholder={mixed ? MIXED : value === undefined ? unsetText(fallback ?? {}) : undefined}
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== null && run(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft !== null) run(draft);
            else if (e.key === "Escape") {
              setDraft(null);
              setError(null);
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const by = e.shiftKey ? bigStep : step;
              run(relative(e.key === "ArrowUp" ? by : -by));
            }
          }}
        />
        {suffix ? <span className="je-insp-suffix">{suffix}</span> : null}
      </div>
      {error ? <span className="je-insp-error">{error}</span> : null}
    </div>
  );
}

/** A text draft committed on Enter or blur; empty unsets an optional field. */
function TextField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = typeof field.value === "string" ? field.value : "";
  const commit = () => {
    if (draft === null) return;
    const input = draft === "" && field.optional ? undefined : draft;
    const problem = commitField(ctx, field, input);
    setError(problem);
    if (!problem) setDraft(null);
  };
  return (
    <FieldRow field={field} error={error}>
      <Input
        aria-label={field.path}
        aria-invalid={error ? true : undefined}
        placeholder={field.mixed ? MIXED : field.optional ? unsetText(field) : undefined}
        maxLength={field.widget.kind === "text" ? field.widget.maxLength : undefined}
        value={draft ?? (field.mixed ? "" : value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
      />
    </FieldRow>
  );
}

// ─── Widgets ─────────────────────────────────────────────

type NumberWidget = Extract<FieldWidget, { kind: "number" }>;

function NumberField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as NumberWidget;
  const [preview, setPreview] = useState<number | null>(null);
  const value = typeof field.value === "number" ? field.value : undefined;
  const commit = (text: string) => {
    if (text.trim() === "" && field.optional) return commitField(ctx, field, undefined);
    const problem = draftProblem(text, w);
    return problem ?? commitField(ctx, field, text);
  };
  const label = w.scrub ? (
    <ScrubLabel
      field={field}
      step={w.step}
      bigStep={w.bigStep}
      onPreview={setPreview}
      onCommit={commit}
    />
  ) : undefined;
  return (
    <FieldRow field={field} label={label}>
      <NumberInput
        label={field.path}
        value={value}
        fallback={field}
        mixed={field.mixed}
        step={w.step}
        bigStep={w.bigStep}
        suffix={w.unit}
        decimals={w.decimals}
        preview={
          preview === null
            ? null
            : value !== undefined
              ? shownNumber(roundLength(value + preview), w.decimals)
              : relative(preview)
        }
        onCommit={commit}
      />
    </FieldRow>
  );
}

/** Degrees: a dial (snapping to `snapDeg`, Shift for free) beside the field. */
function AngleField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "angle" }>;
  const value = typeof field.value === "number" ? field.value : undefined;
  const [preview, setPreview] = useState<number | null>(null);
  const dial = useRef<HTMLSpanElement>(null);
  const bounds = { integer: w.integer };
  const commit = (text: string) => {
    if (text.trim() === "" && field.optional) return commitField(ctx, field, undefined);
    const problem = draftProblem(text, bounds);
    return problem ?? commitField(ctx, field, text);
  };
  const angleAt = (e: PointerEvent) => {
    const r = dial.current!.getBoundingClientRect();
    const deg =
      (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) /
      Math.PI;
    const snap = e.shiftKey ? 1 : w.snapDeg;
    return (((Math.round(deg / snap) * snap) % 360) + 360) % 360;
  };
  const shown = preview ?? value ?? 0;
  return (
    <FieldRow field={field}>
      <div className="je-insp-row">
        <span
          ref={dial}
          role="presentation"
          className="je-insp-dial"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setPreview(angleAt(e));
          }}
          onPointerMove={(e) => preview !== null && setPreview(angleAt(e))}
          onPointerUp={() => {
            if (preview !== null && preview !== value) commitField(ctx, field, preview);
            setPreview(null);
          }}
        >
          <span
            aria-hidden
            className="je-insp-dial-hand"
            style={{
              transform: `rotate(${shown}deg)`,
              opacity: field.mixed && preview === null ? 0.3 : 1,
            }}
          />
        </span>
        <NumberInput
          label={field.path}
          value={value}
          fallback={field}
          mixed={field.mixed}
          step={1}
          bigStep={w.snapDeg}
          suffix="°"
          preview={preview === null ? null : String(preview)}
          onCommit={commit}
        />
      </div>
    </FieldRow>
  );
}

/** The segment that clears an optional side field: no one side, so any side. */
const ANY_SIDE = "\u0000any";

function OptionsField({
  field,
  ctx,
  options,
  segmented,
}: {
  field: ModelField;
  ctx: Ctx;
  options: readonly { value: string | number; label: string; description?: string }[];
  segmented: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  // An optional side's unset state is a choice of its own, so it gets a segment.
  const anySide = segmented && field.optional && fieldKind(field.schema) === "side";
  const set = typeof field.value === "string" || typeof field.value === "number";
  const current = field.mixed ? "" : set ? String(field.value) : anySide ? ANY_SIDE : "";
  const pick = (key: string) => {
    const option = options.find((o) => String(o.value) === key);
    if (key === ANY_SIDE) setError(commitField(ctx, field, undefined));
    else if (key === current && field.optional) setError(commitField(ctx, field, undefined));
    else if (option) setError(commitField(ctx, field, option.value));
    else if (key === "" && field.optional) setError(commitField(ctx, field, undefined));
  };
  if (segmented) {
    return (
      <FieldRow field={field} error={error}>
        <div className="je-insp-row" data-gap="tight">
          <SegmentedControl
            size="xs"
            aria-label={field.path}
            value={current}
            emitOnReselect={field.optional && !anySide}
            onChange={pick}
            className="je-insp-wrap"
          >
            {anySide ? (
              <SegmentedControl.Item value={ANY_SIDE} tooltip="Unset: not limited to one side">
                any
              </SegmentedControl.Item>
            ) : null}
            {options.map((o) => (
              <SegmentedControl.Item
                key={String(o.value)}
                value={String(o.value)}
                tooltip={o.description}
              >
                {o.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
          {field.mixed ? <span className="je-insp-muted">{MIXED}</span> : null}
        </div>
      </FieldRow>
    );
  }
  const label = options.find((o) => String(o.value) === current)?.label;
  return (
    <FieldRow field={field} error={error}>
      <Select value={current} onValueChange={(v) => pick(typeof v === "string" ? v : "")}>
        <SelectTrigger size="sm" aria-label={field.path}>
          <SelectValue>{label ?? (field.mixed ? MIXED : "unset")}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {field.optional ? <SelectItem value="">unset</SelectItem> : null}
          {options.map((o) => (
            <SelectItem key={String(o.value)} value={String(o.value)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}

function SwitchField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <FieldRow field={field} error={error}>
      <div className="je-insp-row je-insp-line">
        <Switch
          aria-label={field.path}
          checked={field.value === true}
          onCheckedChange={(on) =>
            setError(commitField(ctx, field, on ? true : field.optional ? undefined : false))
          }
        />
        {field.mixed ? <span className="je-insp-muted">{MIXED}</span> : null}
      </div>
    </FieldRow>
  );
}

const asPt = (v: unknown): Pt | undefined =>
  Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number"
    ? [v[0], v[1]]
    : undefined;

const PT_BOUNDS: Bounds = { integer: false, length: true };

function PointField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "point" }>;
  const unit = metricUnit(w.unit) ?? "m";
  const fallback = lengthStep(unit, ppmOf(ctx));
  const step = w.step ?? fallback.step;
  const bigStep = w.bigStep ?? fallback.bigStep;
  const decimals = w.decimals ?? fallback.decimals;
  const at = asPt(field.value);
  const axis = (i: 0 | 1) => (text: string) =>
    commitEach(ctx, field, (cur) => {
      const pt = asPt(cur) ?? [0, 0];
      const n = resolveNumber(text, pt[i], PT_BOUNDS);
      if (n instanceof EditError) return n;
      const next: Pt = [...pt];
      next[i] = n;
      return next;
    });
  return (
    <FieldRow field={field}>
      <div className="je-insp-row" data-gap="tight" data-align="start">
        {(["x", "y"] as const).map((name, i) => (
          <NumberInput
            key={name}
            label={`${field.path}.${name}`}
            value={at?.[i]}
            mixed={field.mixed}
            step={step}
            bigStep={bigStep}
            decimals={decimals}
            suffix={name}
            onCommit={axis(i as 0 | 1)}
          />
        ))}
        <UnitSuffix unit={unit} />
      </div>
    </FieldRow>
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
          <span className="je-insp-point-index">{i}</span>
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
            label={`Remove point ${i}`}
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
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const tags = Array.isArray(field.value) ? (field.value as string[]) : [];
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
        <Input
          aria-label={field.path}
          placeholder="Add a tag"
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
      </div>
    </FieldRow>
  );
}

function RefField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "entity-ref" }>;
  const [error, setError] = useState<string | null>(null);
  const anchor = useComboboxAnchor();
  const candidates = refCandidates(
    ctx.def,
    ctx.session.registry,
    w.accepts,
    ctx.session.getPrefabs(),
  );
  const values = field.mixed
    ? []
    : Array.isArray(field.value)
      ? (field.value as string[])
      : typeof field.value === "string"
        ? [field.value]
        : [];
  const dangling = values.filter((v) => !candidates.includes(v));
  const accepts = w.accepts.join(" or ");
  const problem =
    error ??
    (dangling.length > 0
      ? `${dangling.join(", ")} ${dangling.length > 1 ? "aren't" : "isn't"} a ${accepts} in this scene.`
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
              placeholder={field.mixed ? MIXED : `Add a ${accepts}`}
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
            placeholder={field.mixed ? MIXED : `Pick a ${accepts}`}
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

/** Path mode, speed, pause and points, or any object's fields, nested under its title. */
function NestedFields({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  return (
    <div className="je-insp-stack">
      <Hinted hint={field.description}>
        <span className="je-insp-nested-title">{field.title}</span>
      </Hinted>
      <div className="je-insp-stack je-insp-nested">
        {(field.children ?? []).map((child) => (
          <FieldView key={child.path} field={child} ctx={ctx} />
        ))}
      </div>
    </div>
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
 * each; the frame row then lists the atlas's frames. Without a project
 * both are text fields.
 */
function AssetField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const w = field.widget as Extract<FieldWidget, { kind: "asset" }>;
  const view = useProjectView(ctx.project ?? null);
  const [error, setError] = useState<string | null>(null);
  const frameField = w.frame ? ctx.fields?.get(w.frame) : undefined;
  if (!view) {
    return (
      <>
        <TextField field={field} ctx={ctx} />
        {frameField ? <TextField field={frameField} ctx={ctx} /> : null}
      </>
    );
  }
  const options = assetOptions(view, w.kinds);
  const chosen = field.mixed ? undefined : options.find((o) => o.id === field.value);
  const problem = error ?? (field.mixed ? null : danglingAsset(field.value, options, w.kinds));

  const pick = (id: string | undefined) => {
    const edits: [ModelField, unknown][] = [[field, id]];
    if (frameField) {
      const frames = options.find((o) => o.id === id)?.frames;
      edits.push([frameField, frames ? frameFor(frames, frameField.value) : undefined]);
    }
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
          <FrameRow field={frameField} frames={chosen.frames} ctx={ctx} />
        ) : (
          <TextField field={frameField} ctx={ctx} />
        )
      ) : null}
    </>
  );
}

function FrameRow({
  field,
  frames,
  ctx,
}: {
  field: ModelField;
  frames: readonly string[];
  ctx: Ctx;
}) {
  const [error, setError] = useState<string | null>(null);
  const current = field.mixed ? undefined : field.value;
  const problem =
    error ??
    (typeof current === "string" && !frames.includes(current)
      ? `This atlas has no frame ${current}.`
      : null);
  return (
    <FieldRow field={field} error={problem}>
      <FrameSelect
        path={field.path}
        frames={frames}
        value={field.value}
        mixed={field.mixed}
        empty={field.mixed ? MIXED : "unset"}
        onPick={(frame) => setError(commitField(ctx, field, frame))}
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

function ReadonlyField({ field, json, ppm }: { field: ModelField; json: boolean; ppm: number }) {
  const unit = "unit" in field.widget ? metricUnit(field.widget.unit) : undefined;
  const text = field.mixed
    ? MIXED
    : field.value === undefined
      ? "unset"
      : unit && typeof field.value === "number"
        ? formatQuantity(field.value, unit, ppm)
        : json || typeof field.value !== "string"
          ? JSON.stringify(field.value)
          : field.value;
  return (
    <FieldRow field={field}>
      <span className="je-insp-line je-sp-truncate">{text}</span>
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
          ctx={ctx}
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

/** One field, drawn by the widget the model chose for it. */
function FieldView({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  if (ctx.drawnBy?.has(field.path)) return null;
  const top = field.path.split(".")[0]!;
  if (ctx.overrides?.has(top) && !field.path.includes("."))
    return (
      <div className="je-insp-overridden" data-overridden="">
        <div className="je-insp-grow">
          <FieldWidgetView field={field} ctx={ctx} />
        </div>
        <Button
          size="sm"
          variant="ghost"
          tooltip="Revert to the prefab's value"
          onClick={() => {
            const ref = ctx.targets[0]?.ref;
            if (ref)
              dispatchSource(ctx.session, revertFieldBatch(ctx.def, ref, top), !!ctx.readOnly);
          }}
        >
          Revert
        </Button>
      </div>
    );
  return <FieldWidgetView field={field} ctx={ctx} />;
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
  switch (w.kind) {
    case "number":
      return <NumberField field={field} ctx={ctx} />;
    case "angle":
      return <AngleField field={field} ctx={ctx} />;
    case "segmented":
    case "select":
      return (
        <OptionsField
          field={field}
          ctx={ctx}
          options={w.options}
          segmented={w.kind === "segmented"}
        />
      );
    case "switch":
      return <SwitchField field={field} ctx={ctx} />;
    case "text":
      return <TextField field={field} ctx={ctx} />;
    case "point":
      return <PointField field={field} ctx={ctx} />;
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

/** The frame fields an asset picker among `fields` draws itself. */
function framesDrawn(fields: ReadonlyMap<string, ModelField>): Set<string> {
  const out = new Set<string>();
  for (const f of fields.values())
    if (f.widget.kind === "asset" && f.widget.frame && fields.has(f.widget.frame))
      out.add(f.widget.frame);
  return out;
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

/** The behaviors the selection's types allow and it doesn't all carry yet; picking one adds it in one batch. */
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
          {options.map((o) => (
            <MenuItem
              key={o.name}
              className="je-insp-behavior-item"
              onClick={() => setError(dispatch(ctx, o.batch))}
            >
              <span>{behaviorTitle(o.label, o.name)}</span>
              <span className="je-insp-muted">{o.description}</span>
            </MenuItem>
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
  const selection = useEditorStore(session, (s) => s.selection);
  const doc = useEditorDoc(session);
  const view = session.getResolved();
  if (asset) return <AssetPanel {...asset} />;

  const targets = selection.flatMap((ref) => {
    const t = lookupRef(view, ref);
    return t ? [t] : [];
  });
  const only = selection.length === 1 ? selection[0] : undefined;
  const instance =
    only !== undefined &&
    (doc.instances?.some((i) => i.id === only) ||
      nestedInstanceOf(doc, only, session.getPrefabs()) !== null);
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

  const model = buildInspectorModel(session.registry, targets);
  const child = targets.length === 1 ? childOverrides(doc, targets[0]!.ref) : null;
  const byPath = fieldsByPath(model.sections.flatMap((s) => s.fields));
  const ctx: Ctx = {
    session,
    targets,
    def: doc,
    readOnly,
    project: project ?? null,
    fields: byPath,
    drawnBy: framesDrawn(byPath),
    ...(child ? { overrides: child.fields } : {}),
  };
  const prefabBatch =
    child || inPrefab ? null : createPrefabBatch(doc, selection, session.getPrefabs());
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
        const fields = section.fields.map((field) => (
          <FieldView key={`${scope}:${field.path}`} field={field} ctx={ctx} />
        ));
        return section.behavior ? (
          <BehaviorSection key={`${scope}:${section.id}`} section={section} ctx={ctx}>
            {fields}
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
 * A param's field with each atlas picker inside it pointing at its sibling
 * `frame` under the param's own path, where the param's widgets edit it.
 */
function paramFrames(field: ModelField): ModelField {
  if (!field.children) return field;
  const children = field.children.map(paramFrames);
  const frame = children.find((c) => c.name === "frame");
  return {
    ...field,
    children: children.map((c) =>
      frame && c.widget.kind === "asset" && c.widget.frame !== undefined
        ? { ...c, widget: { ...c.widget, frame: frame.path } }
        : c,
    ),
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
      {params.map((p) =>
        p.set ? (
          <div key={`${model.ref}:${p.name}`} className="je-insp-overridden" data-overridden="">
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
          <FieldWidgetView key={`${model.ref}:${p.name}`} field={p.field} ctx={ctx} />
        ),
      )}
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
  const prefabs = session.getPrefabs();
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
