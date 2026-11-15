import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { Fragment, useState, type ReactNode } from "react";
import { z } from "zod";

import type { InspectorRow } from "../../../editor/inspector-model";
import { settingsEdit, settingsValue } from "../../../editor/settings-model";
import type { AssetKindName } from "../../../project/index";
import { LOCALE_PATTERN, localeSettingsOf } from "../../../project/kinds/strings";
import { unwrapSchema } from "../../../scene/schema";
import {
  Badge,
  Button,
  Hint,
  Icon,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from "../../kit/index";
import { useProjectView } from "../EditorProject";
import { AssetCombobox, assetOptions, danglingAsset } from "../inspector/asset-picker";
import {
  AngleField,
  asPt,
  EditError,
  FieldRow,
  isFlatRecord,
  NestedField,
  NumberField,
  OptionsField,
  PointField,
  ReadonlyField,
  RecordField,
  RecordInput,
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

/** An edit's history label: "Set Volume", or "Reset Volume" when it unsets the row. */
export const editLabel = (row: Pick<InspectorRow, "title">, value: unknown) =>
  `${value === undefined ? "Reset" : "Set"} ${row.title}`;

export type CommitRowOptions = {
  /** The rows by path, for the object holding a row. */
  rows?: ReadonlyMap<string, InspectorRow>;
  /** An unset object row's whole value before one of its fields is set (seats need both of theirs). */
  fills?: RowFallbacks;
  /** The history label in place of `editLabel`'s. */
  label?: string;
  /** Called with the value written once the edit has landed. */
  onCommitted?: (value: unknown) => void;
};

/**
 * Writes `input` into `row` as one batch: checked by the row's schema, set
 * where the doc's layout allows, and, under an unset object with a fill,
 * written as that whole object. Resolves to the problem, or null.
 */
export async function commitSettingsRow(
  doc: SettingsDoc,
  row: InspectorRow,
  input: unknown,
  opts: CommitRowOptions = {},
): Promise<string | null> {
  if (doc.readOnly !== null) return doc.readOnly;
  if (!doc.entry || !doc.value || !doc.layout) return "This file hasn't opened yet.";
  const checked = settingsValue(row, input);
  if (!checked.ok) return checked.error;
  let path = row.path;
  let value = checked.value;
  const parent = parentPath(path);
  const holder = parent ? opts.rows?.get(parent) : undefined;
  const fill = holder ? opts.fills?.[holder.path] : undefined;
  if (holder && holder.value === undefined && fill !== undefined) {
    const whole = { ...(fill as object), [row.name]: value };
    const parsed = holder.schema.safeParse(whole);
    if (!parsed.success) return parsed.error.issues[0]?.message ?? "invalid value";
    path = holder.path;
    value = whole;
  }
  const op = settingsEdit(doc.entry.id, path, value, { doc: doc.value, layout: doc.layout });
  // A refused edit is announced by the pending task.
  const landed = await doc.edit(
    [op],
    opts.label ?? editLabel(row, value),
    settingScope(doc.docName, row.path),
  );
  if (landed) opts.onCommitted?.(checked.value);
  return null;
}

const commitRow = (ctx: RowsCtx, row: InspectorRow, input: unknown) =>
  commitSettingsRow(ctx.doc, row, input, { rows: ctx.rows, fills: ctx.fills });

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
    disabled: ctx.doc.readOnly !== null,
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

/** game-settings' locales block, which `LocalesRow` draws. */
export const LOCALES_PATH = "engine.locales";

const FONT_KINDS: readonly AssetKindName[] = ["font"];

type LocaleSettings = ReturnType<typeof localeSettingsOf>;

/** A locale entry's key and its control, the key in a column of its own. */
function LocaleEntry({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="je-insp-row je-locale-entry" data-gap="tight">
      <span className="je-locale-key je-sp-truncate">{name}</span>
      {children}
    </div>
  );
}

/** The record a keyed edit leaves: `key` set, or dropped when `value` is undefined; undefined once empty. */
function withEntry<T>(
  record: Readonly<Record<string, T>> | undefined,
  key: string,
  value: T | undefined,
): Record<string, T> | undefined {
  const next: Record<string, T> = { ...record };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length > 0 ? next : undefined;
}

const badTag = (tags: readonly string[]) => tags.find((t) => !LOCALE_PATTERN.test(t));
const tagProblem = (tag: string) => `"${tag}" isn't a locale tag such as en or pt-BR.`;
const splitTags = (text: string) => text.split(/[\s,]+/).filter(Boolean);

/** The offered locales as chips, each removable but the default, and a box to add more. */
function AvailableLocales({
  row,
  ctx,
  locales,
}: {
  row: InspectorRow;
  ctx: RowsCtx;
  locales: LocaleSettings;
}) {
  const { error, setError, commit } = useCommit(ctx, row);
  const [draft, setDraft] = useState("");
  const add = () => {
    const tags = splitTags(draft);
    if (tags.length === 0) return;
    const bad = badTag(tags);
    if (bad !== undefined) return setError(tagProblem(bad));
    setDraft("");
    const next = [...new Set([...locales.available, ...tags])];
    if (next.length > locales.available.length) commit(next);
  };
  return (
    <FieldRow field={row} scope={settingScope(ctx.doc.docName, row.path)} error={error}>
      <div className="je-insp-row je-insp-wrap" data-gap="tight">
        {locales.available.map((tag) =>
          tag === locales.default ? (
            <Hint
              key={tag}
              content="The default is always offered: pick another default to remove it."
            >
              <Badge variant="secondary" tabIndex={0}>
                {tag} (default)
              </Badge>
            </Hint>
          ) : (
            <Button
              key={tag}
              size="xs"
              variant="secondary"
              aria-label={`Remove the locale ${tag}`}
              onClick={() => commit(locales.available.filter((t) => t !== tag))}
            >
              {tag}
              <Icon icon={Cancel01Icon} size={12} />
            </Button>
          ),
        )}
        <Input
          aria-label={row.path}
          placeholder="Add a locale, e.g. fr"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Escape") setDraft("");
          }}
          onBlur={add}
          className="je-insp-tag-input"
        />
      </div>
    </FieldRow>
  );
}

