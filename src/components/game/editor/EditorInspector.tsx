import {
  Cancel01Icon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  RotateLeft01Icon,
  RotateRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
  type ModelField,
  type OpBatch,
  type Pt,
  type Ref,
  type RefTarget,
  type SceneDefinition,
  type ShapeTuple,
} from "@jams/engine/editor";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { Confirm } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { MicroLabel } from "@/components/ui/typography";

import { AssetPanel, type SelectedAsset } from "./project-tree/asset-panel";
import { useEditorDoc, useEditorStore } from "./use-editor-store";

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
};

type Edit = { ok: true; batch: OpBatch } | { ok: false; error: string };

/** Why a draft can't become a value. */
class EditError {
  constructor(readonly message: string) {}
}

/** An unset field's placeholder: its default when it has one. */
const unsetText = (fallback: unknown) =>
  fallback === undefined || fallback === ""
    ? "unset"
    : `${typeof fallback === "string" ? fallback : JSON.stringify(fallback)} (default)`;

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
  const result = ctx.session.dispatch(batch, ctx.edit ? {} : { resolved: true });
  return result.ok ? null : result.issue.message;
}

/** A batch written against the document itself (prefab commands), not the resolved view. */
function dispatchSource(session: EditorSession, batch: OpBatch | null): string | null {
  if (!batch) return null;
  const result = session.dispatch(batch);
  return result.ok ? null : result.issue.message;
}

