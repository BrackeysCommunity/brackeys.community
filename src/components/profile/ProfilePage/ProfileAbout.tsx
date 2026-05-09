import { Text } from "@/components/ui/typography";
import { MarkedText } from "@/components/ui/typography/marked-text";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

import { EditSectionAction, ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileAboutProps {
  bio: string | null;
  pinnedNote: string | null;
  isOwner: boolean;
  onEdit: () => void;
  /** Mobile compresses spacing slightly. */
  compact?: boolean;
}

/**
 * `§01 ABOUT` block — long-form bio (markdown-formatted) plus an
 * optional pinned callout for "currently free for paid gigs"-style
 * notes. Renders inside the standard dotted-rule section header so it
 * matches the rest of the profile's coded block delimiters.
 */
export function ProfileAbout({ bio, pinnedNote, isOwner, onEdit, compact }: ProfileAboutProps) {
  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index="01"
        title="ABOUT"
        action={isOwner ? <EditSectionAction onEdit={onEdit} /> : null}
      />
      <Well className={cn("gap-3 p-4", compact ? "text-sm" : "text-base")}>
        {bio ? (
          <MarkedText className="text-foreground/90">{bio}</MarkedText>
        ) : (
          <Text variant="muted" size="sm" className="italic">
            No bio yet.
          </Text>
        )}
        {pinnedNote ? (
          <div className="flex items-start gap-3 border-t border-muted/30 pt-3">
            <Text
              as="span"
              monospace
              size="xs"
              variant="muted"
              className="shrink-0 tracking-widest"
            >
              ↳ PINNED
            </Text>
            <Text size="sm" className="text-foreground/90">
              {pinnedNote}
            </Text>
          </div>
        ) : null}
      </Well>
    </section>
  );
}
