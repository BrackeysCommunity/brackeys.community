import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { Link as RouterLink } from "@tanstack/react-router";
import { Fragment, type ReactNode, useCallback } from "react";

import { TooltipContent } from "@/components/ui/tooltip";
import { useCensorSegments } from "@/lib/hooks/use-censored";

/** The look of a censored run, shared with `RichHtml`'s DOM-side marks. */
export const CENSORED_MARK_CLASS =
  "cursor-help underline decoration-muted-foreground/60 decoration-dotted underline-offset-2";

/** Plain-text explanation for surfaces that can't mount the tooltip. */
export const CENSORED_MARK_TITLE =
  "Hidden by your profanity filter. Turn off “Hide profanity” in Settings › Appearance to see it as written.";

/**
 * One run of asterisks with a hover that says what happened and where the
 * switch is. The trigger is an inline span so it sits inside any prose,
 * clamped line, or ellipsis without breaking the flow.
 */
export function CensoredMark({ children }: { children: string }) {
  return (
    <TooltipPrimitive.Provider delay={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger
          render={<span data-slot="censored" className={CENSORED_MARK_CLASS} />}
        >
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipContent maxWidth={260}>
          Hidden by your profanity filter.{" "}
          <RouterLink
            to="/settings/appearance"
            className="underline underline-offset-1 hover:opacity-80"
          >
            Turn it off in Settings › Appearance
          </RouterLink>{" "}
          to see it as written.
        </TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/**
 * The censor as a renderer, for text leaves inside a bigger tree —
 * `MarkedText` runs every leaf through it. Clean text comes back as the
 * plain string, so the common case adds no nodes.
 */
export function useCensorNodes(): (text: string) => ReactNode {
  const split = useCensorSegments();
  return useCallback(
    (text: string) => {
      const segments = split(text);
      if (segments.length === 1 && !segments[0]!.censored) return text;
      return segments.map((s, i) =>
        s.censored ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of an immutable string
          <CensoredMark key={i}>{s.text}</CensoredMark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of an immutable string
          <Fragment key={i}>{s.text}</Fragment>
        ),
      );
    },
    [split],
  );
}

/**
 * Prose as one string, censored for viewers who asked for it, with each
 * censored run carrying the explanation on hover. Renders text and marks
 * only, so it drops into any `Text` or heading.
 */
export function Censored({ children }: { children: string | null | undefined }) {
  const render = useCensorNodes();
  if (children == null || children.length === 0) return null;
  return <>{render(children)}</>;
}
