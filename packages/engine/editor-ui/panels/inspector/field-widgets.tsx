import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import type { Pt } from "../../../editor/index";
import { lengthStep, parseRelative, type InspectorRow } from "../../../editor/inspector-model";
import { DEFAULT_LENGTH_UNIT } from "../../../game/defaults";
import { fieldKind } from "../../../scene/index";
import { LENGTH_UNITS, roundLength, type LengthUnitName } from "../../../scene/units";
import { formatQuantity } from "../../kit/format";
import {
  Hint,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
} from "../../kit/index";
import { useBusy } from "../../pending/use-pending";

/**
 * The field widgets the scene inspector and the project settings panels
 * share. Each takes the row it draws and a `commit` that writes a value
 * wherever the host keeps it, resolving to the problem or null.
 */

/** What a commit comes to: why it didn't land, or null. */
export type FieldResult = string | null | Promise<string | null>;

/** Writes `input` (a value, a typed draft, or `undefined` to unset) into the field. */
export type FieldCommit = (input: unknown) => FieldResult;

/** What a field shows when the selection disagrees. */
export const MIXED = "—";
/** Pointer pixels per step when scrubbing a number label. */
const SCRUB_PX = 4;

/** Why a draft can't become a value. */
export class EditError {
  constructor(readonly message: string) {}
}

/** An unset field's placeholder: its default when it has one, else what it falls back to. */
export const unsetText = ({
  defaultValue,
  placeholder,
}: Pick<InspectorRow, "defaultValue" | "placeholder">) =>
  defaultValue === undefined || defaultValue === ""
    ? (placeholder ?? "unset")
    : `${typeof defaultValue === "string" ? defaultValue : JSON.stringify(defaultValue)} (default)`;

/** Calls `done` with a commit's outcome, at once or when it lands. */
function settle(result: FieldResult, done: (problem: string | null) => void): void {
  if (result instanceof Promise) void result.then(done);
  else done(result);
}

