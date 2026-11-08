import { useId, useState } from "react";

import type { Licence } from "../../../project/index";
import { Hint } from "../../kit/hint";
import { Input } from "../../kit/input";
import { MicroLabel } from "../../kit/text";
import { consoleErrors } from "./notify";
import type { LicenceFieldsProps } from "./types";

type Field = keyof Licence;

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
  onCommit,
}: {
  title: string;
  hint: string;
  placeholder: string;
  value: string;
  list?: string;
  readOnly?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    if (draft.trim() !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <div className="je-licence-field">
      <Hint content={hint}>
        <span className="je-licence-title">{title}</span>
      </Hint>
      <Input
        aria-label={title}
        placeholder={readOnly ? undefined : placeholder}
        list={list}
        readOnly={readOnly}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(null);
        }}
      />
    </div>
  );
}

/** An asset's licence, author, source and credit line, each written on Enter or blur. */
export function LicenceFields({
  entry,
  readOnly,
  onLicence,
  notify = consoleErrors,
}: LicenceFieldsProps) {
  const listId = useId();
  const editable = !readOnly && !!onLicence;
  const commit = async (field: Field, value: string) => {
    if (!onLicence) return;
    try {
      await onLicence(entry, withLicenceField(entry.licence, field, value));
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Couldn't save the licence.");
    }
  };
  return (
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
          onCommit={(value) => void commit(field, value)}
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
  );
}
