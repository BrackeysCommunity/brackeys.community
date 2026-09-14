import { ArrowDown01Icon, SortByDown02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string };

/**
 * Shared look for the filter row's toggles. The depressed-while-on state
 * comes from `.chonk-emboss[aria-pressed="true"]` in the stylesheet — the
 * classes here only carry the color, and are `!` so they beat the outline
 * variant's own hover background rather than depending on rule order.
 *
 * The on-fill is mixed into the button surface rather than laid over it as
 * `primary/15`: an alpha fill replaces the variant's opaque background, and
 * the cards scrolling under the sticky toolbar show through the toggle.
 */
export const FILTER_TOGGLE =
  "tracking-widest uppercase aria-pressed:border-primary! aria-pressed:bg-[color-mix(in_oklab,var(--primary)_15%,var(--emboss-surface))]! aria-pressed:text-primary aria-pressed:[--emboss-shadow:var(--primary)]";

/**
 * A facet with only two states, which is a pressed pill rather than a menu
 * — one click to constrain, one to let go, no list to open for a choice
 * that was never more than yes/no.
 */
export function FilterToggle({
  label,
  pressed,
  onPressedChange,
  className,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onPressedChange(!pressed)}
      aria-pressed={pressed}
      className={cn(FILTER_TOGGLE, className)}
    >
      {label}
    </Button>
  );
}

interface FilterMenuProps {
  /** The facet's name, shown while nothing narrows it. */
  label: string;
  /** First entry is the "no constraint" choice; picking it clears the filter. */
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * One facet of a browse toolbar: a pill that names the facet until it
 * narrows something, then names the choice instead. That swap is the whole
 * point — a row of these reads back as the current query without a chip
 * rail under it, and the constrained ones carry the primary border so the
 * row says at a glance how much is being filtered out.
 */
export function FilterMenu({
  label,
  options,
  value,
  onChange,
  align = "start",
  className,
}: FilterMenuProps) {
  const isConstrained = value !== options[0]?.value;
  const selected = options.find((o) => o.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "tracking-widest uppercase",
              isConstrained && "border-primary text-primary",
              className,
            )}
          />
        }
      >
        {isConstrained && selected ? selected.label : label}
        <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-auto min-w-44 p-1">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as string)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SortMenuProps {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
  /** `lg` is the touch-sized variant the floating control rows use. */
  size?: "sm" | "lg";
  align?: "start" | "center" | "end";
  className?: string;
  contentClassName?: string;
}

/**
 * Sort as an icon button rather than a labelled control: the options are
 * long, only matter at the moment of choosing, and the current one belongs
 * in the tooltip rather than taking a facet's worth of row width.
 */
export function SortMenu({
  options,
  value,
  onChange,
  size = "sm",
  align = "end",
  className,
  contentClassName,
}: SortMenuProps) {
  const label = options.find((o) => o.value === value)?.label ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size={size === "lg" ? "icon-lg" : "icon-sm"}
            tooltip={`Sort: ${label}`}
            aria-label={`Sort order: ${label}`}
            className={className}
          />
        }
      >
        <HugeiconsIcon icon={SortByDown02Icon} size={size === "lg" ? 18 : 14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn("w-auto min-w-48 p-1", contentClassName)}>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as string)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
