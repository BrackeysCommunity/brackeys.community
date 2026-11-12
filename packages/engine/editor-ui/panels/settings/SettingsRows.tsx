import { Fragment, useState, type ReactNode } from "react";
import { z } from "zod";

import type { InspectorRow } from "../../../editor/inspector-model";
import { settingsEdit, settingsValue } from "../../../editor/settings-model";
import { unwrapSchema } from "../../../scene/schema";
import { Input, Text } from "../../kit/index";
import {
  AngleField,
  asPt,
  EditError,
  FieldRow,
  NestedField,
  NumberField,
  OptionsField,
  PointField,
  ReadonlyField,
  SwitchField,
  TextField,
} from "../inspector/field-widgets";
import { settingScope, type SettingsDoc } from "./settings-doc";

/** What an unset row shows in its place: the value it falls back to, in words. */
export type RowFallbacks = Readonly<Record<string, unknown>>;

type RowsCtx = {
  doc: SettingsDoc;
  fallbacks: RowFallbacks;
  /** An unset object row's whole value before one of its fields is set (seats need both of theirs). */
  fills: RowFallbacks;
  rows: ReadonlyMap<string, InspectorRow>;
};

const fallbackText = (row: InspectorRow, fallbacks: RowFallbacks): string => {
  const given = fallbacks[row.path];
  const value = given !== undefined ? given : row.defaultValue;
  if (value === undefined) return row.placeholder ?? "unset";
  return `${typeof value === "string" ? value : JSON.stringify(value)} (default)`;
};

const parentPath = (path: string) => {
  const at = path.lastIndexOf(".");
  return at < 0 ? null : path.slice(0, at);
};

/**
 * Writes `input` into `row` as one batch: checked by the row's schema, set
 * where the doc's layout allows, and, under an unset object with a fill,
 * written as that whole object. Resolves to the problem, or null.
 */
async function commitRow(ctx: RowsCtx, row: InspectorRow, input: unknown): Promise<string | null> {
  const { doc } = ctx;
  if (!doc.entry || !doc.value || !doc.layout) return "The settings haven't opened yet.";
  const checked = settingsValue(row, input);
  if (!checked.ok) return checked.error;
  let path = row.path;
  let value = checked.value;
  const parent = parentPath(path);
  const holder = parent ? ctx.rows.get(parent) : undefined;
  if (holder && holder.value === undefined && ctx.fills[holder.path] !== undefined) {
    const whole = { ...(ctx.fills[holder.path] as object), [row.name]: value };
    const parsed = holder.schema.safeParse(whole);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "invalid value";
    path = holder.path;
    value = whole;
  }
  const op = settingsEdit(doc.entry.id, path, value, { doc: doc.value, layout: doc.layout });
  // A refused edit is announced by the pending task.
  await doc.edit(
    [op],
    `${value === undefined ? "Reset" : "Set"} ${row.title}`,
    settingScope(doc.docName, row.path),
  );
  return null;
}

function useCommit(ctx: RowsCtx, row: InspectorRow) {
  const [error, setError] = useState<string | null>(null);
  const commit = (input: unknown) => {
    void commitRow(ctx, row, input).then(setError);
  };
  return { error, setError, commit };
}

/** What every shared widget takes for a row: its commit, its fallback in words and its busy scope. */
function widgetProps(ctx: RowsCtx, row: InspectorRow) {
  return {
    field: row,
    commit: (input: unknown) => commitRow(ctx, row, input),
    unset: fallbackText(row, ctx.fallbacks),
    scope: settingScope(ctx.doc.docName, row.path),
  };
}

const fallbackOf = (ctx: RowsCtx, row: InspectorRow) => ctx.fallbacks[row.path] ?? row.defaultValue;

type Axis = { key: string; schema: z.ZodType; unit?: string };

/**
 * The fields of a union of objects whose every field is a number, each key
 * once in the order first given: a size whose axes may each be left out
 * (a resolution's virtual width and height). Null for any other schema.
 */
function unionAxes(schema: z.ZodType): Axis[] | null {
  const inner = unwrapSchema(schema);
  if (!(inner instanceof z.ZodUnion)) return null;
  const axes = new Map<string, Axis>();
  for (const option of inner.options) {
    const object = unwrapSchema(option as z.ZodType);
    if (!(object instanceof z.ZodObject)) return null;
    for (const [key, field] of Object.entries(object.shape)) {
      if (!(unwrapSchema(field as z.ZodType) instanceof z.ZodNumber)) return null;
      if (axes.has(key)) continue;
      const unit = (field as z.ZodType).meta()?.unit;
      axes.set(key, {
        key,
        schema: field as z.ZodType,
        ...(typeof unit === "string" ? { unit } : {}),
      });
    }
  }
  return axes.size > 0 ? [...axes.values()] : null;
}

const recordOf = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

