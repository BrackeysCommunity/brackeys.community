import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { MicroLabel, Text } from "@/components/ui/typography";
import {
  type Channel,
  clipRgb,
  COLOR_SPACE_IDS,
  COLOR_SPACES,
  type ColorSpace,
  type ColorSpaceId,
  cssColor,
  decimals,
  glowStopValue,
  isColorSpaceId,
  isOutOfGamut,
  parseColor,
  type Rgb,
} from "@/lib/color-spaces";
import { play } from "@/lib/sound";
import { cn } from "@/lib/utils";

const SPACE_STORAGE_KEY = "brackeys:glow-colour-space";

function readStoredSpace(): ColorSpaceId {
  try {
    const stored = localStorage.getItem(SPACE_STORAGE_KEY);
    return isColorSpaceId(stored) ? stored : "hsl";
  } catch {
    return "hsl";
  }
}

/** A space's values for a colour. Only OKLCH reaches beyond sRGB, so the
 *  others take the nearest colour they can hold. */
function valuesIn(space: ColorSpace, rgb: Rgb): number[] {
  return space.fromRgb(space.id === "oklch" ? rgb : clipRgb(rgb));
}

function seed(space: ColorSpace, stored: string): number[] {
  return valuesIn(space, parseColor(stored) ?? { r: 0, g: 0, b: 0 });
}

function storeSpace(id: ColorSpaceId) {
  try {
    localStorage.setItem(SPACE_STORAGE_KEY, id);
  } catch {
    // Private windows and blocked storage just forget the choice.
  }
}

/**
 * One gradient stop, edited in whichever colour space the member thinks in:
 * sliders with a number box beside each, a text field that takes any
 * notation pasted into it, and the space itself switchable at any time.
 *
 * Not `<input type="color">`: the native control opens an OS window that
 * can't be themed and speaks one space per platform.
 *
 * Whatever is picked is painted, with no pull towards legibility. OKLCH can
 * go past sRGB, and those picks are stored as `oklch(…)` rather than clipped
 * to a hex (`glowStopValue`).
 */