function batchFor(ctx: Ctx, field: ModelField, input: unknown, targets = ctx.targets): Edit {
  return ctx.edit ? ctx.edit(field, input) : modelBatch(field, input, targets, ctx.def);
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

type Bounds = { integer: boolean; min?: number; max?: number; exclusiveMin?: boolean };

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
  const out = b.integer && /[+\-*/]=/.test(text) ? Math.round(n) : n;
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
const tidy = (n: number) => Number(n.toFixed(6));

// ─── Building blocks ─────────────────────────────────────

function Hinted({ hint, children }: { hint?: string; children: ReactElement }) {
  return (
    <SimpleTooltip content={hint} disabled={!hint}>
      {children}
    </SimpleTooltip>
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
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-x-2 text-xs">
      <div className="flex min-h-7 items-center">
        {typeof text === "string" ? (
          <Hinted hint={hint ?? field?.description}>
            <span className="truncate text-muted-foreground">{text}</span>
          </Hinted>
        ) : (
          text
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {children}
        {error ? <span className="text-destructive">{error}</span> : null}
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
        className="cursor-ew-resize truncate text-muted-foreground select-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, delta: 0 };
          setActive(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.delta = tidy(Math.round((e.clientX - d.x) / SCRUB_PX) * (e.shiftKey ? bigStep : step));
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
  onCommit,
}: {
  label: string;
  value: number | undefined;
  /** What an unset value takes, shown in its place. */
  fallback?: unknown;
  mixed: boolean;
  step: number;
  bigStep: number;
  preview?: string | null;
  suffix?: string;
  onCommit: (text: string) => string | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (text: string) => {
    const problem = onCommit(text);
    setError(problem);
    if (!problem) setDraft(null);
  };
  const shown = preview ?? draft ?? (mixed || value === undefined ? "" : String(value));
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <Input
          inputMode="decimal"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          placeholder={mixed ? MIXED : value === undefined ? unsetText(fallback) : undefined}
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
          className="h-7"
        />
        {suffix ? <span className="shrink-0 text-muted-foreground">{suffix}</span> : null}
      </div>
      {error ? <span className="text-destructive">{error}</span> : null}
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
        placeholder={
          field.mixed ? MIXED : field.optional ? unsetText(field.defaultValue) : undefined
        }
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
        className="h-7"
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
        fallback={field.defaultValue}
        mixed={field.mixed}
        step={w.step}
        bigStep={w.bigStep}
        suffix={w.unit}
        preview={
          preview === null
            ? null
            : value !== undefined
              ? String(tidy(value + preview))
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
      <div className="flex items-center gap-2">
        <span
          ref={dial}
          role="presentation"
          className="relative size-6 shrink-0 cursor-crosshair rounded-full border border-input"
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
            className="absolute top-1/2 left-1/2 h-px w-1/2 origin-left bg-foreground"
            style={{
              transform: `rotate(${shown}deg)`,
              opacity: field.mixed && preview === null ? 0.3 : 1,
            }}
          />
        </span>
        <NumberInput
          label={field.path}
          value={value}
          fallback={field.defaultValue}
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
  const current =
    !field.mixed && (typeof field.value === "string" || typeof field.value === "number")
      ? String(field.value)
      : "";
  const pick = (key: string) => {
    const option = options.find((o) => String(o.value) === key);
    if (key === current && field.optional) setError(commitField(ctx, field, undefined));
    else if (option) setError(commitField(ctx, field, option.value));
    else if (key === "" && field.optional) setError(commitField(ctx, field, undefined));
  };
  if (segmented) {
    return (
      <FieldRow field={field} error={error}>
        <div className="flex items-center gap-1">
          <SegmentedControl
            size="xs"
            aria-label={field.path}
            value={current}
            emitOnReselect={field.optional}
            onChange={pick}
            className="flex-wrap"
          >
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
          {field.mixed ? <span className="text-muted-foreground">{MIXED}</span> : null}
        </div>
      </FieldRow>
    );
  }
  const label = options.find((o) => String(o.value) === current)?.label;
  return (
    <FieldRow field={field} error={error}>
      <Select value={current} onValueChange={(v) => pick(typeof v === "string" ? v : "")}>
        <SelectTrigger size="sm" aria-label={field.path} className="w-full">
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
      <div className="flex min-h-7 items-center gap-2">
        <Switch
          aria-label={field.path}
          checked={field.value === true}
          onCheckedChange={(on) =>
            setError(commitField(ctx, field, on ? true : field.optional ? undefined : false))
          }
        />
        {field.mixed ? <span className="text-muted-foreground">{MIXED}</span> : null}
      </div>
    </FieldRow>
  );
}

const asPt = (v: unknown): Pt | undefined =>
  Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number"
    ? [v[0], v[1]]
    : undefined;

const PT_BOUNDS: Bounds = { integer: true };

function PointField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
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
      <div className="flex gap-1">
        {(["x", "y"] as const).map((name, i) => (
          <NumberInput
            key={name}
            label={`${field.path}.${name}`}
            value={at?.[i]}
            mixed={field.mixed}
            step={1}
            bigStep={10}
            suffix={name}
            onCommit={axis(i as 0 | 1)}
          />
        ))}
      </div>
    </FieldRow>
  );
}

/** A point list: one x/y row per point, with add and remove. */
function PointsEditor({
  path,
  pts,
  min = 0,
  onCommit,
}: {
  path: string;
  pts: Pt[];
  min?: number;
  onCommit: (next: Pt[]) => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const set = (next: Pt[]) => {
    const problem = onCommit(next);
    setError(problem);
    return problem;
  };
  return (
    <div className="flex flex-col gap-1">
      {pts.map((pt, i) => (
        <div key={i} className="flex items-start gap-1">
          <span className="mt-1.5 w-4 shrink-0 text-right text-muted-foreground tabular-nums">
            {i}
          </span>
          {(["x", "y"] as const).map((name, axis) => (
            <NumberInput
              key={name}
              label={`${path}.${i}.${name}`}
              value={pt[axis]}
              mixed={false}
              step={1}
              bigStep={10}
              onCommit={(text) => {
                const n = resolveNumber(text, pt[axis], PT_BOUNDS);
                if (n instanceof EditError) return n.message;
                const next = pts.map((p): Pt => [...p]);
                next[i]![axis] = n;
                return set(next);
              }}
            />
          ))}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove point ${i}`}
            tooltip="Remove point"
            disabled={pts.length <= min}
            onClick={() => set(pts.filter((_, j) => j !== i))}
          >
            <HugeiconsIcon icon={Cancel01Icon} />
          </Button>
        </div>
      ))}
      <Button
        size="xs"
        variant="ghost"
        className="self-start"
        onClick={() => {
          const last = pts.at(-1) ?? [0, 0];
          set([...pts, [last[0] + 32, last[1]]]);
        }}
      >
        Add point
      </Button>
      {error ? <span className="text-destructive">{error}</span> : null}
    </div>
  );
}

const asPts = (v: unknown): Pt[] | undefined =>
  Array.isArray(v) && v.every((p) => asPt(p)) ? (v as Pt[]) : undefined;

function PointsField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const pts = asPts(field.value);
  const min = field.widget.kind === "points" ? field.widget.min : undefined;
  return (
    <FieldRow field={field}>
      {field.mixed || !pts ? (
        <span className="min-h-7 content-center text-muted-foreground">
          {field.mixed ? `${MIXED} differs across the selection` : "unset"}
        </span>
      ) : (
        <PointsEditor
          path={field.path}
          pts={pts}
          min={min}
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
      <div className="flex flex-wrap items-center gap-1">
        {field.mixed ? <span className="text-muted-foreground">{MIXED}</span> : null}
        {tags.map((tag) => (
          <Button
            key={tag}
            size="xs"
            variant="secondary"
            aria-label={`Remove tag ${tag}`}
            onClick={() => save((cur) => cur.filter((t) => t !== tag))}
          >
            {tag}
            <HugeiconsIcon icon={Cancel01Icon} />
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
          className="h-7 min-w-20 flex-1"
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
            className="h-7 w-full"
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

const SHAPE_BOUNDS = (size: boolean): Bounds =>
  size ? { integer: true, min: 0, exclusiveMin: true } : { integer: true };

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
      const conv = shapeConversions(tuple, w.types).find((c) => c.to === to);
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
  return (
    <div className="flex flex-col gap-1.5">
      <FieldRow field={field} error={error}>
        <SegmentedControl
          size="xs"
          aria-label={`${field.path} type`}
          value={tag ?? ""}
          onChange={switchTo}
          className="flex-wrap"
        >
          {w.types.map((t) => (
            <SegmentedControl.Item key={t} value={t}>
              {t}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </FieldRow>
      {slots ? (
        <div className="grid grid-cols-2 gap-1">
          {slots.map((slot) => {
            const vals = tuples.map((t) => (t?.[slot.index] as number | undefined) ?? 0);
            const mixed = vals.some((v) => v !== vals[0]);
            return (
              <label key={slot.name} className="flex items-start gap-1 text-xs">
                <span className="mt-1.5 w-10 shrink-0 truncate text-muted-foreground">
                  {slot.name}
                </span>
                <NumberInput
                  label={`${field.path}.${slot.name}`}
                  value={vals[0]}
                  mixed={mixed}
                  step={1}
                  bigStep={10}
                  onCommit={(text) =>
                    commitEach(ctx, field, (cur) => {
                      const tuple = tupleOf(cur);
                      if (!tuple) return new EditError("No shape to edit.");
                      const n = resolveNumber(
                        text,
                        tuple[slot.index] ?? 0,
                        SHAPE_BOUNDS(slot.size),
                      );
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
          onCommit={(pts) => commitField(ctx, field, [tag, ...pts.flat()])}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
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
    <div className="flex flex-col gap-1.5">
      <Hinted hint={field.description}>
        <span className="text-xs font-medium">{field.title}</span>
      </Hinted>
      <div className="flex flex-col gap-1.5 border-l border-border pl-2">
        {(field.children ?? []).map((child) => (
          <FieldView key={child.path} field={child} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

const colorText = (v: unknown) =>
  typeof v === "number" ? `#${v.toString(16).padStart(6, "0")}` : typeof v === "string" ? v : "";

function ColorField({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const numeric = field.schema.safeParse(0).success;
  const shown = field.mixed ? "" : colorText(field.value);
  const commit = (text: string) => {
    const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(text.trim())?.[1];
    if (!hex) return setError("Enter a colour like #ff8800.");
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const problem = commitField(
      ctx,
      field,
      numeric ? parseInt(full, 16) : `#${full.toLowerCase()}`,
    );
    setError(problem);
    if (!problem) setDraft(null);
  };
  return (
    <FieldRow field={field} error={error}>
      <div className="flex items-center gap-1">
        <Popover>
          <PopoverTrigger
            aria-label={`Pick ${field.title}`}
            className="size-7 shrink-0 rounded-md border border-input"
            style={{ background: shown || "transparent" }}
          />
          <PopoverContent>
            <ColorPicker
              label={field.title}
              gamut="srgb"
              value={shown || "#000000"}
              onChange={setDraft}
              onCommit={() => draft && commit(draft)}
            />
          </PopoverContent>
        </Popover>
        <Input
          aria-label={field.path}
          placeholder={field.mixed ? MIXED : undefined}
          value={draft ?? shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== null && commit(draft)}
          onKeyDown={(e) => e.key === "Enter" && draft !== null && commit(draft)}
          className="h-7"
        />
      </div>
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
      <div className="flex min-h-7 items-center gap-2">
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
          className="flex-1"
        />
        <span className="w-12 shrink-0 text-right text-muted-foreground tabular-nums">
          {field.mixed && live === null ? MIXED : `${shown}${def.unit ?? ""}`}
        </span>
      </div>
    </FieldRow>
  );
}

function ReadonlyField({ field, json }: { field: ModelField; json: boolean }) {
  const text = field.mixed
    ? MIXED
    : field.value === undefined
      ? "unset"
      : json || typeof field.value !== "string"
        ? JSON.stringify(field.value)
        : field.value;
  return (
    <FieldRow field={field}>
      <span className="min-h-7 content-center truncate">{text}</span>
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
      return <ReadonlyField field={field} json={def.format === "json"} />;
  }
}

/** One field, drawn by the widget the model chose for it. */
function FieldView({ field, ctx }: { field: ModelField; ctx: Ctx }) {
  const top = field.path.split(".")[0]!;
  if (ctx.overrides?.has(top) && !field.path.includes("."))
    return (
      <div className="flex items-start gap-1 font-semibold" data-overridden="">
        <div className="min-w-0 flex-1">
          <FieldWidgetView field={field} ctx={ctx} />
        </div>
        <Button
          size="sm"
          variant="ghost"
          tooltip="Revert to the prefab's value"
          onClick={() => {
            const ref = ctx.targets[0]?.ref;
            if (ref) dispatchSource(ctx.session, revertFieldBatch(ctx.def, ref, top));
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
    return <ReadonlyField field={field} json={w.kind === "readonly" && w.format === "json"} />;
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
    case "custom":
      return <CustomField field={field} ctx={ctx} />;
    case "readonly":
      return <ReadonlyField field={field} json={w.format === "json"} />;
  }
}

/** A behavior section's heading: its label, its description as the hint, and Remove unless the type requires it. */
function BehaviorHeading({ section, ctx }: { section: InspectorSectionModel; ctx: Ctx }) {
  const [error, setError] = useState<string | null>(null);
  const remove = section.behavior?.remove;
  return (
    <>
      <div className="flex min-h-7 items-center gap-1">
        <Hinted hint={section.behavior?.description}>
          <MicroLabel className="min-w-0 flex-1 truncate">{section.title}</MicroLabel>
        </Hinted>
        {remove ? (
          <Button
            size="sm"
            variant="ghost"
            tooltip={`Remove ${section.title} from the selection`}
            onClick={() => setError(dispatch(ctx, remove))}
          >
            Remove
          </Button>
        ) : null}
      </div>
      {section.fields.length === 0 ? (
        <p className="text-xs text-muted-foreground">No fields to set.</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </>
  );
}

/** The behaviors the selection's types allow and it doesn't all carry yet; picking one adds it in one batch. */
function AddBehaviorMenu({ options, ctx }: { options: InspectorModel["addBehaviors"]; ctx: Ctx }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" variant="outline" tooltip="Give the selection another behavior">
              Add behavior
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-48 p-1">
          {options.map((o) => (
            <DropdownMenuItem
              key={o.name}
              className="flex-col items-start gap-0.5"
              onClick={() => setError(dispatch(ctx, o.batch))}
            >
              <span>{o.label}</span>
              <span className="text-muted-foreground">{o.description}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
  session,
  onOpenPrefab,
  inPrefab = false,
  asset,
}: {
  session: EditorSession;
  /** Opens an instance's prefab on its own. */
  onOpenPrefab?: (prefab: string, from: Ref) => void;
  /** `session` edits a prefab in isolation, where no prefab can be made. */
  inPrefab?: boolean;
  /** The asset picked in the project tree. */
  asset?: SelectedAsset;
}) {
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
    return <InstancePanel session={session} doc={doc} id={only} onOpenPrefab={onOpenPrefab} />;
  }
  if (targets.length === 0) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground">Select something in the outliner.</p>
    );
  }

  const model = buildInspectorModel(session.registry, targets);
  const child = targets.length === 1 ? childOverrides(doc, targets[0]!.ref) : null;
  const ctx: Ctx = { session, targets, def: doc, ...(child ? { overrides: child.fields } : {}) };
  const prefabBatch =
    child || inPrefab ? null : createPrefabBatch(doc, selection, session.getPrefabs());
  const typeDefs = model.types.map((t) => session.registry.types.get(t));
  const typeLabel = model.types.map((t, i) => typeDefs[i]?.inspector?.label ?? t).join(", ");
  const scope = targets.map((t) => t.ref).join(",");

  return (
    <div className="flex w-full flex-col gap-3 p-2" aria-label="Inspector">
      <header className="flex items-baseline gap-2 text-xs">
        {targets.length > 1 ? (
          <span className="font-medium">{targets.length} selected</span>
        ) : (
          <span className="truncate font-medium">{targets[0]!.ref}</span>
        )}
        <Hinted hint={targets.length === 1 ? typeDefs[0]?.description : undefined}>
          <span className="truncate text-muted-foreground">{typeLabel}</span>
        </Hinted>
      </header>
      {child ? (
        <p className="text-xs text-muted-foreground">
          In {child.instance}; bold fields override its prefab.
        </p>
      ) : null}
      {prefabBatch ? (
        <Button
          size="sm"
          variant="outline"
          tooltip="Move the selection into a new prefab, with one instance where it stands"
          onClick={() => dispatchSource(session, prefabBatch)}
        >
          Create prefab
        </Button>
      ) : null}
      {model.sections.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {targets.length > 1 ? "Nothing in common to edit." : "Nothing to edit."}
        </p>
      ) : null}
      {model.sections.map((section) => (
        <section key={section.id} aria-label={section.title} className="flex flex-col gap-1.5">
          {section.behavior ? (
            <BehaviorHeading key={scope} section={section} ctx={ctx} />
          ) : (
            <MicroLabel>{section.title}</MicroLabel>
          )}
          {section.fields.map((field) => (
            <FieldView key={`${scope}:${field.path}`} field={field} ctx={ctx} />
          ))}
        </section>
      ))}
      {model.addBehaviors.length > 0 ? (
        <AddBehaviorMenu key={scope} options={model.addBehaviors} ctx={ctx} />
      ) : null}
    </div>
  );
}

/**
 * The prefab's exposed parameters on an instance, each drawn by its first
 * target's widget and set with `setParam` (an override of the nested
 * instance's param when it sits inside another); a set one is bold, with Reset.
 */
function ParamsSection({
  session,
  doc,
  model,
}: {
  session: EditorSession;
  doc: SceneDefinition;
  model: InstanceParamsModel;
}) {
  const [error, setError] = useState<string | null>(null);
  const ctx: Ctx = {
    session,
    targets: [model.target],
    def: doc,
    edit: (field, input) => {
      const param = model.params.find(
        (p) => field.path === p.field.path || field.path.startsWith(`${p.field.path}.`),
      );
      return param
        ? paramBatch(model, param, input, field)
        : { ok: false, error: `${field.path} isn't a parameter` };
    },
  };
  return (
    <section aria-label="Parameters" className="flex flex-col gap-1.5">
      <MicroLabel>Parameters</MicroLabel>
      {model.params.map((p) =>
        p.set ? (
          <div
            key={`${model.ref}:${p.name}`}
            className="flex items-start gap-1 font-semibold"
            data-overridden=""
          >
            <div className="min-w-0 flex-1">
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
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
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
  const run = (batch: OpBatch | null) => setError(dispatchSource(session, batch));
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
    <section aria-label="Placement" className="flex flex-col gap-1.5 text-xs">
      <MicroLabel>Placement</MicroLabel>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {placementText(model)}
        </span>
        {model.editable
          ? controls.map((c) => (
              <Button
                key={c.label}
                size="icon-xs"
                variant="ghost"
                aria-label={c.label}
                tooltip={c.label}
                onClick={() => run(c.batch())}
              >
                <HugeiconsIcon icon={c.icon} />
              </Button>
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
              return edit.ok ? dispatchSource(session, edit.batch) : edit.error;
            }}
          />
        ) : (
          <span className="flex min-h-7 items-center">{model.z}</span>
        )}
      </FieldRow>
      {error ? <p className="text-destructive">{error}</p> : null}
    </section>
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
}: {
  session: EditorSession;
  doc: SceneDefinition;
  id: Ref;
  onOpenPrefab?: (prefab: string, from: Ref) => void;
}) {
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
    <div className="flex w-full flex-col gap-3 p-2" aria-label="Inspector">
      <header className="flex items-baseline gap-2 text-xs">
        <span className="truncate font-medium">{id}</span>
        <span className="truncate text-muted-foreground">
          instance of {inst.prefab}
          {missing ? " (missing)" : ""}
          {nested ? ` in ${nested.holder}` : ""}
        </span>
      </header>
      {placement ? (
        <PlacementSection key={id} session={session} doc={doc} model={placement} />
      ) : null}
      {params && params.params.length > 0 ? (
        <ParamsSection key={id} session={session} doc={doc} model={params} />
      ) : null}
      <section aria-label="Overrides" className="flex flex-col gap-1.5">
        <MicroLabel>Overrides</MicroLabel>
        {keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">Same as the prefab.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 text-xs">
            {keys.map((k) => (
              <li key={k} className="truncate font-semibold">
                {k}
              </li>
            ))}
          </ul>
        )}
      </section>
      {levels.length > 1 ? (
        <section aria-label="Apply to" className="flex flex-col gap-1.5">
          <MicroLabel>Apply to</MicroLabel>
          <SegmentedControl
            size="xs"
            aria-label="Apply to"
            value={target}
            onChange={setLevel}
            className="flex-wrap"
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
        </section>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
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
          onClick={() => setError(dispatchSource(session, revertAllBatch(doc, id)))}
        >
          Revert all
        </Button>
        {nested ? null : (
          <Button
            size="sm"
            variant="ghost"
            disabled={missing}
            tooltip="Turn the instance into plain entities"
            onClick={() => setError(dispatchSource(session, unpackBatch(doc, id)))}
          >
            Unpack
          </Button>
        )}
        {onOpenPrefab ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={missing}
            tooltip="Edit the prefab on its own; every instance follows"
            onClick={() => onOpenPrefab(inst.prefab, id)}
          >
            Open prefab
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Confirm
        open={confirming}
        onOpenChange={(open) => !open && setConfirming(false)}
        title={`Apply to ${target}?`}
        message={`This changes the prefab, so ${count === 1 ? "its one instance changes" : `all ${count} of its instances change`} (those that override the same fields keep theirs). Undo brings it back.`}
        confirmText="Apply"
        onConfirm={() => {
          setError(dispatchSource(session, applyToPrefabBatch(doc, id, { to: target, prefabs })));
          setConfirming(false);
        }}
      />
    </div>
  );
}
