import { Delete02Icon, Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectMultiTrigger,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import type { CollabCompensationType, UploadedImage } from "@/lib/collab-store";
import { formatRate } from "@/lib/format-rate";
import { cn } from "@/lib/utils";

import { COMP_SLIDER_CONFIG, type CompSliderConfig } from "./shared";

// ── FieldRow ───────────────────────────────────────────────────────────────

interface FieldRowProps {
  label: string;
  hint?: string;
  error?: string | null;
  action?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Mirrors the profile flyout's `FieldRow` chrome — uppercase mono label
 * + optional right-aligned hint + optional action button. Children are
 * the actual control(s).
 */
export function FieldRow({ label, hint, error, action, children }: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] tracking-widest text-muted-foreground uppercase">
          {label}
        </Label>
        <div className="flex items-center gap-2">
          {hint ? (
            <Text size="xs" variant="muted" className="text-right tracking-wide">
              {hint}
            </Text>
          ) : null}
          {action}
        </div>
      </div>
      {children}
      {error ? (
        <Text size="xs" variant="danger" className="tracking-wide">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

// ── Char count ─────────────────────────────────────────────────────────────

export function CharCount({ current, max }: { current: number; max: number }) {
  return (
    <Text size="xs" variant="muted" className="tracking-wide tabular-nums">
      {current} / {max}
    </Text>
  );
}

// ── Single-select dropdown ─────────────────────────────────────────────────

interface SelectFieldProps<T extends string> {
  label: string;
  value: T | undefined;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  placeholder?: string;
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  placeholder,
}: SelectFieldProps<T>) {
  return (
    <FieldRow label={label}>
      <Select value={value ?? null} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="w-full">
          {/* Resolved from `options` rather than left to Base UI, which
              reads labels off the mounted `SelectItem`s — those only
              exist once the popup has been opened, so an untouched or
              restored value renders as the raw enum (`rev_share`). */}
          <SelectValue placeholder={placeholder ?? "Select…"}>
            {value ? (options.find((o) => o.value === value)?.label ?? value) : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}

// ── Multi-select dropdown with badges ──────────────────────────────────────

interface MultiSelectFieldProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
  placeholder?: string;
}

export function MultiSelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: MultiSelectFieldProps) {
  return (
    <FieldRow label={label}>
      <Select multiple value={value} onValueChange={(v) => onChange(v as string[])}>
        <SelectMultiTrigger
          selectedLabels={value.map((v) => ({ value: v, label: v }))}
          onRemove={(val) => onChange(value.filter((v) => v !== val))}
          onClear={() => onChange([])}
          placeholder={placeholder ?? "Select…"}
        />
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );
}

// ── Compensation range slider ──────────────────────────────────────────────

interface CompensationFieldProps {
  compensationType: CollabCompensationType | undefined;
  min: number | undefined;
  max: number | undefined;
  onMinChange: (v: number | undefined) => void;
  onMaxChange: (v: number | undefined) => void;
}

export function CompensationField({
  compensationType,
  min,
  max,
  onMinChange,
  onMaxChange,
}: CompensationFieldProps) {
  const config = compensationType ? COMP_SLIDER_CONFIG[compensationType] : undefined;
  const onMinRef = useRef(onMinChange);
  const onMaxRef = useRef(onMaxChange);
  useEffect(() => {
    onMinRef.current = onMinChange;
    onMaxRef.current = onMaxChange;
  });

  // A range only means anything in its own type's units: carrying a
  // fixed-price 500–5000 across to rev share renders "500% - 5000%" and
  // pins both thumbs off the end of a 5–100 track. Re-seed whenever the
  // type changes, or when the stored pair can't be expressed on this
  // track at all — which is also how a stale draft or a remount after a
  // detour through "negotiable" gets straightened out.
  const lastTypeRef = useRef(compensationType);
  const onTrack = (v: number | undefined, cfg: CompSliderConfig) =>
    v !== undefined && v >= cfg.min && v <= cfg.max;
  useEffect(() => {
    if (!config) return;
    const typeChanged = lastTypeRef.current !== compensationType;
    lastTypeRef.current = compensationType;
    if (typeChanged || !onTrack(min, config) || !onTrack(max, config)) {
      onMinRef.current(config.defaultMin);
      onMaxRef.current(config.defaultMax);
    }
  }, [config, compensationType, min, max]);

  if (!config) return null;
  // Same test for display, so a carried-over pair never gets one frame
  // to render as nonsense before the effect above re-seeds it.
  const currentMin = onTrack(min, config) ? min! : config.defaultMin;
  const currentMax = onTrack(max, config) ? max! : config.defaultMax;
  return (
    <FieldRow label="RATE RANGE">
      <div className="px-1">
        <Slider
          min={config.min}
          max={config.max}
          step={config.step}
          value={[currentMin, currentMax]}
          onValueChange={(newValue) => {
            if (Array.isArray(newValue)) {
              onMinChange(newValue[0]);
              onMaxChange(newValue[1]);
            }
          }}
        />
      </div>
      <Text as="p" size="xs" variant="success" className="text-center tracking-wider">
        {formatRate(compensationType, currentMin, currentMax)}
      </Text>
    </FieldRow>
  );
}

// ── Text + textarea controls (with char counts) ────────────────────────────

interface TextFieldProps {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  maxLength: number;
  error?: string | null;
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength,
  error,
}: TextFieldProps) {
  return (
    <FieldRow
      label={label}
      hint={hint}
      action={<CharCount current={value.length} max={maxLength} />}
      error={error}
    >
      <Input
        value={value}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
      />
    </FieldRow>
  );
}

interface TextAreaFieldProps extends TextFieldProps {
  rows?: number;
}

export function TextAreaField({
  label,
  hint,
  value,
  onChange,
  onBlur,
  placeholder,
  maxLength,
  rows = 5,
  error,
}: TextAreaFieldProps) {
  return (
    <FieldRow
      label={label}
      hint={hint}
      action={<CharCount current={value.length} max={maxLength} />}
      error={error}
    >
      <Textarea
        value={value}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={rows}
        className="min-h-32 resize-none"
      />
    </FieldRow>
  );
}

// ── Add-image card ─────────────────────────────────────────────────────────

interface AddImageCardProps {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

/**
 * The dashed drop-target-styled card both image pickers open the file
 * dialog from — same voice as the profile page's dashed empty states.
 */
export function AddImageCard({
  onClick,
  disabled,
  label = "ADD IMAGE",
  className,
}: AddImageCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/10 text-muted-foreground",
        "transition-colors outline-none hover:border-primary/50 hover:text-foreground",
        "focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-muted-foreground/40 disabled:hover:text-muted-foreground",
        className,
      )}
    >
      <HugeiconsIcon icon={Image01Icon} size={20} />
      <MicroLabel as="span" variant="inherit">
        {label}
      </MicroLabel>
    </button>
  );
}

// ── Image uploader ─────────────────────────────────────────────────────────

interface ImageUploaderProps {
  images: UploadedImage[];
  onAdd: (img: UploadedImage) => void;
  onRemove: (idx: number) => void;
}

export function ImageUploader({ images, onAdd, onRemove }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Only image files are allowed.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be under 5MB.");
      return;
    }
    setError("");
    onAdd({
      file,
      localId: nanoid(),
      previewUrl: URL.createObjectURL(file),
    });
  };

  return (
    <FieldRow label="PROJECT IMAGES" hint={`${images.length}/5`} error={error || null}>
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {images.map((img, idx) => (
            <div key={img.localId} className="group relative h-16 w-16">
              <img
                src={img.previewUrl}
                alt={img.alt ?? ""}
                className="h-full w-full border border-muted/40 object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon-xs"
                onClick={() => onRemove(idx)}
                className="absolute -top-1 -right-1 opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="Remove image"
              >
                <HugeiconsIcon icon={Delete02Icon} size={10} />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <AddImageCard
        onClick={() => inputRef.current?.click()}
        disabled={images.length >= 5}
        label={images.length >= 5 ? "MAX 5 IMAGES" : "ADD IMAGE"}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </FieldRow>
  );
}
