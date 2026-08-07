import { Link as RouterLink } from "@tanstack/react-router";

import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { projectTypeLabel } from "@/lib/project-links";

import type { ProfileCredit } from "./helpers";
import { ProfileSectionHeader } from "./ProfileSectionHeader";

/**
 * `§NN CREDITS` — projects the member is credited on without showcasing
 * them: a teammate added their name, a sync lifted it off a jam entry, or
 * they took a credit on someone else's page. The portfolio they get for
 * free, and the reason to keep credits accurate.
 *
 * Renders nothing when empty — an empty-state here would nag people about
 * a list other people mostly write.
 */
export function ProfileCreditsSection({
  index,
  credits,
}: {
  index: string;
  credits: ProfileCredit[];
}) {
  if (credits.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader index={index} title="CREDITS" />
      <Well className="overflow-hidden p-0">
        <ul className="flex flex-col divide-y divide-muted/30">
          {credits.map((credit) => (
            <li key={credit.id}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <RouterLink
                  to="/projects/$projectSlug"
                  params={{ projectSlug: credit.slug }}
                  className="min-w-0 hover:text-primary"
                >
                  <Text as="span" size="md" bold className="truncate hover:underline">
                    {credit.title}
                  </Text>
                </RouterLink>
                <Text as="span" size="sm" variant="muted" className="min-w-0 truncate">
                  {[credit.role, credit.teamName ? `with ${credit.teamName}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <MicroLabel>{projectTypeLabel({ type: credit.kind })}</MicroLabel>
                  {credit.year != null ? (
                    <MicroLabel className="tabular-nums opacity-70">{credit.year}</MicroLabel>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Well>
    </section>
  );
}