/** A size whose axes may each be blank (`unionAxes`): the axes given commit as one object. */
function AxesRow({ row, ctx, axes }: { row: InspectorRow; ctx: RowsCtx; axes: Axis[] }) {
  const { error, setError, commit } = useCommit(ctx, row);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const value = recordOf(row.value);
  const fallback = recordOf(ctx.fallbacks[row.path] ?? row.defaultValue);
  const unit = axes.find((a) => a.unit)?.unit;
  const shown = (key: string) => (typeof value?.[key] === "number" ? String(value[key]) : "");
  const run = () => {
    if (Object.keys(draft).length === 0) return;
    const base = value ?? fallback ?? {};
    const next: Record<string, number> = {};
    for (const { key, schema } of axes) {
      const text = draft[key];
      const given = text === undefined ? base[key] : text.trim() === "" ? undefined : text.trim();
      if (given === undefined) continue;
      const n = Number(given);
      const checked = schema.safeParse(n);
      if (!checked.success) {
        setDraft({});
        return setError(`${key}: ${checked.error.issues[0]?.message ?? "invalid value"}`);
      }
      next[key] = n;
    }
    setDraft({});
    if (Object.keys(next).length === 0) {
      if (row.optional) commit(undefined);
      else setError(`${row.title} needs a ${axes.map((a) => a.key).join(" or ")}.`);
      return;
    }
    commit(next);
  };
  return (
    <FieldRow field={row} scope={settingScope(ctx.doc.docName, row.path)} error={error}>
      <div className="je-insp-row" data-gap="tight">
        {axes.map(({ key }, i) => (
          <Fragment key={key}>
            {i > 0 ? (
              <span className="je-insp-suffix" aria-hidden>
                ×
              </span>
            ) : null}
            <Input
              aria-label={`${row.path}.${key}`}
              inputMode="decimal"
              placeholder={
                value === undefined && typeof fallback?.[key] === "number"
                  ? String(fallback[key])
                  : "auto"
              }
              value={draft[key] ?? shown(key)}
              onChange={(e) => {
                const text = e.target.value;
                setDraft((d) => ({ ...d, [key]: text }));
              }}
              onBlur={run}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
                else if (e.key === "Escape") {
                  setDraft({});
                  setError(null);
                }
              }}
            />
          </Fragment>
        ))}
        {unit ? <span className="je-insp-suffix">{unit}</span> : null}
      </div>
    </FieldRow>
  );
}

function RowView({ row, ctx }: { row: InspectorRow; ctx: RowsCtx }) {
  const axes = row.widget.kind === "readonly" ? unionAxes(row.schema) : null;
  if (axes) return <AxesRow row={row} ctx={ctx} axes={axes} />;
  const readonly = <ReadonlyField field={row} unset={fallbackText(row, ctx.fallbacks)} />;
  if (row.readonly) return readonly;
  const props = widgetProps(ctx, row);
  switch (row.widget.kind) {
    case "number":
      return <NumberField {...props} />;
    case "angle":
      return <AngleField {...props} />;
    case "text":
      return <TextField {...props} />;
    case "segmented":
    case "select":
      return (
        <OptionsField
          {...props}
          options={row.widget.options}
          segmented={row.widget.kind === "segmented"}
        />
      );
    case "switch":
      return <SwitchField {...props} fallback={fallbackOf(ctx, row) === true} />;
    case "point": {
      const fallback = asPt(fallbackOf(ctx, row));
      return (
        <PointField
          field={row}
          scope={props.scope}
          {...(fallback ? { fallback } : {})}
          commitEach={(next) => {
            const value = next(row.value);
            return value instanceof EditError ? value.message : props.commit(value);
          }}
        />
      );
    }
    case "object":
      return row.children ? (
        <NestedField field={row}>
          {row.children.map((child) => (
            <RowView key={child.path} row={child} ctx={ctx} />
          ))}
        </NestedField>
      ) : (
        readonly
      );
    default:
      return readonly;
  }
}

function indexRows(rows: readonly InspectorRow[], into = new Map<string, InspectorRow>()) {
  for (const row of rows) {
    into.set(row.path, row);
    if (row.children) indexRows(row.children, into);
  }
  return into;
}

/**
 * `settingsRows`' rows as the panels draw them, each edit one `settingsEdit`
 * through the project session. A read-only doc shows them disabled.
 */
export function SettingsRows({
  doc,
  rows,
  fallbacks = {},
  fills = {},
}: {
  doc: SettingsDoc;
  rows: readonly InspectorRow[];
  /** By row path: what an unset row falls back to (the game's value). */
  fallbacks?: RowFallbacks;
  fills?: RowFallbacks;
}) {
  const ctx: RowsCtx = { doc, fallbacks, fills, rows: indexRows(rows) };
  if (rows.length === 0) return null;
  return (
    <fieldset disabled={doc.readOnly !== null} style={{ display: "contents" }}>
      <div className="je-insp-stack">
        {rows.map((row) => (
          <RowView key={row.path} row={row} ctx={ctx} />
        ))}
      </div>
    </fieldset>
  );
}

/** A panel's note: why it is empty, or read-only. */
export function SettingsNote({ children }: { children: ReactNode }) {
  return (
    <Text as="p" size="xs" variant="muted" className="je-panel-empty">
      {children}
    </Text>
  );
}
