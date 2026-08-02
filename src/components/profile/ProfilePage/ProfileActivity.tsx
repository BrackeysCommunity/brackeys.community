import { ContributionCalendar } from "@/components/profile/ContributionCalendar";
import { Well } from "@/components/ui/well";

import { ProfileEmptyState } from "./ProfileEmptyState";
import { ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileActivitySectionProps {
  index: string;
  /** Profile id whose GitHub contributions get fetched + rendered
   * via `ContributionCalendar`. */
  profileId: string;
  /** When set, drives the section's `GITHUB · @{name}` sub-line.
   * When null, owners see a "link GitHub" empty state and visitors
   * see nothing at all. */
  githubUsername: string | null;
  isOwner: boolean;
}

/**
 * `§NN ACTIVITY` — wraps the existing `ContributionCalendar` so the
 * snake-game / contribution-grid lives inside the new section
 * chrome. We pass through the profile id and let
 * `ContributionCalendar` own the data fetch (via
 * `client.getContributions`) and the snake interactions.
 */
export function ProfileActivitySection({
  index,
  profileId,
  githubUsername,
  isOwner,
}: ProfileActivitySectionProps) {
  if (!githubUsername) {
    if (!isOwner) return null;
    return (
      <section className="flex flex-col gap-3">
        <ProfileSectionHeader index={index} title="ACTIVITY" />
        <ProfileEmptyState
          glyph="▦"
          title="No activity yet"
          hint="Link a GitHub account from the LINKED section to see your contribution graph here."
        />
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index={index}
        title="ACTIVITY"
        action={
          <a
            href={`https://github.com/${githubUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            @{githubUsername}
          </a>
        }
      />
      <Well className="overflow-hidden">
        <ContributionCalendar userId={profileId} />
      </Well>
    </section>
  );
}
