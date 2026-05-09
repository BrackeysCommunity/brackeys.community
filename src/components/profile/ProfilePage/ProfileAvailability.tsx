import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Heading, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

import { formatCommitment, type ProfileAvailability as ProfileAvailabilityModel } from "./helpers";
import { EditSectionAction, ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileAvailabilitySectionProps {
  index: string;
  availability: ProfileAvailabilityModel;
  isOwner: boolean;
  onEdit: () => void;
  /** Where "CONTACT" routes — typically a `mailto:` or the user's
   * preferred contact link. Hidden when null. */
  contactHref?: string | null;
}

const STATE_LABEL: Record<ProfileAvailabilityModel["state"], string> = {
  open: "Open to hire",
  selective: "Selectively open",
  closed: "Not currently hiring",
};

/**
 * `§NN AVAILABILITY` block. Emphasizes the headline state ("Open to
 * hire" in success colour), with a row of two stat tiles (response
 * time / timezone) and a `CONTACT` outline button on desktop.
 *
 * Mirrors the wireframe's mobile card (centered headline, contact
 * button to the right, two stat sub-tiles below).
 */
export function ProfileAvailabilitySection({
  index,
  availability,
  isOwner,
  onEdit,
  contactHref = null,
}: ProfileAvailabilitySectionProps) {
  const isOpen = availability.state === "open";

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index={index}
        title="AVAILABILITY"
        action={isOwner ? <EditSectionAction onEdit={onEdit} /> : null}
      />
      <Well className="gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Heading
              as="h3"
              className={`text-2xl leading-tight ${isOpen ? "text-success" : "text-foreground"}`}
            >
              {STATE_LABEL[availability.state]}
            </Heading>
            <Text monospace size="xs" variant="muted" className="tracking-widest">
              {[formatCommitment(availability.commitment), availability.rate]
                .filter(Boolean)
                .join(" · ") || "—"}
            </Text>
          </div>
          {contactHref ? (
            <Button
              variant="outline"
              size="sm"
              render={
                <a
                  href={contactHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Contact"
                />
              }
            >
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
              <span className="font-mono tracking-widest">CONTACT</span>
            </Button>
          ) : null}
        </div>

        {availability.responseTime || availability.timezone ? (
          <div className="grid grid-cols-2 gap-3">
            {availability.responseTime ? (
              <SubTile label="RESPONSE" value={availability.responseTime} />
            ) : null}
            {availability.timezone ? (
              <SubTile label="TIMEZONE" value={availability.timezone} />
            ) : null}
          </div>
        ) : null}
      </Well>
    </section>
  );
}

function SubTile({ label, value }: { label: string; value: string }) {
  return (
    <Chonk variant="surface" size="lg" className="flex flex-col gap-1.5 px-3 py-2.5">
      <Text monospace size="xs" variant="muted" className="tracking-widest">
        {label}
      </Text>
      <Text monospace bold className="text-2xl tabular-nums">
        {value}
      </Text>
    </Chonk>
  );
}
