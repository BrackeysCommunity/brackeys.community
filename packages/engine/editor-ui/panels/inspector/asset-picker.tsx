import { assetInfo, type AssetKindName, type ProjectView } from "../../../project/index";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  MicroLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../kit/index";

/** One asset an asset field may name. */
export type AssetOption = {
  id: string;
  kind: AssetKindName;
  label: string;
  path: string;
  /** An atlas's frame names in file order. */
  frames?: readonly string[];
};

const stem = (path: string) => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.indexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
};

/** The project's live assets of `kinds`, by path. */
export function assetOptions(view: ProjectView, kinds: readonly AssetKindName[]): AssetOption[] {
  const out: AssetOption[] = [];
  for (const entry of view.byId.values()) {
    if (!kinds.includes(entry.kind)) continue;
    const frames = assetInfo(view, entry.id)?.frames;
    out.push({
      id: entry.id,
      kind: entry.kind,
      label: entry.name ?? stem(entry.path),
      path: entry.path,
      ...(frames ? { frames } : {}),
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The frame a newly picked atlas draws: `current` when the atlas has it, else its first. */
export function frameFor(frames: readonly string[], current: unknown): string | undefined {
  return typeof current === "string" && frames.includes(current) ? current : frames[0];
}

const kindList = (kinds: readonly AssetKindName[]) =>
  kinds.length <= 1 ? (kinds[0] ?? "asset") : `${kinds.slice(0, -1).join(", ")} or ${kinds.at(-1)}`;

/** Why `value` isn't one of `options`, or null. */
export function danglingAsset(
  value: unknown,
  options: readonly AssetOption[],
  kinds: readonly AssetKindName[],
): string | null {
  if (typeof value !== "string" || options.some((o) => o.id === value)) return null;
  return `${value} isn't a ${kindList(kinds)} in this project.`;
}

/**
 * A combobox of the project's assets of the field's kinds, each with its
 * name, kind and path; typing filters by id. Clearing an optional field
 * picks `undefined`.
 */
export function AssetCombobox({
  path,
  kinds,
  options,
  value,
  mixed,
  optional,
  invalid,
  placeholder,
  onPick,
}: {
  /** The input's accessible name. */
  path: string;
  kinds: readonly AssetKindName[];
  options: readonly AssetOption[];
  value: unknown;
  mixed: boolean;
  optional: boolean;
  invalid: boolean;
  /** Shown while nothing is picked; defaults to "Pick a <kinds>". */
  placeholder?: string;
  onPick: (id: string | undefined) => void;
}) {
  const current = !mixed && typeof value === "string" ? value : null;
  const byId = new Map(options.map((o) => [o.id, o]));
  const kindsText = kindList(kinds);
  return (
    <Combobox
      items={options.map((o) => o.id)}
      value={current}
      onValueChange={(next: string | null) => {
        if (next === current) return;
        if (next !== null) onPick(next);
        else if (optional) onPick(undefined);
      }}
    >
      <ComboboxInput
        aria-label={path}
        aria-invalid={invalid || undefined}
        placeholder={placeholder ?? `Pick a ${kindsText}`}
        showClear={optional}
      />
      <ComboboxContent className="je-asset-picker">
        <ComboboxList>
          {(id: string) => {
            const o = byId.get(id);
            return (
              <ComboboxItem key={id} value={id}>
                <span className="je-asset-picker-item">
                  <span className="je-asset-picker-name">
                    <span className="je-sp-truncate">{o?.label ?? id}</span>
                    {kinds.length > 1 && o ? <MicroLabel>{o.kind}</MicroLabel> : null}
                  </span>
                  {o ? <span className="je-asset-picker-path je-sp-truncate">{o.path}</span> : null}
                </span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        <ComboboxEmpty>No {kindsText} in this project</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}

/** A select of an atlas's frames. */
export function FrameSelect({
  path,
  frames,
  value,
  mixed,
  empty,
  onPick,
}: {
  path: string;
  frames: readonly string[];
  value: unknown;
  mixed: boolean;
  /** Shown with no frame picked: "—" when mixed, "unset" otherwise. */
  empty: string;
  onPick: (frame: string) => void;
}) {
  const current = !mixed && typeof value === "string" ? value : "";
  const missing = current !== "" && !frames.includes(current);
  return (
    <Select
      value={current}
      onValueChange={(v) => {
        if (typeof v === "string" && v !== current && frames.includes(v)) onPick(v);
      }}
    >
      <SelectTrigger size="sm" aria-label={path} aria-invalid={missing || undefined}>
        <SelectValue>{current || empty}</SelectValue>
      </SelectTrigger>
      <SelectContent className="je-asset-frames">
        {frames.map((f) => (
          <SelectItem key={f} value={f}>
            {f}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
