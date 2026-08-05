import { Link } from "@tanstack/react-router";

import { Heading, MicroLabel, Prose, Text } from "@/components/ui/typography";

interface LegalPlaceholderPageProps {
  /** Section marker above the title, e.g. `"§ LEGAL / TERMS"`. */
  marker: string;
  title: string;
  /** One-line summary of what the finished document will cover. */
  summary: string;
  /** Working outline — the headings the drafted document will carry. */
  outline: { heading: string; blurb: string }[];
}

/**
 * Shared shell for the not-yet-drafted legal documents (terms, privacy).
 *
 * The footer links to both, so they need real routes rather than `href="#"`
 * — a dead anchor reads as a broken site. Until counsel-reviewed copy
 * exists these pages say plainly that the document is unwritten, show the
 * outline it will follow, and point at the Discord for anything urgent.
 * Replace the whole component body with the real copy when it lands; the
 * routes and footer links do not need to change.
 */
export function LegalPlaceholderPage({
  marker,
  title,
  summary,
  outline,
}: LegalPlaceholderPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-8">
      <div className="flex flex-col gap-3">
        <MicroLabel as="p" className="uppercase">
          {marker}
        </MicroLabel>
        <Heading as="h1" size="3xl" display>
          {title}
        </Heading>
        <Text as="p" variant="muted" textWrap="pretty">
          {summary}
        </Text>
      </div>

      <div className="rounded-md border border-dashed border-muted-foreground/40 bg-card/40 p-5">
        <MicroLabel as="p" variant="warning" className="uppercase">
          § Draft pending
        </MicroLabel>
        <Text as="p" size="sm" variant="muted" className="mt-2" textWrap="pretty">
          This document has not been written yet. Nothing on this page is a binding agreement or a
          statement of current practice. Until it is published, ask in{" "}
          <a
            href="https://discord.gg/brackeys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2 hover:text-accent/80"
          >
            the Discord
          </a>{" "}
          and a moderator will answer directly.
        </Text>
      </div>

      <Prose>
        <h2>What this page will cover</h2>
        <ol>
          {outline.map((item) => (
            <li key={item.heading}>
              <strong>{item.heading}</strong> — {item.blurb}
            </li>
          ))}
        </ol>
      </Prose>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-muted/30 pt-4">
        <Link
          to="/terms"
          className="font-sans text-sm text-foreground transition-colors hover:text-primary"
        >
          Terms of Service
        </Link>
        <Link
          to="/privacy"
          className="font-sans text-sm text-foreground transition-colors hover:text-primary"
        >
          Privacy Policy
        </Link>
        <Link
          to="/"
          className="font-sans text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          Back to Brackeys
        </Link>
      </div>
    </div>
  );
}
