import { Delete02Icon, Image01Icon, ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { nanoid } from "nanoid";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
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
import { Textarea } from "@/components/ui/textarea";
import { TransformedImage } from "@/components/ui/transformed-image";
import { MarkedText, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import type { CollabCompensationType, UploadedImage } from "@/lib/collab-store";
import { CURRENCY_OPTIONS, type Currency } from "@/lib/currency";
import { formatRate } from "@/lib/format-rate";
import { cn } from "@/lib/utils";

import { MAX_COMPENSATION, compensationProblem } from "./shared";

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

export interface ChoiceCardOption<T extends string> {
  value: T;
  label: string;
  desc: string;
  icon: IconSvgElement;
}

interface ChoiceCardsProps<T extends string> {
  options: ChoiceCardOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A row of icon + label + blurb cards, one pressed. The POST TYPE and
 *  RECRUITING AS pickers share it so the two read as one control. */
export function ChoiceCards<T extends string>({ options, value, onChange }: ChoiceCardsProps<T>) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Chonk
            key={opt.value}
            variant={active ? "default" : "surface"}
            size="lg"
            render={
              <button type="button" aria-pressed={active} onClick={() => onChange(opt.value)} />
            }
            className="flex w-full flex-col items-stretch gap-2 p-3 text-left"
          >
            <HugeiconsIcon
              icon={opt.icon}
              size={16}
              className={active ? "text-primary" : "text-muted-foreground"}
            />
            <div className="flex flex-col gap-0.5">
              <Text
                as="span"
                bold
                size="xs"
                className={cn(
                  "tracking-widest uppercase",
                  active ? "text-primary" : "text-foreground",
                )}
              >
                {opt.label}
              </Text>
              <Text size="xs" variant="muted">
                {opt.desc}
              </Text>
            </div>
          </Chonk>
        );
      })}
    </div>
  );
}

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

// ── Compensation range ─────────────────────────────────────────────────────

interface CompensationFieldProps {
  compensationType: CollabCompensationType | undefined;
  min: number | undefined;
  max: number | undefined;
  currency: Currency;
  onMinChange: (v: number | undefined) => void;
  onMaxChange: (v: number | undefined) => void;
  onCurrencyChange: (v: Currency) => void;
}

/**
 * Two numbers and, for money, what they are denominated in.
 *
 * This was a two-thumb slider with no minimum separation, so the pair could
 * meet and the grab target went ambiguous — and the tracks quantised the
 * answer besides: `step: 5` from a floor of 5 made `$4.99/hr` and every
 * other sub-5 rate unexpressible, and the fixed track's `step: 100` did the
 * same under a hundred. The profile's AVAILABILITY step already asks this
 * question with a type select plus numeric min/max, and that is the control
 * nobody filed a report about, so the wizard uses it too.
 *
 * `rev_share` keeps numeric inputs but not the currency picker: it is a
 * percentage of the project, not an amount of money.
 */
export function CompensationField({
  compensationType,
  min,
  max,
  currency,
  onMinChange,
  onMaxChange,
  onCurrencyChange,
}: CompensationFieldProps) {
  if (!compensationType || compensationType === "negotiable") return null;
  const isShare = compensationType === "rev_share";
  const unitMax = isShare ? 100 : MAX_COMPENSATION;
  const problem = compensationProblem(compensationType, min, max);

  return (
    <FieldRow label="RATE RANGE" error={problem}>
      <div className="flex flex-wrap items-center gap-2">
        {isShare ? null : (
          <Select
            value={currency}
            onValueChange={(v) => {
              if (typeof v === "string") onCurrencyChange(v as Currency);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          type="number"
          min={0}
          max={unitMax}
          placeholder="min"
          className="w-24"
          value={min ?? ""}
          onChange={(e) => onMinChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
        <Text variant="muted">–</Text>
        <Input
          type="number"
          min={0}
          max={unitMax}
          placeholder="max"
          className="w-24"
          value={max ?? ""}
          onChange={(e) => onMaxChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
        {isShare ? (
          <Text variant="muted" size="sm">
            % of revenue
          </Text>
        ) : null}
      </div>
      {problem ? null : (
        <Text as="p" size="xs" variant="success" className="tracking-wider">
          {formatRate(compensationType, min, max, { currency })}
        </Text>
      )}
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
  /** Renders as markdown on the live post: adds the EDIT/PREVIEW toggle. */
  markdown?: boolean;
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
  markdown = false,
}: TextAreaFieldProps) {
  const [preview, setPreview] = useState(false);
  return (
    <FieldRow
      label={label}
      hint={markdown && preview ? "preview" : hint}
      action={
        <>
          <CharCount current={value.length} max={maxLength} />
          {markdown ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setPreview((p) => !p)}
              className="tracking-widest"
            >
              <HugeiconsIcon icon={preview ? ViewOffSlashIcon : ViewIcon} size={12} />
              {preview ? "EDIT" : "PREVIEW"}
            </Button>
          ) : null}
        </>
      }
      error={error}
    >
      {markdown && preview ? (
        <Well className="min-h-32 p-3">
          {value.trim() ? (
            <MarkedText censor={false}>{value}</MarkedText>
          ) : (
            <Text size="sm" variant="muted" className="italic">
              Nothing to preview yet.
            </Text>
          )}
        </Well>
      ) : (
        <Textarea
          value={value}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={rows}
          className="min-h-32 resize-none"
        />
      )}
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

/** An image already saved on the post, shown ahead of the pending picks. */
export interface ExistingImage {
  id: number;
  url: string;
  alt?: string | null;
}

interface ImageUploaderProps {
  images: UploadedImage[];
  onAdd: (img: UploadedImage) => void;
  onRemove: (idx: number) => void;
  /** Editing: what's on the post now. Counts toward the cap like a pick. */
  existing?: ExistingImage[];
  onRemoveExisting?: (id: number) => void;
  /** Defaults to PROJECT IMAGES. A post linked to a canonical project says
   *  POST IMAGES instead — these rows are the post's own, and calling them
   *  the project's invites "0/5" to read as a fact about the project. */
  label?: string;
  /** Optional line under the picker, for saying where the art comes from. */
  note?: string;
}

export function ImageUploader({
  images,
  onAdd,
  onRemove,
  existing = [],
  onRemoveExisting,
  label = "PROJECT IMAGES",
  note,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const total = existing.length + images.length;
  const full = total >= 5;

  const handleFile = (file: File) => {
    if (full) return;
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
    <FieldRow label={label} hint={`${total}/5`} error={error || null}>
      {total > 0 ? (
        <div className="flex flex-wrap gap-2">
          {existing.map((img) => (
            <div key={`saved-${img.id}`} className="group relative h-16 w-16">
              <TransformedImage
                src={img.url}
                transform={{ width: 128 }}
                alt={img.alt ?? ""}
                className="h-full w-full border border-muted/40 object-cover"
              />
              {onRemoveExisting ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon-xs"
                  onClick={() => onRemoveExisting(img.id)}
                  className="absolute -top-1 -right-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Remove image"
                  tooltip="Remove image"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={10} />
                </Button>
              ) : null}
            </div>
          ))}
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
                tooltip="Remove image"
              >
                <HugeiconsIcon icon={Delete02Icon} size={10} />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <AddImageCard
        onClick={() => inputRef.current?.click()}
        disabled={full}
        label={full ? "MAX 5 IMAGES" : "ADD IMAGE"}
      />
      {note ? (
        <Text size="xs" variant="muted" className="tracking-wide">
          {note}
        </Text>
      ) : null}
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
