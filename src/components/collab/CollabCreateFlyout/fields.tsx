import { Delete02Icon, Image01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { Text } from "@/components/ui/typography";
import type { CollabCompensationType, UploadedImage } from "@/lib/collab-store";
import { cn } from "@/lib/utils";

import { COMP_SLIDER_CONFIG, formatCompensation } from "./shared";

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
        <Label className="font-mono text-[11px] tracking-widest text-muted-foreground uppercase">
          {label}
        </Label>
        <div className="flex items-center gap-2">
          {hint ? (
            <Text monospace size="xs" variant="muted" className="text-right tracking-wide">
              {hint}
            </Text>
          ) : null}
          {action}
        </div>
      </div>
      {children}
      {error ? (
        <Text monospace size="xs" variant="danger" className="tracking-wide">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

// ── Char count ─────────────────────────────────────────────────────────────

export function CharCount({ current, max }: { current: number; max: number }) {
  return (
    <Text monospace size="xs" variant="muted" className="tracking-wide tabular-nums">
      {current} / {max}
    </Text>
  );
}

// ── Single-select segmented chips ──────────────────────────────────────────

interface SegmentedFieldProps<T extends string> {
  label: string;
  value: T | undefined;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

export function SegmentedField<T extends string>({
  label,
  value,
  onChange,
  options,
}: SegmentedFieldProps<T>) {
  return (
    <FieldRow label={label}>
      <SegmentedControl
        value={value ?? ""}
        onChange={(v) => onChange(v as T)}
        size="sm"
        priority="primary"
        className="flex-wrap"
      >
        {options.map((opt) => (
          <SegmentedControl.Item key={opt.value} value={opt.value}>
            {opt.label}
          </SegmentedControl.Item>
        ))}
      </SegmentedControl>
    </FieldRow>
  );
}

// ── Multi-select chip cloud ────────────────────────────────────────────────

interface MultiChipFieldProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
}

export function MultiChipField({ label, value, onChange, options }: MultiChipFieldProps) {
  const toggleOne = (item: string) => {
    if (value.includes(item)) onChange(value.filter((v) => v !== item));
    else onChange([...value, item]);
  };
  return (
    <FieldRow label={label}>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = value.includes(opt);
          return (
            <Toggle
              key={opt}
              variant="outline"
              size="sm"
              pressed={active}
              onPressedChange={() => toggleOne(opt)}
              className={cn(
                "rounded bg-background px-2.5 font-mono text-xs tracking-widest dark:bg-emboss-surface",
                active && "text-primary",
              )}
            >
              {opt}
            </Toggle>
          );
        })}
      </div>
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
  useEffect(() => {
    if (!config) return;
    if (min === undefined) onMinRef.current(config.defaultMin);
    if (max === undefined) onMaxRef.current(config.defaultMax);
  }, [config, min, max]);

  if (!config) return null;
  const currentMin = min ?? config.defaultMin;
  const currentMax = max ?? config.defaultMax;
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
      <Text as="p" monospace size="xs" variant="success" className="text-center tracking-wider">
        {formatCompensation(compensationType, currentMin, currentMax)}
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
        className="font-mono"
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
        className="min-h-32 resize-none font-mono"
      />
    </FieldRow>
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={images.length >= 5}
        className="w-full font-mono tracking-widest"
      >
        <HugeiconsIcon icon={Image01Icon} size={13} />
        {images.length >= 5 ? "MAX 5 IMAGES" : "ADD IMAGE"}
      </Button>
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