export type Bounds = {
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
export function resolveNumber(text: string, current: unknown, b: Bounds): number | EditError {
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
export const metricUnit = (unit: unknown): LengthUnitName | undefined =>
  (LENGTH_UNITS as readonly unknown[]).includes(unit) ? (unit as LengthUnitName) : undefined;

/** A unit after a pair of number inputs, centred on their line. */
export const UnitSuffix = ({ unit }: { unit: string }) => (
  <span className="je-insp-line je-insp-suffix">{unit}</span>
);

/** A number as an input shows it: to `decimals` places when given, trailing zeros dropped. */
const shownNumber = (n: number, decimals: number | undefined) =>
  decimals === undefined ? String(n) : String(Number(n.toFixed(decimals)) + 0);

export const asPt = (v: unknown): Pt | undefined =>
  Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number"
    ? [v[0], v[1]]
    : undefined;

export const PT_BOUNDS: Bounds = { integer: false, length: true };

// ─── Building blocks ─────────────────────────────────────

export function Hinted({ hint, children }: { hint?: string; children: ReactElement }) {
  return (
    <Hint content={hint} disabled={!hint}>
      {children}
    </Hint>
  );
}

/** A field's label and control; with `scope`, a spinner beside the label while an edit in it lands. */
export function FieldRow({
  field,
  label,
  hint,
  scope,
  children,
  error,
}: {
  field?: Pick<InspectorRow, "title" | "description">;
  /** A string is drawn as the field's title, hinted; an element stands as it is. */
  label?: ReactNode;
  hint?: string;
  /** The pending scope its edits run in. */
  scope?: string;
  children: ReactNode;
  error?: string | null;
}) {
  const task = useBusy(scope ?? "");
  const busy = scope !== undefined && task !== undefined;
  const text = label ?? field?.title;
  return (
    <div className="je-insp-field" aria-busy={busy || undefined}>
      <div className="je-insp-field-label">
        {typeof text === "string" ? (
          <Hinted hint={hint ?? field?.description}>
            <span className="je-insp-field-title">{text}</span>
          </Hinted>
        ) : (
          text
        )}
        {busy ? <Spinner size={11} label={null} /> : null}
      </div>
      <div className="je-insp-field-control">
        {children}
        {error ? <span className="je-insp-error">{error}</span> : null}
      </div>
    </div>
  );
}

/**
 * Whether a pointer gesture on `el` may edit: not when its widget is
 * disabled, nor inside a disabled fieldset, which disables inputs but not
 * the spans that scrub and dial.
 */
const takesPointer = (el: Element, disabled: boolean | undefined): boolean =>
  !disabled && el.closest("fieldset[disabled]") === null;

/** A label that scrubs its number: drag sideways to change it, one commit at release. */
function ScrubLabel({
  field,
  step,
  bigStep,
  disabled,
  onPreview,
  onCommit,
}: {
  field: InspectorRow;
  step: number;
  bigStep: number;
  disabled?: boolean;
  onPreview: (delta: number | null) => void;
  onCommit: (text: string) => void;
}) {
  const drag = useRef<{ x: number; delta: number } | null>(null);
  const [active, setActive] = useState(false);
  const dragging = active && !disabled;

  useEffect(() => {
    if (!dragging) return;
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      drag.current = null;
      setActive(false);
      onPreview(null);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [dragging, onPreview]);

  // Edits that stop mid-drag (the doc turned read-only) drop the drag, so its preview doesn't stick.
  useEffect(() => {
    if (!disabled || !drag.current) return;
    drag.current = null;
    onPreview(null);
  }, [disabled, onPreview]);

  const end = (el: Element) => {
    const d = drag.current;
    drag.current = null;
    setActive(false);
    onPreview(null);
    if (d && d.delta !== 0 && takesPointer(el, disabled)) onCommit(relative(d.delta));
  };

  if (disabled) {
    return (
      <Hinted hint={field.description}>
        <span className="je-insp-field-title">{field.title}</span>
      </Hinted>
    );
  }

  return (
    <Hinted hint={field.description}>
      <span
        className="je-insp-field-title je-insp-scrub"
        onPointerDown={(e) => {
          if (e.button !== 0 || !takesPointer(e.currentTarget, disabled)) return;
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
        onPointerUp={(e) => end(e.currentTarget)}
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
export function NumberInput({
  label,
  value,
  fallback,
  unset,
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
  fallback?: Pick<InspectorRow, "defaultValue" | "placeholder">;
  /** What an unset value shows in its place, over `fallback`'s default. */
  unset?: string;
  mixed: boolean;
  step: number;
  bigStep: number;
  preview?: string | null;
  suffix?: string;
  /** Decimals the value shows; all of them when omitted. */
  decimals?: number;
  onCommit: (text: string) => FieldResult;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (text: string) =>
    settle(onCommit(text), (problem) => {
      setError(problem);
      if (!problem) setDraft(null);
    });
  const shown =
    preview ?? draft ?? (mixed || value === undefined ? "" : shownNumber(value, decimals));
  return (
    <div className="je-insp-number">
      <div className="je-insp-row" data-gap="tight">
        <Input
          inputMode="decimal"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          placeholder={
            mixed ? MIXED : value === undefined ? (unset ?? unsetText(fallback ?? {})) : undefined
          }
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

/** What every field widget takes. */
export type FieldWidgetProps = {
  field: InspectorRow;
  commit: FieldCommit;
  /** What an unset value shows in its place (the value it falls back to); default its default. */
  unset?: string;
  /** The pending scope its edits run in, for the busy spinner. */
  scope?: string;
  /** Number and angle fields: the scrub label and dial don't drag (a disabled fieldset disables the inputs). */
  disabled?: boolean;
};

const placeholderOf = (field: InspectorRow, unset: string | undefined) =>
  field.mixed
    ? MIXED
    : field.value === undefined && (unset !== undefined || field.optional)
      ? (unset ?? unsetText(field))
      : undefined;

// ─── Widgets ─────────────────────────────────────────────

/** A text draft committed on Enter or blur; empty unsets an optional field. */
export function TextField({ field, commit, unset, scope }: FieldWidgetProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = typeof field.value === "string" ? field.value : "";
  const run = () => {
    if (draft === null) return;
    const input = draft.trim() === "" && field.optional ? undefined : draft;
    settle(commit(input), (problem) => {
      setError(problem);
      if (!problem) setDraft(null);
    });
  };
  return (
    <FieldRow field={field} error={error} scope={scope}>
      <Input
        aria-label={field.path}
        aria-invalid={error ? true : undefined}
        placeholder={placeholderOf(field, unset)}
        maxLength={field.widget.kind === "text" ? field.widget.maxLength : undefined}
        value={draft ?? (field.mixed ? "" : value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={run}
        onKeyDown={(e) => {
          if (e.key === "Enter") run();
          if (e.key === "Escape") {
            setDraft(null);
            setError(null);
          }
        }}
      />
    </FieldRow>
  );
}

type NumberWidget = Extract<InspectorRow["widget"], { kind: "number" }>;

export function NumberField({ field, commit, unset, scope, disabled }: FieldWidgetProps) {
  const w = field.widget as NumberWidget;
  const [preview, setPreview] = useState<number | null>(null);
  const value = typeof field.value === "number" ? field.value : undefined;
  const run = (text: string): FieldResult => {
    if (text.trim() === "" && field.optional) return commit(undefined);
    const problem = draftProblem(text, w);
    return problem ?? commit(text);
  };
  const label = w.scrub ? (
    <ScrubLabel
      field={field}
      step={w.step}
      bigStep={w.bigStep}
      {...(disabled ? { disabled } : {})}
      onPreview={setPreview}
      onCommit={(text) => void run(text)}
    />
  ) : undefined;
  return (
    <FieldRow field={field} label={label} scope={scope}>
      <NumberInput
        label={field.path}
        value={value}
        fallback={field}
        {...(unset !== undefined ? { unset } : {})}
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
        onCommit={run}
      />
    </FieldRow>
  );
}

/** Degrees: a dial (snapping to `snapDeg`, Shift for free) beside the field. */
export function AngleField({ field, commit, unset, scope, disabled }: FieldWidgetProps) {
  const w = field.widget as Extract<InspectorRow["widget"], { kind: "angle" }>;
  const value = typeof field.value === "number" ? field.value : undefined;
  const [preview, setPreview] = useState<number | null>(null);
  const dial = useRef<HTMLSpanElement>(null);
  const bounds = { integer: w.integer };
  const run = (text: string): FieldResult => {
    if (text.trim() === "" && field.optional) return commit(undefined);
    const problem = draftProblem(text, bounds);
    return problem ?? commit(text);
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
    <FieldRow field={field} scope={scope}>
      <div className="je-insp-row">
        <span
          ref={dial}
          role="presentation"
          className="je-insp-dial"
          data-disabled={disabled || undefined}
          onPointerDown={(e) => {
            if (!takesPointer(e.currentTarget, disabled)) return;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setPreview(angleAt(e));
          }}
          onPointerMove={(e) => preview !== null && setPreview(angleAt(e))}
          onPointerUp={(e) => {
            if (preview !== null && preview !== value && takesPointer(e.currentTarget, disabled))
              void commit(preview);
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
          {...(unset !== undefined ? { unset } : {})}
          mixed={field.mixed}
          step={1}
          bigStep={w.snapDeg}
          suffix="°"
          preview={preview === null ? null : String(preview)}
          onCommit={run}
        />
      </div>
    </FieldRow>
  );
}

/** The segment that clears an optional side field: no one side, so any side. */
const ANY_SIDE = "\u0000any";

export type FieldOption = { value: string | number; label: string; description?: string };

export function OptionsField({
  field,
  commit,
  unset,
  scope,
  options,
  segmented,
}: FieldWidgetProps & { options: readonly FieldOption[]; segmented: boolean }) {
  const [error, setError] = useState<string | null>(null);
  // An optional side's unset state is a choice of its own, so it gets a segment.
  const anySide = segmented && field.optional && fieldKind(field.schema) === "side";
  const set = typeof field.value === "string" || typeof field.value === "number";
  const current = field.mixed ? "" : set ? String(field.value) : anySide ? ANY_SIDE : "";
  const write = (input: unknown) => settle(commit(input), setError);
  const pick = (key: string) => {
    const option = options.find((o) => String(o.value) === key);
    if (key === ANY_SIDE) write(undefined);
    else if (key === current && field.optional) write(undefined);
    else if (option) write(option.value);
    else if (key === "" && field.optional) write(undefined);
  };
  // An unset field shows the option its default picks, by that option's label.
  const fallback =
    set || field.mixed ? undefined : options.find((o) => o.value === field.defaultValue);
  const unsetNote = fallback ? `${fallback.label} (default)` : unset;
  const note = field.mixed ? MIXED : !set && unsetNote !== undefined ? unsetNote : null;
  if (segmented) {
    return (
      <FieldRow field={field} error={error} scope={scope}>
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
                {...(o === fallback ? { className: "je-insp-default-choice" } : {})}
              >
                {o.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
          {note !== null ? <span className="je-insp-muted">{note}</span> : null}
        </div>
      </FieldRow>
    );
  }
  const label = options.find((o) => String(o.value) === current)?.label;
  return (
    <FieldRow field={field} error={error} scope={scope}>
      <Select value={current} onValueChange={(v) => pick(typeof v === "string" ? v : "")}>
        <SelectTrigger size="sm" aria-label={field.path}>
          <SelectValue>{label ?? note ?? "unset"}</SelectValue>
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

/**
 * On or off. Without `fallback`, turning off an optional field unsets it;
 * with one, an unset field shows the fallback and turning it off writes
 * `false`, since unsetting would fall back to it again.
 */
export function SwitchField({
  field,
  commit,
  unset,
  scope,
  fallback,
}: FieldWidgetProps & { fallback?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const checked =
    field.value === undefined && fallback !== undefined ? fallback : field.value === true;
  const off = fallback === undefined && field.optional ? undefined : false;
  const note = field.mixed
    ? MIXED
    : field.value === undefined && unset !== undefined
      ? unset
      : null;
  return (
    <FieldRow field={field} error={error} scope={scope}>
      <div className="je-insp-row je-insp-line">
        <Switch
          aria-label={field.path}
          checked={checked}
          onCheckedChange={(on) => settle(commit(on ? true : off), setError)}
        />
        {note !== null ? <span className="je-insp-muted">{note}</span> : null}
      </div>
    </FieldRow>
  );
}

/**
 * An x and a y, each committing the whole point: `commitEach` hands the
 * host what a typed axis makes of a point, for it to apply to each value
 * it holds. A metric point steps and shows as an `m` number does.
 */
export function PointField({
  field,
  commitEach,
  scope,
  ppm = DEFAULT_LENGTH_UNIT,
  fallback,
}: Omit<FieldWidgetProps, "commit"> & {
  commitEach: (next: (current: unknown) => Pt | EditError) => FieldResult;
  /** The game's px per metre, for a metric point's steps. */
  ppm?: number;
  /** What an unset point falls back to: its placeholders, and the base a typed axis edits. */
  fallback?: Pt;
}) {
  const w = field.widget as Extract<InspectorRow["widget"], { kind: "point" }>;
  const unit = metricUnit(w.unit) ?? "m";
  const steps = lengthStep(unit, ppm);
  const step = w.step ?? steps.step;
  const bigStep = w.bigStep ?? steps.bigStep;
  const decimals = w.decimals ?? steps.decimals;
  const at = asPt(field.value);
  const axis = (i: 0 | 1) => (text: string) =>
    commitEach((cur) => {
      const pt = asPt(cur) ?? fallback ?? [0, 0];
      const n = resolveNumber(text, pt[i], PT_BOUNDS);
      if (n instanceof EditError) return n;
      const next: Pt = [...pt];
      next[i] = n;
      return next;
    });
  return (
    <FieldRow field={field} scope={scope}>
      <div className="je-insp-row" data-gap="tight" data-align="start">
        {(["x", "y"] as const).map((name, i) => (
          <NumberInput
            key={name}
            label={`${field.path}.${name}`}
            value={at?.[i]}
            {...(at === undefined && fallback ? { unset: String(fallback[i]) } : {})}
            mixed={field.mixed}
            step={step}
            bigStep={bigStep}
            decimals={decimals}
            suffix={name}
            onCommit={axis(i as 0 | 1)}
          />
        ))}
        <UnitSuffix unit={typeof w.unit === "string" ? w.unit : unit} />
      </div>
    </FieldRow>
  );
}

/** A value shown, not edited: a metric number with its unit, JSON for anything not a string. */
export function ReadonlyField({
  field,
  json = false,
  ppm = DEFAULT_LENGTH_UNIT,
  unset = "unset",
}: {
  field: InspectorRow;
  json?: boolean;
  ppm?: number;
  unset?: string;
}) {
  const unit = "unit" in field.widget ? metricUnit(field.widget.unit) : undefined;
  const text = field.mixed
    ? MIXED
    : field.value === undefined
      ? unset
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

/** An object's fields, nested under its title. */
export function NestedField({ field, children }: { field: InspectorRow; children: ReactNode }) {
  return (
    <div className="je-insp-stack">
      <Hinted hint={field.description}>
        <span className="je-insp-nested-title">{field.title}</span>
      </Hinted>
      <div className="je-insp-stack je-insp-nested">{children}</div>
    </div>
  );
}
