import { useState, type ReactNode } from "react";

import type { InspectorRow } from "../../../editor/inspector-model";
import { settingsEdit, settingsValue } from "../../../editor/settings-model";
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
  Text,
} from "../../kit/index";
import { useBusy } from "../../pending/use-pending";
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

/** A setting's label and control; a spinner beside the label while its edit lands. */
export function SettingRow({
  title,
  hint,
  scope,
  error,
  children,
}: {
  title: string;
  hint?: string;
  scope?: string;
  error?: string | null;
  children: ReactNode;
}) {
  const task = useBusy(scope ?? "");
  const busy = scope !== undefined && task !== undefined;
  return (
    <div className="je-insp-field" aria-busy={busy || undefined}>
      <div className="je-insp-field-label">
        <Hint content={hint} disabled={!hint}>
          <span className="je-insp-field-title">{title}</span>
        </Hint>
        {busy ? <Spinner size={11} label={null} /> : null}
      </div>
      <div className="je-insp-field-control">
        {children}
        {error ? <span className="je-insp-error">{error}</span> : null}
      </div>
    </div>
  );
}

function rowProps(ctx: RowsCtx, row: InspectorRow) {
  return {
    title: row.title,
    ...(row.description ? { hint: row.description } : {}),
    scope: settingScope(ctx.doc.docName, row.path),
  };
}

function TextDraft({
  row,
  ctx,
  numeric,
  label = row.path,
}: {
  row: InspectorRow;
  ctx: RowsCtx;
  numeric: boolean;
  label?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { error, setError, commit } = useCommit(ctx, row);
  const shown =
    typeof row.value === "number" || typeof row.value === "string" ? String(row.value) : "";
  const run = () => {
    if (draft === null) return;
    commit(draft.trim() === "" && row.optional ? undefined : draft);
    setDraft(null);
  };
  const unit = "unit" in row.widget ? row.widget.unit : undefined;
  return (
    <SettingRow {...rowProps(ctx, row)} error={error}>
      <div className="je-insp-row" data-gap="tight">
        <Input
          aria-label={label}
          inputMode={numeric ? "decimal" : undefined}
          aria-invalid={error ? true : undefined}
          placeholder={row.value === undefined ? fallbackText(row, ctx.fallbacks) : undefined}
          value={draft ?? shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={run}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
            else if (e.key === "Escape") {
              setDraft(null);
              setError(null);
            }
          }}
        />
        {unit ? <span className="je-insp-suffix">{unit}</span> : null}
      </div>
    </SettingRow>
  );
}

