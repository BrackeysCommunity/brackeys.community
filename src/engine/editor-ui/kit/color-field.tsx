import { useState, type ReactNode } from "react";

import { STORAGE_PREFIX } from "../host";
import { useKit } from "./context";
import { Input } from "./input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Slider } from "./slider";
import { MicroLabel } from "./text";

export type Rgb = { r: number; g: number; b: number };

type Channel = { label: string; max: number; unit?: string };
type Space = {
  id: "hsl" | "rgb";
  label: string;
  channels: readonly [Channel, Channel, Channel];
  fromRgb(rgb: Rgb): [number, number, number];
  toRgb(values: readonly number[]): Rgb;
  css(values: readonly number[]): string;
};

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));

/** `#rgb` or `#rrggbb` (the `#` optional) as channels 0–255; null for anything else. */
export function parseHex(text: string): Rgb | null {
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(text.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Channels as `#rrggbb`, rounded and clipped to 0–255. */
export function toHex({ r, g, b }: Rgb): string {
  const byte = (v: number) => Math.round(clamp(v, 255)).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

function hslToRgb(values: readonly number[]): Rgb {
  const h = values[0] ?? 0;
  const s = (values[1] ?? 0) / 100;
  const l = (values[2] ?? 0) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const SPACES: Record<Space["id"], Space> = {
  hsl: {
    id: "hsl",
    label: "HSL",
    channels: [
      { label: "Hue", max: 360, unit: "°" },
      { label: "Saturation", max: 100, unit: "%" },
      { label: "Lightness", max: 100, unit: "%" },
    ],
    fromRgb: rgbToHsl,
    toRgb: hslToRgb,
    css: (v) => `hsl(${v[0] ?? 0} ${v[1] ?? 0}% ${v[2] ?? 0}%)`,
  },
  rgb: {
    id: "rgb",
    label: "RGB",
    channels: [
      { label: "Red", max: 255 },
      { label: "Green", max: 255 },
      { label: "Blue", max: 255 },
    ],
    fromRgb: ({ r, g, b }) => [r, g, b],
    toRgb: (v) => ({ r: v[0] ?? 0, g: v[1] ?? 0, b: v[2] ?? 0 }),
    css: (v) => `rgb(${v[0] ?? 0} ${v[1] ?? 0} ${v[2] ?? 0})`,
  },
};

const SPACE_KEY = `${STORAGE_PREFIX}color-space`;
const isSpace = (v: string | null): v is Space["id"] => v === "hsl" || v === "rgb";

/**
 * An sRGB colour picked in HSL or RGB: a slider and number box per channel and
 * a hex field. The space is remembered per viewer. It seeds from `value` on
 * mount, so mount it where it opens (a popover). Emits `#rrggbb`.
 */
export function ColorField({
  value,
  onChange,
  onCommit,
  label,
}: {
  value: string;
  /** Fires while a control moves; cheap, local updates only. */
  onChange: (value: string) => void;
  /** Fires when an edit is finished, which is when a write is worth making. */
  onCommit: () => void;
  label: ReactNode;
}) {
  const { storage } = useKit();
  const [spaceId, setSpaceId] = useState<Space["id"]>(() => {
    const stored = storage.get(SPACE_KEY);
    return isSpace(stored) ? stored : "hsl";
  });
  const space = SPACES[spaceId];
  // The controls hold their own floats: re-deriving them from the hex on each
  // render would drift the other channels, and a grey has no hue to recover.
  const [values, setValues] = useState<number[]>(() =>
    space.fromRgb(parseHex(value) ?? { r: 0, g: 0, b: 0 }),
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const hex = toHex(space.toRgb(values));

  const apply = (next: number[]) => {
    setValues(next);
    onChange(toHex(space.toRgb(next)));
  };

  const switchSpace = (next: Space["id"]) => {
    setValues(SPACES[next].fromRgb(space.toRgb(values)));
    setSpaceId(next);
    storage.set(SPACE_KEY, next);
  };

  const finishText = () => {
    if (draft == null) return;
    const rgb = parseHex(draft);
    setInvalid(rgb == null);
    if (!rgb) return;
    setDraft(null);
    apply(space.fromRgb(rgb));
    onCommit();
  };

  return (
    <div className="je-color">
      <div className="je-color-head">
        <MicroLabel>{label}</MicroLabel>
        <Select
          value={spaceId}
          onValueChange={(next) => {
            if (typeof next === "string" && isSpace(next)) switchSpace(next);
          }}
        >
          <SelectTrigger size="xs" aria-label="Colour space">
            <SelectValue>{space.label}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            {Object.values(SPACES).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        aria-label="Colour value"
        aria-invalid={invalid || undefined}
        spellCheck={false}
        autoComplete="off"
        value={draft ?? hex}
        placeholder="#7f5af0"
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
          const rgb = parseHex(event.target.value);
          if (rgb) {
            setValues(space.fromRgb(rgb));
            onChange(toHex(rgb));
          }
        }}
        onFocus={(event) => event.target.select()}
        onBlur={finishText}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finishText();
          }
        }}
      />
      {space.channels.map((channel, n) => {
        const shown = Math.round(values[n] ?? 0);
        const ramp = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) =>
          space.css(values.map((v, j) => (j === n ? (channel.max * i) / 12 : v))),
        ).join(", ")})`;
        const set = (v: number) =>
          apply(values.map((old, i) => (i === n ? clamp(v, channel.max) : old)));
        return (
          <div key={`${space.id}-${channel.label}`} className="je-color-channel">
            <MicroLabel>{channel.label}</MicroLabel>
            <div className="je-color-row">
              <Slider
                aria-label={channel.label}
                min={0}
                max={channel.max}
                step={1}
                value={[shown]}
                track={ramp}
                onValueChange={(next) => set(Array.isArray(next) ? (next[0] ?? 0) : next)}
                onValueCommitted={onCommit}
              />
              <Input
                size="sm"
                aria-label={`${channel.label} value`}
                inputMode="numeric"
                className="je-color-number"
                value={String(shown)}
                onChange={(event) => {
                  const n = Number(event.target.value);
                  if (event.target.value.trim() !== "" && Number.isFinite(n)) set(n);
                }}
                onBlur={onCommit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
