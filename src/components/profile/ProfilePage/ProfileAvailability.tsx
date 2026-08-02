import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

import { DetailRow } from "./DetailRow";
import { formatCommitment, type ProfileAvailability as ProfileAvailabilityModel } from "./helpers";
import { EditSectionAction, ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileAvailabilitySectionProps {
  index: string;
  availability: ProfileAvailabilityModel;
  isOwner: boolean;
  onEdit: () => void;
  /** Where "PING FOR WORK" routes — typically a `mailto:` or the
   * user's preferred contact link. Hidden when null. */
  contactHref?: string | null;
}

const STATE_LABEL: Record<ProfileAvailabilityModel["state"], string> = {
  open: "Open to hire",
  selective: "Selectively open",
  closed: "Not currently hiring",
};

/**
 * `§NN HIRE DETAILS` sidebar card — headline availability state, then
 * dashed-leader rows (rate / capacity / response / timezone), then
 * the contact CTAs ("PING FOR WORK" when a contact link exists, and
 * a "SEE COLLAB POSTS" link into the collab board).
 */
export function ProfileAvailabilitySection({
  index,
  availability,
  isOwner,
  onEdit,
  contactHref = null,
}: ProfileAvailabilitySectionProps) {
  const isOpen = availability.state === "open";
  const dotClass =
    availability.state === "open"
      ? "bg-success"
      : availability.state === "selective"
        ? "bg-warning"
        : "bg-muted-foreground";

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index={index}
        title="HIRE DETAILS"
        action={isOwner ? <EditSectionAction onEdit={onEdit} /> : null}
      />
      <Well className="gap-4 p-4">
        <div className="flex items-center gap-2.5">
          <span className={cn("inline-block h-2 w-2 rounded-full", dotClass)} aria-hidden />
          <Heading
            as="h3"
            className={cn("text-xl leading-tight", isOpen ? "text-success" : "text-foreground")}
          >
            {STATE_LABEL[availability.state]}
          </Heading>
        </div>

        <div className="flex flex-col gap-2.5">
          <DetailRow label="Rate" value={availability.rate ?? "—"} />
          <DetailRow label="Capacity" value={formatCommitment(availability.commitment) ?? "—"} />
          {availability.responseTime ? (
            <DetailRow label="Response time" value={availability.responseTime} />
          ) : null}
          {availability.timezone ? (
            <DetailRow label="Timezone" value={availability.timezone} />
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {contactHref ? (
            <Button
              variant="default"
              size="sm"
              render={
                <a
                  href={contactHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Ping for work"
                />
              }
            >
              <span className="tracking-widest">PING FOR WORK</span>
            </Button>
          ) : null}
          <Button variant="outline" size="sm" render={<Link to="/collab" />}>
            <span className="tracking-widest">SEE COLLAB POSTS</span>
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
          </Button>
        </div>
      </Well>
    </section>
  );
}