function OptionsRow({ row, ctx }: { row: InspectorRow; ctx: RowsCtx }) {
  const { error, commit } = useCommit(ctx, row);
  const w = row.widget as Extract<InspectorRow["widget"], { options: unknown }>;
  const current =
    typeof row.value === "string" || typeof row.value === "number" ? String(row.value) : "";
  const pick = (key: string) => {
    if (key === current && row.optional) return commit(undefined);
    const option = w.options.find((o) => String(o.value) === key);
    if (option) commit(option.value);
    else if (key === "" && row.optional) commit(undefined);
  };
  return (
    <SettingRow {...rowProps(ctx, row)} error={error}>
      {w.kind === "segmented" ? (
        <div className="je-insp-row" data-gap="tight">
          <SegmentedControl
            size="xs"
            aria-label={row.path}
            value={current}
            emitOnReselect={row.optional}
            onChange={pick}
            className="je-insp-wrap"
          >
            {w.options.map((o) => (
              <SegmentedControl.Item key={String(o.value)} value={String(o.value)}>
                {o.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
          {row.value === undefined ? (
            <span className="je-insp-muted">{fallbackText(row, ctx.fallbacks)}</span>
          ) : null}
        </div>
      ) : (
        <Select value={current} onValueChange={(v) => pick(typeof v === "string" ? v : "")}>
          <SelectTrigger size="sm" aria-label={row.path}>
            <SelectValue>
              {w.options.find((o) => String(o.value) === current)?.label ??
                fallbackText(row, ctx.fallbacks)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {row.optional ? <SelectItem value="">unset</SelectItem> : null}
            {w.options.map((o) => (
              <SelectItem key={String(o.value)} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </SettingRow>
  );
}

function SwitchRow({ row, ctx }: { row: InspectorRow; ctx: RowsCtx }) {
  const { error, commit } = useCommit(ctx, row);
  const fallback = ctx.fallbacks[row.path] ?? row.defaultValue;
  const on = row.value === undefined ? fallback === true : row.value === true;
  return (
    <SettingRow {...rowProps(ctx, row)} error={error}>
      <div className="je-insp-row je-insp-line">
        <Switch aria-label={row.path} checked={on} onCheckedChange={(next) => commit(next)} />
        {row.value === undefined ? (
          <span className="je-insp-muted">{fallbackText(row, ctx.fallbacks)}</span>
        ) : null}
      </div>
    </SettingRow>
  );
}

const pairOf = (v: unknown): [number, number] | undefined =>
  Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number"
    ? [v[0], v[1]]
    : undefined;

/** A number pair (gravity): x and y, each committing the pair whole. */
function PairRow({ row, ctx }: { row: InspectorRow; ctx: RowsCtx }) {
  const { error, setError, commit } = useCommit(ctx, row);
  const [draft, setDraft] = useState<[string | null, string | null]>([null, null]);
  const value = pairOf(row.value);
  const fallback = pairOf(ctx.fallbacks[row.path] ?? row.defaultValue);
  const unit = "unit" in row.widget ? row.widget.unit : undefined;
  const run = () => {
    if (draft[0] === null && draft[1] === null) return;
    const base = value ?? fallback ?? [0, 0];
    const read = (i: 0 | 1) => {
      const text = draft[i];
      return text === null ? base[i] : Number(text.trim());
    };
    const next = [read(0), read(1)];
    setDraft([null, null]);
    if (next.some((n) => !Number.isFinite(n))) return setError("Both parts are numbers.");
    commit(next);
  };
  const axis = (i: 0 | 1, name: string) => (
    <Input
      aria-label={`${row.path}.${name}`}
      inputMode="decimal"
      placeholder={value === undefined && fallback ? String(fallback[i]) : undefined}
      value={draft[i] ?? (value ? String(value[i]) : "")}
      onChange={(e) => {
        const text = e.target.value;
        setDraft((d) => (i === 0 ? [text, d[1]] : [d[0], text]));
      }}
      onBlur={run}
      onKeyDown={(e) => {
        if (e.key === "Enter") run();
        else if (e.key === "Escape") setDraft([null, null]);
      }}
    />
  );
  return (
    <SettingRow {...rowProps(ctx, row)} error={error}>
      <div className="je-insp-row" data-gap="tight">
        {axis(0, "x")}
        {axis(1, "y")}
        {unit ? <span className="je-insp-suffix">{unit}</span> : null}
      </div>
    </SettingRow>
  );
}

function ReadonlyRow({ row, ctx }: { row: InspectorRow; ctx: RowsCtx }) {
  const text =
    row.value === undefined
      ? fallbackText(row, ctx.fallbacks)
      : typeof row.value === "string"
        ? row.value
        : JSON.stringify(row.value);
  return (
    <SettingRow title={row.title} {...(row.description ? { hint: row.description } : {})}>
      <span className="je-insp-line je-sp-truncate">{text}</span>
    </SettingRow>
  );
}

function NestedRows({ row, ctx }: { row: InspectorRow; ctx: RowsCtx }) {
  return (
    <div className="je-insp-stack">
      <Hint content={row.description} disabled={!row.description}>
        <span className="je-insp-nested-title">{row.title}</span>
      </Hint>
      <div className="je-insp-stack je-insp-nested">
        {(row.children ?? []).map((child) => (
          <RowView key={child.path} row={child} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function RowView({ row, ctx }: { row: InspectorRow; ctx: RowsCtx }) {
  if (row.readonly) return <ReadonlyRow row={row} ctx={ctx} />;
  switch (row.widget.kind) {
    case "number":
    case "angle":
      return <TextDraft row={row} ctx={ctx} numeric />;
    case "text":
      return <TextDraft row={row} ctx={ctx} numeric={false} />;
    case "segmented":
    case "select":
      return <OptionsRow row={row} ctx={ctx} />;
    case "switch":
      return <SwitchRow row={row} ctx={ctx} />;
    case "point":
      return <PairRow row={row} ctx={ctx} />;
    case "object":
      return row.children ? (
        <NestedRows row={row} ctx={ctx} />
      ) : (
        <ReadonlyRow row={row} ctx={ctx} />
      );
    default:
      return <ReadonlyRow row={row} ctx={ctx} />;
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
