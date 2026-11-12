import { useId, useState } from "react";

import type { Licence } from "../../../project/index";
import { Hint } from "../../kit/hint";
import { Input } from "../../kit/input";
import { Spinner } from "../../kit/spinner";
import { MicroLabel } from "../../kit/text";
import { PendingProvider, useBusy } from "../../pending/use-pending";
import { consoleErrors } from "./notify";
import { licenceScope, runOp, useTreePending } from "./tree-pending";
import type { LicenceFieldsProps } from "./types";

type Field = keyof Licence;

const messageOf = (err: unknown) =>
  err instanceof Error && err.message ? err.message : "The project refused it.";

const FIELDS: readonly { field: Field; title: string; hint: string; placeholder: string }[] = [
  {
    field: "spdx",
    title: "Licence",
    hint: 'An SPDX id such as "CC-BY-4.0", or "proprietary".',
    placeholder: "CC0-1.0",
  },
  { field: "author", title: "Author", hint: "Who made it.", placeholder: "Name or handle" },
  {
    field: "source",
    title: "Source",
    hint: "Where it came from: a URL or a description.",
    placeholder: "https://…",
  },
  {
    field: "attribution",
    title: "Credit",
    hint: "The exact credit line the licence asks for; the credits page prints it.",
    placeholder: "“Sprite” by Ana, CC-BY-4.0",
  },
];

/** Licences people often pick for game assets, offered as suggestions. */
const COMMON_SPDX = [
  "CC0-1.0",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "OFL-1.1",
  "MIT",
  "proprietary",
] as const;

/** `licence` with `field` set to `value`, or unset when it's blank; null when nothing is left. */
export function withLicenceField(
  licence: Licence | undefined,
  field: Field,
  value: string,
): Licence | null {
  const next: Licence = { ...licence };
  const trimmed = value.trim();
  if (trimmed) next[field] = trimmed;
  else delete next[field];
  return Object.keys(next).length > 0 ? next : null;
}

function LicenceField({
  title,
  hint,
  placeholder,
  value,
  list,
  readOnly,
  scope,
  onCommit,
}: {
  title: string;
  hint: string;
  placeholder: string;
  value: string;
  list?: string;
  readOnly?: boolean;
  /** The pending scope its write runs in. */
  scope: string;
  /** Resolves with the refusal's message, or null once written. */
  onCommit: (value: string) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useBusy(scope) !== undefined;
  const errorId = useId();
  const commit = async () => {
    if (draft === null || saving) return;
    if (draft.trim() === value) {
      setDraft(null);
      return;
    }
    setError(null);
    const refused = await onCommit(draft);
    setError(refused);
    // A refused value stays in the field, to fix or Escape.
    if (refused === null) setDraft(null);
  };
  return (
    <div className="je-licence-field" data-busy={saving ? "" : undefined}>
      <Hint content={hint}>
        <span className="je-licence-title">{title}</span>
      </Hint>
      <span className="je-licence-input">
        <Input
          aria-label={title}
          aria-busy={saving || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={readOnly ? undefined : placeholder}
          list={list}
          readOnly={readOnly}
          value={draft ?? value}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") {
              setDraft(null);
              setError(null);
            }
          }}
        />
        {saving ? (
          <span className="je-licence-status" role="status">
            <Spinner size={12} label={null} />
            Saving…
          </span>
        ) : null}
      </span>
      {error ? (
        <span id={errorId} role="alert" className="je-licence-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * An asset's licence, author, source and credit line, each written on Enter
 * or blur as a pending task: the field says "Saving…" until the write
 * settles, and shows a refusal under it.
 */
export function LicenceFields({
  entry,
  readOnly,
  onLicence,
  notify = consoleErrors,
}: LicenceFieldsProps) {
  const listId = useId();
  const pending = useTreePending(notify);
  const editable = !readOnly && !!onLicence;
  const commit = async (field: Field, title: string, value: string) => {
    if (!onLicence) return null;
    const scope = licenceScope(entry, field);
    const result = await runOp(
      pending,
      {
        id: scope,
        scope,
        label: `Saving the ${title.toLowerCase()}`,
        fallback: `Couldn't save the ${title.toLowerCase()}`,
      },
      () => onLicence(entry, withLicenceField(entry.licence, field, value)),
    );
    return result.ok ? null : messageOf(result.error);
  };
  return (
    <PendingProvider pending={pending}>
      <section aria-label="Licence" className="je-licence">
        <MicroLabel>Licence</MicroLabel>
        {FIELDS.map(({ field, title, hint, placeholder }) => (
          <LicenceField
            key={`${entry.key}:${field}`}
            title={title}
            hint={hint}
            placeholder={placeholder}
            value={entry.licence?.[field] ?? ""}
            list={field === "spdx" && editable ? listId : undefined}
            readOnly={!editable}
            scope={licenceScope(entry, field)}
            onCommit={(value) => commit(field, title, value)}
          />
        ))}
        {editable ? (
          <datalist id={listId}>
            {COMMON_SPDX.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        ) : null}
      </section>
    </PendingProvider>
  );
}
