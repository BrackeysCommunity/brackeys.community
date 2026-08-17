import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Section } from "@/components/ui/section";
import { Heading, MicroLabel, Prose, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

import { CONTACT, EFFECTIVE_DATE, LAST_UPDATED } from "./legal-meta";

export interface LegalSection {
  /** Anchor fragment — stable, because people link to clauses. */
  id: string;
  heading: string;
  body: ReactNode;
}

interface LegalDocumentProps {
  /** Section marker above the title, e.g. `"§ Legal / Terms"`. */
  marker: string;
  title: string;
  /** One-line statement of what the document governs. */
  summary: string;
  /** Plain-language orientation shown above the contents; not operative. */
  atAGlance: ReactNode;
  sections: LegalSection[];
}

/**
 * Shared shell for the terms and the privacy policy: title block, dates,
 * a summary well, a linked table of contents, and numbered sections.
 *
 * Clause numbers come from the array order rather than being written into
 * the copy, so inserting a section renumbers the document instead of
 * silently making every cross-reference wrong. Cross-references in the
 * copy therefore name sections rather than numbering them.
 */
export function LegalDocument({ marker, title, summary, atAGlance, sections }: LegalDocumentProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-8">
      <header className="flex flex-col gap-3">
        <MicroLabel as="p" className="uppercase">
          {marker}
        </MicroLabel>
        <Heading as="h1" size="3xl" display>
          {title}
        </Heading>
        <Text as="p" variant="muted" textWrap="pretty">
          {summary}
        </Text>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1">
          <MicroLabel as="p" className="uppercase">
            § Effective {EFFECTIVE_DATE}
          </MicroLabel>
          <MicroLabel as="p" className="uppercase">
            § Last updated {LAST_UPDATED}
          </MicroLabel>
        </div>
      </header>

      <Well className="gap-2 p-5" variant="ghost">
        <MicroLabel as="p" className="uppercase">
          § In brief
        </MicroLabel>
        <Text as="div" size="sm" variant="muted" textWrap="pretty">
          {atAGlance}
        </Text>
        <Text as="p" size="xs" variant="muted" className="pt-1">
          This summary is for orientation only. The numbered sections below are what governs.
        </Text>
      </Well>

      <nav aria-label="Contents" className="flex flex-col gap-3">
        <MicroLabel as="p" className="uppercase">
          § Contents
        </MicroLabel>
        <ol className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {sections.map((section, index) => (
            <li key={section.id} className="flex items-baseline gap-2">
              <MicroLabel className="shrink-0 tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </MicroLabel>
              <a
                href={`#${section.id}`}
                className="font-sans text-sm text-foreground transition-colors hover:text-primary"
              >
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col gap-8">
        {sections.map((section, index) => (
          // `sm` rather than the default: a clause heading sits under the
          // document's own 3xl title, and the two shout over each other at
          // matching sizes. The clause number rides the heading line's
          // trailing slot, where it stays legible without competing with
          // the heading for the first word of the line.
          <Section
            key={section.id}
            id={section.id}
            title={section.heading}
            size="sm"
            action={<MicroLabel as="span">§ {String(index + 1).padStart(2, "0")}</MicroLabel>}
          >
            <Prose>{section.body}</Prose>
          </Section>
        ))}
      </div>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-muted/30 pt-4">
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
        <a
          href={`mailto:${CONTACT.legal}`}
          className="font-sans text-sm text-foreground transition-colors hover:text-primary"
        >
          {CONTACT.legal}
        </a>
        <Link
          to="/"
          className="font-sans text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          Back to Brackeys
        </Link>
      </footer>
    </div>
  );
}
