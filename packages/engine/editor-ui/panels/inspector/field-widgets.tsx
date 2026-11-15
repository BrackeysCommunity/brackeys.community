import { ArrowDown01Icon, ArrowRight01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { z } from "zod";

import type { Pt } from "../../../editor/index";
import { lengthStep, parseRelative, type InspectorRow } from "../../../editor/inspector-model";
import { DEFAULT_LENGTH_UNIT } from "../../../game/defaults";
import { STRING_KEY_PATTERN } from "../../../project/kinds/strings";
import { fieldKind } from "../../../scene/index";
import { unwrapSchema } from "../../../scene/schema";
import { LENGTH_UNITS, roundLength, type LengthUnitName } from "../../../scene/units";
import { STORAGE_PREFIX } from "../../host";
import { formatQuantity } from "../../kit/format";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Hint,
  Icon,
  IconButton,
  Input,
  MicroLabel,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Spinner,
  Switch,
  useKit,
} from "../../kit/index";
import { useBrowserState } from "../../kit/ssr";
import { useBusy } from "../../pending/use-pending";
import { readStored, storedFlags, writeStored } from "../../session/stored";

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
  named,
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
  /** Values shown as a word, which typing the word sets. */
  named?: readonly { value: number; label: string }[];
  onCommit: (text: string) => FieldResult;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (text: string) => {
    const word = named?.find((n) => n.label.toLowerCase() === text.trim().toLowerCase());
    settle(onCommit(word ? String(word.value) : text), (problem) => {
      setError(problem);
      if (!problem) setDraft(null);
    });
  };
  const shown =
    preview ??
    draft ??
    (mixed || value === undefined
      ? ""
      : (named?.find((n) => n.value === value)?.label ?? shownNumber(value, decimals)));
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
  /** Number and options fields: the control's accessible name; default the field's path. */
  label?: string;
};

/** An unset value's placeholder; a required field is unset only while the object holding it is. */
const placeholderOf = (field: InspectorRow, unset: string | undefined) =>
  field.mixed ? MIXED : field.value === undefined ? (unset ?? unsetText(field)) : undefined;

// ─── Widgets ─────────────────────────────────────────────

/** A draft's value, or why it can't be one. */
type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * A typed draft committed on Enter or blur once `parse` takes it; empty
 * unsets an optional field, Escape drops the draft.
 */
function DraftField({
  field,
  commit,
  scope,
  shown,
  placeholder,
  parse,
}: Pick<FieldWidgetProps, "field" | "commit" | "scope"> & {
  /** The stored value as text. */
  shown: string;
  placeholder: string | undefined;
  parse: (text: string) => Parsed;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    if (draft === null) return;
    const parsed: Parsed =
      draft.trim() === "" && field.optional ? { ok: true, value: undefined } : parse(draft);
    if (!parsed.ok) return setError(parsed.error);
    settle(commit(parsed.value), (problem) => {
      setError(problem);
      if (!problem) setDraft(null);
    });
  };
  return (
    <FieldRow field={field} error={error} scope={scope}>
      <Input
        aria-label={field.path}
        aria-invalid={error ? true : undefined}
        placeholder={placeholder}
        maxLength={field.widget.kind === "text" ? field.widget.maxLength : undefined}
        value={draft ?? (field.mixed ? "" : shown)}
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

const asText = (text: string): Parsed => ({ ok: true, value: text });

/** A text draft committed on Enter or blur; empty unsets an optional field. */
export function TextField({ field, commit, unset, scope }: FieldWidgetProps) {
  return (
    <DraftField
      field={field}
      commit={commit}
      scope={scope}
      shown={typeof field.value === "string" ? field.value : ""}
      placeholder={placeholderOf(field, unset)}
      parse={asText}
    />
  );
}

function asJson(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      error: 'Enter JSON: a number, "text" in quotes, true, an [array] or an {object}.',
    };
  }
}

/**
 * Plain JSON typed as text, committed on Enter or blur once it parses;
 * empty unsets an optional field.
 */
