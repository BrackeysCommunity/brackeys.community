import { ContributionCalendar } from "@/components/profile/ContributionCalendar";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

import { ProfileEmptyState } from "./ProfileEmptyState";
import { ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileActivitySectionProps {
  index: string;
  /** Profile id whose GitHub contributions get fetched + rendered
   * via `ContributionCalendar`. */
  profileId: string;
  /** When set, drives the section's `GITHUB · @{name}` sub-line.
   * When null we fall back to the friendly empty state. */
  githubUsername: string | null;
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
}: ProfileActivitySectionProps) {
  if (!githubUsername) {
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
          <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
            @{githubUsername}
          </Text>
        }
      />
      <Well className="overflow-hidden">
        <ContributionCalendar userId={profileId} />
      </Well>
    </section>
  );
}
