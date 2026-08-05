import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { LinkProps as RouterLinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Chonk } from "@/components/ui/chonk";
import { Heading, Link, Text } from "@/components/ui/typography";

interface SectionProps {
  /** Anchor target, so a section is linkable from outside the page. */
  id?: string;
  title: string;
  blurb?: string;
  /** Trailing slot on the heading line — the section's "go to the real
   * page" control. Use {@link SectionAction}. */
  action?: ReactNode;
  /** `sm` is for sections sharing a row, where a 3xl heading would shout
   * over the full-width ones above it. */
  size?: "default" | "sm";
  children: ReactNode;
}

/**
 * A titled page section: heading, optional blurb, optional trailing
 * action, and the content beneath. `scroll-mt` clears the fixed app header
 * when a `#hash` lands on one.
 *
 * The section is a flex column, so a child marked `flex-1` fills whatever
 * height the section is given — which is how two sections sharing a grid
 * row end their panels on the same line.
 */
export function Section({ id, title, blurb, action, size = "default", children }: SectionProps) {
  return (
    // `min-w-0` is load-bearing wherever a section is a grid item: a grid
    // item's automatic minimum size is its content's min-content width.
    // Truncating list rows are `white-space: nowrap`, so their min-content
    // is the *untruncated* text — without this the column inflates to the
    // longest row and nothing ever truncates.
    <section id={id} className="flex min-w-0 scroll-mt-20 flex-col gap-3">
      <header className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-4">
          <Heading
            as="h2"
            className={size === "sm" ? "text-xl md:text-2xl" : "text-2xl md:text-3xl"}
          >
            {title}
          </Heading>
          {action}
        </div>
        {blurb && (
          <Text as="p" size="md" variant="muted">
            {blurb}
          </Text>
        )}
      </header>
      {children}
    </section>
  );
}

interface SectionActionProps {
  /** Router path for the section's full page. */
  to: RouterLinkProps["to"];
  children: ReactNode;
}

/**
 * A section header's button. Same `Chonk variant="surface"` treatment as
 * the OPEN buttons inside list rows, so a page has one shape for "leave
 * this summary and go to the real thing".
 */
export function SectionAction({ to, children }: SectionActionProps) {
  return (
    <Chonk
      variant="surface"
      size="sm"
      render={<Link as="router" to={to} variant="inherit" />}
      className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold tracking-widest whitespace-nowrap text-muted-foreground hover:text-primary"
    >
      {children}
      <HugeiconsIcon icon={ArrowRight02Icon} size={12} />
    </Chonk>
  );
}