export function JsonField({ field, commit, unset, scope }: FieldWidgetProps) {
  return (
    <DraftField
      field={field}
      commit={commit}
      scope={scope}
      shown={field.value === undefined ? "" : JSON.stringify(field.value)}
      placeholder={placeholderOf(field, unset)}
      parse={asJson}
    />
  );
}

type NumberWidget = Extract<InspectorRow["widget"], { kind: "number" }>;

export function NumberField({
  field,
  commit,
  unset,
  scope,
  disabled,
  label: name,
}: FieldWidgetProps) {
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
        label={name ?? field.path}
        value={value}
        fallback={field}
        {...(unset !== undefined ? { unset } : {})}
        mixed={field.mixed}
        step={w.step}
        bigStep={w.bigStep}
        suffix={w.unit}
        decimals={w.decimals}
        {...(w.named ? { named: w.named } : {})}
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

/** Whether `row` is a number with both a least and a most value, as a slider draws it. */
export const isBoundedNumber = (row: Pick<InspectorRow, "widget">): boolean =>
  row.widget.kind === "number" && row.widget.min !== undefined && row.widget.max !== undefined;

/**
 * A bounded number (`isBoundedNumber`): a slider over its range that writes
 * on release, the typed value, and a unit slot of one width in every row,
 * so the value boxes line up whether or not a row has a unit. An unset
 * field sits at its default, else `fallback`, else 0.
 */
export function SliderField({
  field,
  commit,
  scope,
  label: name,
  fallback,
}: Pick<FieldWidgetProps, "field" | "commit" | "scope" | "label"> & {
  /** What an unset field with no schema default plays as. */
  fallback?: number;
}) {
  const w = field.widget as NumberWidget;
  const min = w.min ?? 0;
  const max = w.max ?? 1;
  const [drag, setDrag] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = name ?? field.path;
  const value = typeof field.value === "number" ? field.value : undefined;
  const rest = typeof field.defaultValue === "number" ? field.defaultValue : fallback;
  const shown = drag ?? value ?? Math.min(max, Math.max(min, rest ?? 0));
  const unset =
    field.defaultValue === undefined && rest !== undefined
      ? `${shownNumber(rest, w.decimals)} (default)`
      : unsetText(field);
  const write = (input: unknown) => settle(commit(input), setError);
  return (
    <FieldRow field={field} scope={scope} error={error}>
      <div className="je-insp-row je-insp-slider" data-gap="tight">
        <Slider
          aria-label={`${label} slider`}
          min={min}
          max={max}
          step={w.step}
          value={shown}
          onValueChange={(v) => setDrag(Array.isArray(v) ? (v[0] ?? null) : v)}
          onValueCommitted={(v) => {
            setDrag(null);
            const n = Array.isArray(v) ? v[0] : v;
            if (typeof n === "number" && n !== value) write(n);
          }}
        />
        <NumberInput
          label={label}
          value={value}
          unset={unset}
          mixed={field.mixed}
          step={w.step}
          bigStep={w.bigStep}
          decimals={w.decimals}
          preview={drag === null ? null : String(drag)}
          onCommit={(text) =>
            text.trim() === "" && field.optional ? commit(undefined) : commit(text)
          }
        />
        <span
          className="je-insp-suffix je-insp-slider-unit"
          aria-hidden={w.unit ? undefined : true}
        >
          {w.unit ?? ""}
        </span>
      </div>
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
  label,
  problem = null,
}: FieldWidgetProps & {
  options: readonly FieldOption[];
  segmented: boolean;
  /** What is wrong with the value as it stands, in the error slot until an edit's own error. */
  problem?: string | null;
}) {
  const [own, setError] = useState<string | null>(null);
  const error = own ?? problem;
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
    // The tinted default segment already says what an unset field falls back to.
    const segmentNote = fallback ? null : note;
    return (
      <FieldRow field={field} error={error} scope={scope}>
        <div className="je-insp-row" data-gap="tight">
          <SegmentedControl
            size="xs"
            aria-label={label ?? field.path}
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
                tooltip={
                  o === fallback
                    ? o.description
                      ? `${o.description} (default)`
                      : "Unset: the default"
                    : o.description
                }
                {...(o === fallback ? { className: "je-insp-default-choice" } : {})}
              >
                {o.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
          {segmentNote !== null ? <span className="je-insp-muted">{segmentNote}</span> : null}
        </div>
      </FieldRow>
    );
  }
  // An optional field whose default is an option lists that option once, as
  // "Linear (default)", for its unset state: picking it unsets the field.
  const byDefault = field.optional
    ? options.find((o) => o.value === field.defaultValue)
    : undefined;
  const shown = current === "" && byDefault && !field.mixed ? String(byDefault.value) : current;
  const labelOf = (o: FieldOption) => (o === byDefault ? `${o.label} (default)` : o.label);
  const picked = options.find((o) => String(o.value) === shown);
  return (
    <FieldRow field={field} error={error} scope={scope}>
      <Select
        value={shown}
        onValueChange={(v) => {
          const key = typeof v === "string" ? v : "";
          if (!byDefault || key !== String(byDefault.value)) pick(key);
          else if (set || field.mixed) write(undefined);
        }}
      >
        <SelectTrigger size="sm" aria-label={label ?? field.path}>
          <SelectValue>{(picked && labelOf(picked)) ?? note ?? "unset"}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {field.optional && !byDefault ? <SelectItem value="">unset</SelectItem> : null}
          {options.map((o) => (
            <SelectItem key={String(o.value)} value={String(o.value)}>
              {labelOf(o)}
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

/** How a pair with no unit of its own steps: as a plain number field does. */
const UNITLESS_STEPS: { step: number; bigStep: number; decimals?: number } = {
  step: 0.1,
  bigStep: 1,
};

/**
 * An x and a y, each committing the whole point: `commitEach` hands the
 * host what a typed axis makes of a point, for it to apply to each value
 * it holds. A point in a unit steps as an `m` number does, a metric one in
 * its own length; a pair with no unit shows none.
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
  /**
   * What an unset point falls back to: its placeholders, and the base a typed
   * axis edits. Without one, the field's default does both.
   */
  fallback?: Pt;
}) {
  const w = field.widget as Extract<InspectorRow["widget"], { kind: "point" }>;
  const unit = typeof w.unit === "string" ? w.unit : undefined;
  const steps = unit === undefined ? UNITLESS_STEPS : lengthStep(metricUnit(unit) ?? "m", ppm);
  const step = w.step ?? steps.step;
  const bigStep = w.bigStep ?? steps.bigStep;
  const decimals = w.decimals ?? steps.decimals;
  const at = asPt(field.value);
  const declared = asPt(field.defaultValue);
  const base = fallback ?? declared;
  const unsetAxis = (i: number): { unset?: string } =>
    at !== undefined
      ? {}
      : fallback
        ? { unset: String(fallback[i]) }
        : declared
          ? { unset: `${declared[i]} (default)` }
          : {};
  const axis = (i: 0 | 1) => (text: string) =>
    commitEach((cur) => {
      const pt = asPt(cur) ?? base ?? [0, 0];
      const n = resolveNumber(text, pt[i], PT_BOUNDS);
      if (n instanceof EditError) return n;
      const next: Pt = [...pt];
      next[i] = n;
      return next;
    });
  return (
    <FieldRow field={field} scope={scope}>
      <div className="je-insp-row je-insp-wrap je-insp-pair" data-gap="tight" data-align="start">
        {(["x", "y"] as const).map((name, i) => (
          <NumberInput
            key={name}
            label={`${field.path}.${name}`}
            value={at?.[i]}
            {...unsetAxis(i)}
            mixed={field.mixed}
            step={step}
            bigStep={bigStep}
            {...(decimals !== undefined ? { decimals } : {})}
            suffix={name}
            onCommit={axis(i as 0 | 1)}
          />
        ))}
        {unit !== undefined ? <UnitSuffix unit={unit} /> : null}
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
  hint,
}: {
  field: Pick<InspectorRow, "title" | "description" | "value" | "mixed"> &
    Partial<Pick<InspectorRow, "widget">>;
  json?: boolean;
  ppm?: number;
  unset?: string;
  /** Shown on the label in place of the field's description: why it can't be edited here. */
  hint?: string;
}) {
  const unit = field.widget && "unit" in field.widget ? metricUnit(field.widget.unit) : undefined;
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
    <FieldRow field={field} {...(hint !== undefined ? { hint } : {})}>
      <span className="je-insp-line je-sp-truncate">{text}</span>
    </FieldRow>
  );
}

// ─── Flat records ────────────────────────────────────────

type Flat = string | number | boolean | null;

const isFlat = (v: unknown): v is Flat =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** A record's value schema when it takes some string, number, boolean or null; null for any other schema. */
const recordValueType = (schema: z.ZodType): z.ZodType | null => {
  const inner = unwrapSchema(schema);
  if (!(inner instanceof z.ZodRecord)) return null;
  const values = inner.valueType as z.ZodType;
  return ["x", 0, true, null].some((v) => values.safeParse(v).success) ? values : null;
};

/** Whether `row` is a record whose every value is a string, number, boolean or null, as `RecordField` edits it. */
export function isFlatRecord(row: Pick<InspectorRow, "schema" | "value" | "mixed">): boolean {
  if (row.mixed || !recordValueType(row.schema)) return false;
  if (row.value === undefined) return true;
  return (
    row.value !== null &&
    typeof row.value === "object" &&
    !Array.isArray(row.value) &&
    Object.values(row.value).every(isFlat)
  );
}

/** A typed value: JSON's number, boolean or null, or a quoted string, where the record takes it; else the text. */
function flatValue(text: string, valueType: z.ZodType): Flat {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isFlat(parsed) && valueType.safeParse(parsed).success) return parsed;
  } catch {
    // Not JSON: the text itself.
  }
  return text;
}

/** A value as it is typed back: a string as it reads, unless typing it would give another type. */
const flatText = (value: Flat, valueType: z.ZodType): string =>
  typeof value === "string" && flatValue(value, valueType) === value
    ? value
    : JSON.stringify(value);

/** One entry's key or value: a draft committed on Enter or blur, dropped on Escape. */
export function RecordInput({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (text: string, by: "enter" | "blur") => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const run = (by: "enter" | "blur") => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit(draft, by);
  };
  return (
    <Input
      aria-label={label}
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => run("blur")}
      onKeyDown={(e) => {
        if (e.key === "Enter") run("enter");
        else if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/**
 * A flat record (`isFlatRecord`) as key and value rows, each with a remove,
 * and a row to add one. Every change commits the whole record; the last
 * key removed unsets an optional field.
 */
export function RecordField({
  field,
  commit,
  scope,
}: Pick<FieldWidgetProps, "field" | "commit" | "scope">) {
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState({ key: "", value: "" });
  const valueType = recordValueType(field.schema) ?? z.unknown();
  const entries = Object.entries((field.value ?? {}) as Record<string, Flat>);
  const write = (next: [string, Flat][]) =>
    settle(
      commit(next.length === 0 && field.optional ? undefined : Object.fromEntries(next)),
      setError,
    );
  const rename = (from: string, to: string) => {
    const key = to.trim();
    if (key === "") return setError("A key can't be empty.");
    if (key !== from && entries.some(([k]) => k === key))
      return setError(`There is already a key "${key}".`);
    write(entries.map(([k, v]) => [k === from ? key : k, v]));
  };
  const add = (draft: { key: string; value: string }) => {
    setAdding(draft);
    const key = draft.key.trim();
    if (key === "") return;
    if (entries.some(([k]) => k === key)) return setError(`There is already a key "${key}".`);
    setAdding({ key: "", value: "" });
    write([...entries, [key, flatValue(draft.value, valueType)]]);
  };
  return (
    <FieldRow field={field} scope={scope} error={error}>
      <div className="je-insp-stack" data-gap="tight" role="group" aria-label={field.path}>
        {entries.map(([key, value]) => (
          <div key={key} className="je-insp-row je-insp-record" data-gap="tight">
            <RecordInput
              label={`${field.path} key ${key}`}
              value={key}
              onCommit={(text) => rename(key, text)}
            />
            <RecordInput
              label={`${field.path}.${key}`}
              value={flatText(value, valueType)}
              onCommit={(text) =>
                write(entries.map(([k, v]) => [k, k === key ? flatValue(text, valueType) : v]))
              }
            />
            <IconButton
              size="icon-xs"
              icon={Delete02Icon}
              label={`Remove ${key}`}
              tooltip="Remove the key"
              onClick={() => write(entries.filter(([k]) => k !== key))}
            />
          </div>
        ))}
        <div className="je-insp-row je-insp-record" data-gap="tight">
          <RecordInput
            label={`${field.path} new key`}
            value={adding.key}
            placeholder="Add a key"
            onCommit={(text, by) =>
              by === "enter" ? add({ ...adding, key: text }) : setAdding({ ...adding, key: text })
            }
          />
          <RecordInput
            label={`${field.path} new value`}
            value={adding.value}
            placeholder="Value"
            onCommit={(text) => add({ ...adding, value: text })}
          />
          <span className="je-insp-record-spacer" aria-hidden />
        </div>
      </div>
    </FieldRow>
  );
}

/**
 * An object's fields, nested under its title. With `collapse`, the title
 * folds them away and a folded one reads its `summary` instead, in full as
 * its hint.
 */
export function NestedField({
  field,
  children,
  collapse,
}: {
  field: InspectorRow;
  children: ReactNode;
  collapse?: { open: boolean; onToggle: () => void; summary?: string };
}) {
  const folded = collapse !== undefined && !collapse.open;
  return (
    <div className="je-insp-stack">
      <Hinted hint={folded && collapse.summary ? collapse.summary : field.description}>
        {collapse ? (
          <button
            type="button"
            className="je-insp-nested-toggle"
            aria-expanded={collapse.open}
            onClick={collapse.onToggle}
          >
            <Icon icon={collapse.open ? ArrowDown01Icon : ArrowRight01Icon} size={12} />
            <span className="je-insp-nested-title">{field.title}</span>
            {folded && collapse.summary ? (
              <span className="je-insp-nested-summary je-sp-truncate">{collapse.summary}</span>
            ) : null}
          </button>
        ) : (
          <span className="je-insp-nested-title">{field.title}</span>
        )}
      </Hinted>
      {folded ? null : <div className="je-insp-stack je-insp-nested">{children}</div>}
    </div>
  );
}

/** A disabled fieldset that draws nothing of its own: it only disables the controls inside it. */
export function Locked({
  disabled,
  className,
  children,
}: {
  disabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset disabled={disabled} className={className} style={CONTENTS}>
      {children}
    </fieldset>
  );
}

const CONTENTS = { display: "contents" } as const;

const COLLAPSED_KEY = `${STORAGE_PREFIX}inspector-collapsed`;

/**
 * A titled group of fields that collapses from its title, remembered per
 * `id` in the host's storage. The title is a `<summary>`, so it stays
 * usable inside a read-only inspector's disabled fieldset.
 */
export function InspectorSection({
  id,
  title,
  hint,
  actions,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  /** Controls at the end of the title's row, such as a behavior's Remove. */
  actions?: ReactNode;
  /** How it starts until the viewer toggles it; only a choice that differs is stored. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const { storage } = useKit();
  const [open, setOpen] = useBrowserState(() => {
    const closed = readStored(storage, COLLAPSED_KEY, {}, storedFlags)[id];
    return closed === undefined ? defaultOpen : !closed;
  }, defaultOpen);
  const toggle = (e: MouseEvent) => {
    e.preventDefault();
    const closed = { ...readStored(storage, COLLAPSED_KEY, {}, storedFlags) };
    if (!open === defaultOpen) delete closed[id];
    else closed[id] = open;
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

/**
 * A [low, high] pair, each end committing the whole range through
 * `commitEach` as `PointField`'s axes do. With no range yet, the end not
 * typed keeps the field's default, else starts at 0, or at the typed value
 * where that would invert it.
 */
export function RangeField({
  field,
  scope,
  commitEach,
}: Omit<FieldWidgetProps, "commit"> & {
  commitEach: (next: (current: unknown) => Pt | EditError) => FieldResult;
}) {
  const w = field.widget as Extract<InspectorRow["widget"], { kind: "range" }>;
  const scale = w.scale ?? 1;
  const at = asPt(field.value);
  const declared = asPt(field.defaultValue);
  const end = (i: 0 | 1) => (text: string) =>
    commitEach((cur) => {
      const stored = asPt(cur) ?? declared;
      const n = resolveNumber(text, stored ? stored[i] * scale : 0, { integer: false });
      if (n instanceof EditError) return n;
      if (!stored) return i === 0 ? [n, Math.max(n, 0)] : [Math.min(n, 0), n];
      const pair: Pt = [stored[0] * scale, stored[1] * scale];
      pair[i] = n;
      return pair;
    });
  return (
    <FieldRow field={field} scope={scope}>
      <div className="je-insp-row je-insp-wrap je-insp-range" data-gap="tight" data-align="start">
        {(["low", "high"] as const).map((name, i) => (
          <NumberInput
            key={name}
            label={`${field.path}.${name}`}
            value={at?.[i]}
            {...(at === undefined && declared
              ? { unset: `${declared[i]! * scale} (default)` }
              : {})}
            mixed={field.mixed}
            step={w.step}
            bigStep={w.bigStep}
            {...(w.decimals !== undefined ? { decimals: w.decimals } : {})}
            suffix={i === 0 ? "min" : "max"}
            onCommit={end(i as 0 | 1)}
          />
        ))}
        {w.unit ? <UnitSuffix unit={w.unit} /> : null}
      </div>
    </FieldRow>
  );
}

/** How a combobox shows an id: its label, and muted text after it that tells it from similar ones. */
export type Described = { label: string; detail?: string };

/**
 * A combobox picking one id of `items`; cleared, it reports null. With
 * `typed`, a typed id it accepts is offered too, as `typedDetail` says.
 */
export function IdCombobox({
  label,
  items,
  value,
  onChange,
  invalid,
  placeholder,
  clearable,
  empty,
  describe,
  typed,
  typedDetail,
}: {
  label: string;
  items: readonly string[];
  value: string | null;
  onChange: (next: string | null) => void;
  invalid: boolean;
  placeholder: string;
  clearable: boolean;
  empty: string;
  /** Without it, items show their ids. */
  describe?: (id: string) => Described;
  /** Whether a typed id that isn't among `items` may be picked. */
  typed?: (text: string) => boolean;
  typedDetail?: string;
}) {
  const labelOf = (id: string | null) => (id === null ? "" : (describe?.(id).label ?? id));
  // A typed id is offered as it's typed, so the text is held here, starting over at each new pick.
  const [typing, setTyping] = useState(() => ({ value, text: labelOf(value) }));
  if (typing.value !== value) setTyping({ value, text: labelOf(value) });
  const query = typing.value === value ? typing.text : labelOf(value);
  const setQuery = (text: string) => setTyping({ value, text });
  const q = query.trim();
  const extra = typed && q !== "" && !items.includes(q) && typed(q) ? q : null;
  const all = extra !== null ? [...items, extra] : items;
  const described =
    describe || extra !== null
      ? (id: string): Described =>
          id === extra
            ? { label: id, ...(typedDetail ? { detail: typedDetail } : {}) }
            : (describe?.(id) ?? { label: id })
      : undefined;
  return (
    <Combobox
      items={all}
      value={value}
      onValueChange={onChange}
      {...(typed
        ? { inputValue: query, onInputValueChange: (next: string) => setQuery(next) }
        : {})}
      {...(described
        ? {
            itemToStringLabel: (id: string) => described(id).label,
            filter: (id: string, text: string) => {
              // The picked id's own text lists everything, as an untouched field does.
              if (value !== null && text === labelOf(value)) return true;
              const needle = text.trim().toLowerCase();
              const d = described(id);
              return `${id} ${d.label} ${d.detail ?? ""}`.toLowerCase().includes(needle);
            },
          }
        : {})}
    >
      <ComboboxInput
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        showClear={clearable}
      />
      <ComboboxContent>
        <ComboboxList>
          {(id: string) => {
            const d = described?.(id);
            return (
              <ComboboxItem key={id} value={id}>
                <span className="je-sp-truncate">{d?.label ?? id}</span>
                {d?.detail ? (
                  <span className="je-menu-detail je-sp-truncate">{d.detail}</span>
                ) : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        <ComboboxEmpty>{empty}</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}

/** What a picked or typed name falls short of: the shared rule's message and how much it matters. */
export type NameProblem = { message: string; severity: "error" | "warn" | "info" };

/** The project's string keys as a string-key field picks them. */
export type StringKeyTable = {
  /** Every key across the project's string tables, by name. */
  keys: readonly string[];
  /** A key's text in the default locale. */
  text: (key: string) => string | undefined;
  /** Why `key` falls short: no text in some locale, by the one string-key rule. */
  problem: (key: string) => NameProblem | null;
  /** The default locale's font, which text with no font of its own draws in. */
  font?: string;
};

const isStringKey = (text: string) => STRING_KEY_PATTERN.test(text);

/**
 * A name picked from a list or typed, its problem shown in place: an error
 * as the field's error, a lesser one as a muted note under it.
 */
export function NameField({
  field,
  commit,
  scope,
  items,
  describe,
  typed,
  typedDetail,
  problem,
  placeholder,
  empty,
}: FieldWidgetProps & {
  items: readonly string[];
  describe?: (id: string) => Described;
  typed: (text: string) => boolean;
  typedDetail: string;
  problem: (name: string) => NameProblem | null;
  placeholder: string;
  empty: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const value = !field.mixed && typeof field.value === "string" ? field.value : null;
  const issue = value !== null ? problem(value) : null;
  const shown = error ?? (issue?.severity === "error" ? issue.message : null);
  return (
    <FieldRow field={field} scope={scope} error={shown}>
      <IdCombobox
        label={field.path}
        items={value !== null && !items.includes(value) ? [...items, value] : items}
        value={value}
        onChange={(next) => {
          if (next === value) return;
          if (next !== null) settle(commit(next), setError);
          else if (field.optional) settle(commit(undefined), setError);
        }}
        invalid={shown !== null}
        placeholder={field.mixed ? MIXED : placeholder}
        clearable={field.optional}
        empty={empty}
        typed={typed}
        typedDetail={typedDetail}
        {...(describe ? { describe } : {})}
      />
      {issue && issue.severity !== "error" ? (
        <span className="je-insp-muted">{issue.message}</span>
      ) : null}
    </FieldRow>
  );
}

/**
 * A string key, picked from the project's string tables with each key's
 * default-locale text beside it, or typed; a key short of text says so.
 * Without a table (no project) it's a text field.
 */
export function StringKeyField({
  table,
  ...props
}: FieldWidgetProps & { table: StringKeyTable | null }) {
  if (!table) return <TextField {...props} />;
  return (
    <NameField
      {...props}
      items={table.keys}
      describe={(key) => {
        const text = table.text(key);
        return text !== undefined ? { label: key, detail: text } : { label: key };
      }}
      typed={isStringKey}
      typedDetail="No string yet"
      problem={table.problem}
      placeholder={
        unsetText(props.field) === "unset" ? "Pick a string key" : unsetText(props.field)
      }
      empty="No string keys in this project"
    />
  );
}