/** The default locale, one of those offered. */
function DefaultLocale({
  row,
  ctx,
  locales,
}: {
  row: InspectorRow;
  ctx: RowsCtx;
  locales: LocaleSettings;
}) {
  const { error, commit } = useCommit(ctx, row);
  return (
    <FieldRow field={row} scope={settingScope(ctx.doc.docName, row.path)} error={error}>
      <Select
        value={locales.default}
        onValueChange={(next) => {
          if (typeof next === "string" && next !== locales.default) commit(next);
        }}
      >
        <SelectTrigger size="sm" aria-label={row.path}>
          <SelectValue>{locales.default}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {locales.available.map((tag) => (
            <SelectItem key={tag} value={tag}>
              {tag}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}

/** Each offered locale's fallback chain before the default, as a typed list. */
function FallbackChains({
  row,
  ctx,
  locales,
}: {
  row: InspectorRow;
  ctx: RowsCtx;
  locales: LocaleSettings;
}) {
  const { error, setError, commit } = useCommit(ctx, row);
  const chains = locales.fallback ?? {};
  const keys = [
    ...new Set([...locales.available.filter((l) => l !== locales.default), ...Object.keys(chains)]),
  ];
  const write = (key: string, text: string) => {
    const tags = splitTags(text);
    const bad = badTag(tags);
    if (bad !== undefined) return setError(tagProblem(bad));
    commit(withEntry(chains, key, tags.length > 0 ? tags : undefined));
  };
  return (
    <FieldRow field={row} scope={settingScope(ctx.doc.docName, row.path)} error={error}>
      {keys.length === 0 ? (
        <span className="je-insp-line je-insp-muted">
          none: every locale falls back to the default
        </span>
      ) : (
        <div className="je-insp-stack" data-gap="tight" role="group" aria-label={row.path}>
          {keys.map((key) => (
            <LocaleEntry key={key} name={key}>
              <RecordInput
                label={`${row.path}.${key}`}
                value={(chains[key] ?? []).join(", ")}
                placeholder="none"
                onCommit={(text) => write(key, text)}
              />
            </LocaleEntry>
          ))}
        </div>
      )}
    </FieldRow>
  );
}

/** The font each locale draws in, "default" first, each picked from the project's fonts. */
function LocaleFonts({
  row,
  ctx,
  locales,
}: {
  row: InspectorRow;
  ctx: RowsCtx;
  locales: LocaleSettings;
}) {
  const { error, commit } = useCommit(ctx, row);
  const options = assetOptions(useProjectView(ctx.doc.session), FONT_KINDS);
  const fonts = locales.fonts ?? {};
  const keys = [...new Set(["default", ...locales.available, ...Object.keys(fonts)])];
  const dangling = keys
    .map((key) => danglingAsset(fonts[key], options, FONT_KINDS))
    .find((p) => p !== null);
  return (
    <FieldRow
      field={row}
      scope={settingScope(ctx.doc.docName, row.path)}
      error={error ?? dangling ?? null}
    >
      <div className="je-insp-stack" data-gap="tight" role="group" aria-label={row.path}>
        {keys.map((key) => (
          <LocaleEntry key={key} name={key}>
            <AssetCombobox
              path={`${row.path}.${key}`}
              kinds={FONT_KINDS}
              options={options}
              value={fonts[key]}
              mixed={false}
              optional
              invalid={danglingAsset(fonts[key], options, FONT_KINDS) !== null}
              placeholder={key === "default" ? "The engine's font" : "The default font"}
              onPick={(id) => commit(withEntry(fonts, key, id))}
            />
          </LocaleEntry>
        ))}
      </div>
    </FieldRow>
  );
}

type LocaleFields = Record<"available" | "default" | "fallback" | "fonts", InspectorRow>;

/** The locales block's field rows, or null when it isn't that block or lacks one of them. */
function localeFields(row: InspectorRow): LocaleFields | null {
  if (row.path !== LOCALES_PATH || row.widget.kind !== "object") return null;
  const child = (name: string) => row.children?.find((c) => c.name === name);
  const available = child("available");
  const defaultRow = child("default");
  const fallback = child("fallback");
  const fonts = child("fonts");
  return available && defaultRow && fallback && fonts
    ? { available, default: defaultRow, fallback, fonts }
    : null;
}

/**
 * The game's locales: the offered ones as chips, the default as a pick of
 * them, fallback chains per locale and a font picker per locale. Before the
 * block exists, the first edit writes it whole over the locales the game
 * plays in now.
 */
function LocalesRow({
  row,
  fields: { available, default: defaultRow, fallback, fonts },
  ctx,
}: {
  row: InspectorRow;
  fields: LocaleFields;
  ctx: RowsCtx;
}) {
  const locales = localeSettingsOf(row.value);
  const inner: RowsCtx = {
    ...ctx,
    fills: {
      ...ctx.fills,
      [row.path]: { default: locales.default, available: locales.available },
    },
  };
  return (
    <NestedField field={row}>
      <AvailableLocales row={available} ctx={inner} locales={locales} />
      <DefaultLocale row={defaultRow} ctx={inner} locales={locales} />
      <FallbackChains row={fallback} ctx={inner} locales={locales} />
      <LocaleFonts row={fonts} ctx={inner} locales={locales} />
    </NestedField>
  );
}

function RowView({ row, ctx }: { row: InspectorRow; ctx: RowsCtx }) {
  const locales = localeFields(row);
  if (locales) return <LocalesRow row={row} fields={locales} ctx={ctx} />;
  const axes = row.widget.kind === "readonly" ? unionAxes(row.schema) : null;
  if (axes) return <AxesRow row={row} ctx={ctx} axes={axes} />;
  const props = widgetProps(ctx, row);
  if (isFlatRecord(row)) return <RecordField {...props} />;
  const readonly = <ReadonlyField field={row} unset={props.unset} />;
  if (row.readonly) return readonly;
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
