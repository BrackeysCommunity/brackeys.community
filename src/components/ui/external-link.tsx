import { Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { MicroLabel, Link as TextLink } from "@/components/ui/typography";
import { externalUrlHost } from "@/lib/external-url";
import { cn } from "@/lib/utils";

/**
 * An off-site destination, in the micro-label voice, with the host it
 * actually goes to next to it.
 *
 * The host is the point. Every label on an outbound link in this app is
 * member-supplied or member-influenced — a project's extra links carry a
 * free-text label, a team's rows are typed by whoever set the URL — so a
 * link reading ITCH.IO proved nothing about where it went. Showing the
 * host is the general answer that works even where no label makes a claim;
 * `isHostOrSubdomainOf` is the specific one for a label that does.
 *
 * Rendering nothing for an unrenderable URL is deliberate: rows stored
 * before the schema tightened can still hold a `javascript:` link.
 */
export function ExternalLink({
  href,
  label,
  className,
  onClick,
}: {
  href: string | null | undefined;
  /** Omit to let the host stand alone as the link's whole name. */
  label?: string;
  className?: string;
  onClick?: () => void;
}) {
  const host = externalUrlHost(href);
  if (!host || !href) return null;

  return (
    <TextLink
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      size="xs"
      className={cn("inline-flex items-baseline gap-1.5", className)}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1 tracking-widest text-primary uppercase hover:underline">
        <HugeiconsIcon icon={Link01Icon} size={11} />
        {label ?? host}
      </span>
      {label ? (
        <MicroLabel as="span" className="min-w-0 truncate normal-case">
          {host}
        </MicroLabel>
      ) : null}
    </TextLink>
  );
}
