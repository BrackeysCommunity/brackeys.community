import {
  lookupRef,
  type EditorSession,
  type RefTarget,
  type SceneOp,
  type ShapeTuple,
} from "@jams/engine/editor";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { MicroLabel } from "@/components/ui/typography";

import { useEditorDoc, useEditorStore } from "./use-editor-store";

type Field = {
  key: string;
  label: string;
  value: number;
  /** Whole numbers only. */
  integer: boolean;
  min?: number;
  /** `min` itself is out of range. */
  exclusive?: boolean;
  toOp: (n: number) => SceneOp;
};

type Section = { title: string; fields: Field[]; note?: string };

const SHAPE_FIELDS: Record<string, { name: string; size?: boolean }[]> = {
  box: [
    { name: "cx" },
    { name: "cy" },
    { name: "hw", size: true },
    { name: "hh", size: true },
    { name: "rotDeg" },
  ],
  circle: [{ name: "cx" }, { name: "cy" }, { name: "r", size: true }],
  capsule: [
    { name: "cx" },
    { name: "cy" },
    { name: "halfLen", size: true },
    { name: "r", size: true },
    { name: "rotDeg" },
  ],
};

function shapeSection(ref: string, tuple: ShapeTuple, title = "Shape"): Section {
  const spec = SHAPE_FIELDS[tuple[0]];
  if (!spec) return { title, fields: [], note: `${tuple[0]} · ${(tuple.length - 1) / 2} points` };
  return {
    title: `${title} · ${tuple[0]}`,
    fields: spec.map(({ name, size }, i) => ({
      key: `shape.${name}`,
      label: name,
      value: (tuple[i + 1] as number | undefined) ?? 0,
      integer: true,
      min: size ? 0 : undefined,
      exclusive: size,
      toOp: (n) => {
        const next = [...tuple] as (string | number)[];
        next[i + 1] = n;
        return { op: "update", ref, set: { shape: next } };
      },
    })),
  };
}

function pointFields(
  key: string,
  at: [number, number],
  toOp: (p: [number, number]) => SceneOp,
): Field[] {
  return [
    { key: `${key}.x`, label: "x", value: at[0], integer: true, toOp: (n) => toOp([n, at[1]]) },
    { key: `${key}.y`, label: "y", value: at[1], integer: true, toOp: (n) => toOp([at[0], n]) },
  ];
}

function sectionsFor(target: RefTarget): Section[] {
  const ref = target.ref;
  if (target.kind === "bulk") {
    if (target.key === "anchor") {
      const at = target.value as [number, number];
      return [
        {
          title: "Position",
          fields: pointFields("at", at, (p) => ({ op: "update", ref, set: { at: p } })),
        },
      ];
    }
    return [shapeSection(ref, target.value as ShapeTuple)];
  }
  const e = target.entity;
  const sections: Section[] = [];
  if ("at" in e) {
    sections.push({
      title: "Position",
      fields: pointFields("at", e.at, (p) => ({ op: "update", ref, set: { at: p } })),
    });
  }
  if (e.b === "construct") {
    sections.push({
      title: "Rotation",
      fields: [
        {
          key: "rot",
          label: "deg",
          value: e.rot ?? 0,
          integer: true,
          toOp: (n) => ({ op: "update", ref, set: { rot: n } }),
        },
      ],
    });
  }
  if ("shape" in e)
    sections.push(shapeSection(ref, e.shape, e.b === "mover" ? "Shape (local)" : "Shape"));
  if (e.b === "mover") {
    sections.push({
      title: `Path · ${e.path.mode}`,
      fields: [
        {
          key: "path.speed",
          label: "speed",
          value: e.path.speed,
          integer: false,
          min: 0,
          exclusive: true,
          toOp: (n) => ({ op: "update", ref, set: { "path.speed": n } }),
        },
        {
          key: "path.pauseMs",
          label: "pause ms",
          value: e.path.pauseMs ?? 0,
          integer: true,
          min: 0,
          toOp: (n) => ({ op: "update", ref, set: { "path.pauseMs": n } }),
        },
        ...e.path.pts.flatMap((pt, i) =>
          pointFields(`path.pts.${i}`, pt, (p) => ({
            op: "update",
            ref,
            set: { [`path.pts.${i}`]: p },
          })).map((f) => ({ ...f, label: `${i} ${f.label}` })),
        ),
      ],
    });
  }
  if (e.b === "prop") {
    sections.push({
      title: "Physics",
      fields: [
        {
          key: "density",
          label: "density",
          value: e.density,
          integer: false,
          min: 0,
          exclusive: true,
          toOp: (n) => ({ op: "update", ref, set: { density: n } }),
        },
        {
          key: "restitution",
          label: "restitution",
          value: e.restitution,
          integer: false,
          min: 0,
          toOp: (n) => ({ op: "update", ref, set: { restitution: n } }),
        },
      ],
    });
  }
  return sections;
}

function problemWith(field: Field, n: number): string | null {
  if (!Number.isFinite(n)) return "Enter a number.";
  if (field.integer && !Number.isInteger(n)) return "Whole pixels only.";
  if (field.min !== undefined && (field.exclusive ? n <= field.min : n < field.min)) {
    return field.exclusive ? `Must be above ${field.min}.` : `Must be ${field.min} or more.`;
  }
  return null;
}

function NumberField({ session, field }: { session: EditorSession; field: Field }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const n = draft.trim() === "" ? Number.NaN : Number(draft);
    const problem = problemWith(field, n);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setDraft(null);
    if (n === field.value) return;
    const result = session.dispatch({ ops: [field.toOp(n)] });
    if (!result.ok) setError(result.issue.message);
  };

  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{field.label}</span>
      <Input
        inputMode="decimal"
        aria-label={field.key}
        aria-invalid={error ? true : undefined}
        value={draft ?? String(field.value)}
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
      {error ? <span className="text-destructive">{error}</span> : null}
    </label>
  );
}

export function EditorInspector({ session }: { session: EditorSession }) {
  const selection = useEditorStore(session, (s) => s.selection);
  const doc = useEditorDoc(session);

  if (selection.length === 0) {
    return (
      <p className="px-2 py-1 text-xs text-muted-foreground">Select something in the outliner.</p>
    );
  }
  if (selection.length > 1) {
    return <p className="px-2 py-1 text-xs text-muted-foreground">{selection.length} selected</p>;
  }
  const target = lookupRef(doc, selection[0]!);
  if (!target) return null;

  const behavior = target.kind === "entity" ? target.entity.b : target.key;
  return (
    <div className="flex w-full flex-col gap-3 p-2" aria-label="Inspector">
      <section className="flex flex-col gap-1">
        <MicroLabel>Identity</MicroLabel>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">id</dt>
          <dd className="truncate">{target.ref}</dd>
          <dt className="text-muted-foreground">behavior</dt>
          <dd>{behavior}</dd>
        </dl>
      </section>
      {sectionsFor(target).map((section) => (
        <section key={section.title} className="flex flex-col gap-1.5">
          <MicroLabel>{section.title}</MicroLabel>
          {section.note ? <p className="text-xs text-muted-foreground">{section.note}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            {section.fields.map((field) => (
              <NumberField
                key={`${target.ref}:${field.key}:${field.value}`}
                session={session}
                field={field}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
