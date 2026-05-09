import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ComponentProps, forwardRef } from "react";

import { Chonk } from "@/components/ui/chonk";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

type Size = "default" | "sm" | "xs";

export interface SearchFieldProps extends Omit<
  ComponentProps<"input">,
  "size" | "onChange" | "value"
> {
  value: string;
  onChange: (value: string) => void;
  size?: Size;
  /** Container className applied to the surrounding `InputGroup`. */
  containerClassName?: string;
}

/**
 * Branded search input. Wraps `InputGroup` to inherit the debossed well
 * appearance, embeds the magnifying-glass icon as a leading addon, and
 * renders a `Chonk` × clear button on the trailing edge whenever the
 * value is non-empty. Native browser-supplied search clear/decoration
 * affordances are suppressed so only our chonk shows.
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, size = "sm", containerClassName, className, placeholder, ...rest },
  ref,
) {
  return (
    <InputGroup
      size={size}
      // `!bg-background` overrides `InputGroup`'s internal
      // `dark:bg-input/30` so the field reads as a solid well rather
      // than a faint translucent strip.
      className={cn("bg-background! dark:bg-background!", containerClassName)}
    >
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} size={14} />
      </InputGroupAddon>
      <InputGroupInput
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          // Suppress the native WebKit/Edge search cancel/decoration
          // affordances so only our `Chonk` clear button is visible.
          "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden [&::-webkit-search-results-button]:hidden [&::-webkit-search-results-decoration]:hidden",
          className,
        )}
        {...rest}
      />
      {value.length > 0 && (
        <InputGroupAddon align="inline-end">
          <Chonk
            variant="surface"
            size="sm"
            render={<button type="button" onClick={() => onChange("")} aria-label="Clear search" />}
            className="flex h-5 w-5 items-center justify-center"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </Chonk>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
});