export function GlowStopPicker({
  value,
  onChange,
  onCommit,
  onRemove,
  index,
}: {
  value: string;
  /** Fires while a control is moving — cheap, local updates only. */
  onChange: (hex: string) => void;
  /** Fires when an edit is finished, which is when a write is worth making. */
  onCommit: () => void;
  onRemove: () => void;
  index: number;
}) {
  const [spaceId, setSpaceId] = useState<ColorSpaceId>(readStoredSpace);
  const space = COLOR_SPACES[spaceId];
  // The controls read these, not the hex. Re-deriving them from the colour
  // on every render round-trips through eight bits a channel, which drifts
  // the other channels whenever one moves — and hue isn't recoverable from a
  // grey at all, so desaturating would snap it back to red. Seeded when the
  // popover opens or the space changes, the only moments they can be stale.
  const [values, setValues] = useState<number[]>(() => seed(space, value));
  const [open, setOpen] = useState(false);

  const rgb = space.toRgb(values);

  const apply = (next: number[], inSpace: ColorSpace = space) => {
    setValues(next);
    onChange(glowStopValue(inSpace, next));
  };

  const switchSpace = (next: ColorSpaceId, from: Rgb = rgb) => {
    // Through the unrounded floats, not the hex, so hopping between spaces
    // doesn't quantize the colour a little further each time.
    setValues(valuesIn(COLOR_SPACES[next], from));
    setSpaceId(next);
    storeSpace(next);
  };

  /** A typed or pasted colour. One beyond sRGB, entered in a space that
   *  can't hold it, moves the picker to OKLCH once the member is done
   *  typing, rather than keeping a clipped copy. */
  const applyText = (next: Rgb, done: boolean) => {
    if (done && isOutOfGamut(next) && space.id !== "oklch") {
      switchSpace("oklch", next);
      apply(COLOR_SPACES.oklch.fromRgb(next), COLOR_SPACES.oklch);
      return;
    }
    apply(valuesIn(space, next));
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setValues(seed(space, value));
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Colour ${index + 1}`}
            className={cn(
              // Deliberately no scale on hover or press: the swatch is the
              // popover's anchor, and resizing it shifts the open panel.
              "size-8 shrink-0 rounded-md border border-border transition-colors",
              "hover:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              open && "ring-2 ring-ring",
            )}
            style={{ backgroundColor: value }}
          />
        }
      />
      <PopoverContent align="start" className="w-80 gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <MicroLabel as="span">COLOUR {index + 1}</MicroLabel>
          <Select
            value={spaceId}
            onValueChange={(next) => {
              if (isColorSpaceId(next)) switchSpace(next);
            }}
          >
            <SelectTrigger size="xs" className="w-24 tracking-widest" aria-label="Colour space">
              <SelectValue>{space.label}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false} className="w-68">
              {COLOR_SPACE_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {/* Item text is `nowrap`; the description opts back in so a
                      long one wraps inside the popup rather than running off it. */}
                  <span className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-2">
                    <span className="tracking-widest">{COLOR_SPACES[id].label}</span>
                    <span className="text-[10px] whitespace-normal text-muted-foreground">
                      {COLOR_SPACES[id].description}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ColorTextField
          key={space.id}
          space={space}
          values={values}
          onApply={applyText}
          onCommit={onCommit}
        />

        <div className="flex flex-col gap-2.5">
          {space.channels.map((channel, n) => (
            <ChannelRow
              key={`${space.id}-${channel.label}`}
              space={space}
              channel={channel}
              values={values}
              index={n}
              onChange={(v) => apply(values.map((old, i) => (i === n ? v : old)))}
              onCommit={onCommit}
            />
          ))}
        </div>

        {isOutOfGamut(rgb) ? (
          <Text size="sm" variant="muted">
            Beyond sRGB — wide-gamut screens show it in full, others the nearest colour they can.
          </Text>
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          className="justify-center"
          onClick={() => {
            setOpen(false);
            onRemove();
          }}
        >
          REMOVE COLOUR
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The whole colour as text, in the current space's notation. Takes a paste
 * in any notation `parseColor` knows, applying it the moment it parses;
 * a half-typed value just waits, and only reads as invalid once the member
 * leaves the field with it.
 */
function ColorTextField({
  space,
  values,
  onApply,
  onCommit,
}: {
  space: ColorSpace;
  values: readonly number[];
  onApply: (rgb: Rgb, done: boolean) => void;
  onCommit: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = space.stringify(values);

  const finish = () => {
    if (draft == null) return;
    const parsed = parseColor(draft, space.id);
    setInvalid(parsed == null);
    if (parsed == null) return;
    onApply(parsed, true);
    setDraft(null);
    onCommit();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    play("success");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        aria-label="Colour value"
        aria-invalid={invalid || undefined}
        spellCheck={false}
        autoComplete="off"
        value={draft ?? text}
        placeholder="#7f5af0, rgb(…), oklch(…)…"
        className="h-7 tabular-nums"
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          setInvalid(false);
          const parsed = parseColor(next, space.id);
          if (parsed) onApply(parsed, false);
        }}
        onFocus={(event) => event.target.select()}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish();
          }
        }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy colour value"
        tooltip={copied ? "Copied" : "Copy"}
        onClick={copy}
      >
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
      </Button>
    </div>
  );
}

/** Where the value would sit along its channel, for the track preview. */
const TRACK_SAMPLES = 12;

/**
 * One channel: a slider whose track previews the axis it controls, and a
 * number box that takes a typed value. The track is painted by walking this
 * channel with the others held, so it shows exactly the colours the knob can
 * reach — a desaturated stop gets a grey hue ramp, not a rainbow it can't
 * produce.
 */
function ChannelRow({
  space,
  channel,
  values,
  index,
  onChange,
  onCommit,
}: {
  space: ColorSpace;
  channel: Channel;
  values: readonly number[];
  index: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  const value = values[index];
  // State keeps the unrounded float; the slider (and what it announces)
  // gets the value at the channel's own precision.
  const shown = Number(value.toFixed(decimals(channel.step)));
  const track = `linear-gradient(90deg, ${Array.from({ length: TRACK_SAMPLES + 1 }, (_, n) => {
    const sample = channel.min + ((channel.max - channel.min) * n) / TRACK_SAMPLES;
    return cssColor(
      space,
      values.map((v, i) => (i === index ? sample : v)),
    );
  }).join(", ")})`;

  return (
    <div className="flex flex-col gap-1">
      <MicroLabel as="span" className="text-muted-foreground">
        {channel.label}
      </MicroLabel>
      <div className="flex items-center gap-3">
        <Slider
          aria-label={channel.label}
          value={[shown]}
          min={channel.min}
          max={channel.max}
          step={channel.step}
          onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
          // The write waits for the release: dragging a slider is one
          // decision, not one per frame.
          onValueCommitted={onCommit}
          valueLabel={(v) => channel.format(v)}
          style={{ "--glow-track": track } as React.CSSProperties}
          // The filled indicator would paint over the gradient the track is
          // showing, and here the track *is* the information.
          className="flex-1 [&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-track]]:bg-[image:var(--glow-track)]"
        />
        <ChannelInput channel={channel} value={value} onChange={onChange} onCommit={onCommit} />
      </div>
    </div>
  );
}

/**
 * The typed side of a channel. Holds its own draft while focused so a
 * half-typed number isn't reformatted under the caret; applies each keystroke
 * that parses, and snaps back to the real value on blur. Arrow keys step,
 * with Shift for ten steps, and hue wraps round rather than stopping at 360.
 */
function ChannelInput({
  channel,
  value,
  onChange,
  onCommit,
}: {
  channel: Channel;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Arrow-key steps apply at once but write on blur, like a slider's release,
  // so holding a key down doesn't fire a request per repeat.
  const stepped = useRef(false);

  const fit = (v: number) => {
    if (channel.wraps) {
      const span = channel.max - channel.min;
      return ((((v - channel.min) % span) + span) % span) + channel.min;
    }
    return Math.min(channel.max, Math.max(channel.min, v));
  };

  return (
    <Input
      aria-label={`${channel.label} value`}
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      value={draft ?? channel.format(value)}
      className="h-7 w-16 shrink-0 px-2 text-right tabular-nums"
      onFocus={(event) => event.target.select()}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = channel.parse(event.target.value);
        if (parsed != null) onChange(fit(parsed));
      }}
      onBlur={() => {
        if (draft == null && !stepped.current) return;
        setDraft(null);
        stepped.current = false;
        onCommit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
          return;
        }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        const delta = channel.step * (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
        const next = fit(Number((value + delta).toFixed(6)));
        setDraft(null);
        stepped.current = true;
        onChange(next);
      }}
    />
  );
}
