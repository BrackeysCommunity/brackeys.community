import { HourglassIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

import type { ProfileSkill } from "./helpers";
import { ProfileEmptyState } from "./ProfileEmptyState";
import { AddSectionAction, ProfileSectionHeader } from "./ProfileSectionHeader";

interface ProfileSkillsSectionProps {
  index: string;
  skills: ProfileSkill[];
  isOwner: boolean;
  onEdit: () => void;
}

/**
 * `§NN SKILLS [N]` — wrap-flow tag cloud of the user's listed
 * skills, with active vs. pending visually distinguished (pending
 * skill-requests render in a dashed-outline chip so the moderation
 * status is visible at a glance).
 */
export function ProfileSkillsSection({
  index,
  skills,
  isOwner,
  onEdit,
}: ProfileSkillsSectionProps) {
  const active = skills.filter((s) => s.state === "active");
  const pending = skills.filter((s) => s.state === "pending");

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index={index}
        title="SKILLS"
        action={isOwner ? <AddSectionAction onAdd={onEdit} /> : null}
      />
      {skills.length === 0 ? (
        <ProfileEmptyState
          glyph="#"
          title="No skills listed yet"
          hint="Tag the tools and disciplines you actually ship with so collaborators can match against you."
          cta={isOwner ? { label: "+ ADD SKILLS", onClick: onEdit } : undefined}
        />
      ) : (
        <Well className="gap-3 p-3">
          <SkillCloud skills={active} state="active" />
          {pending.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t border-muted/30 pt-3">
              <Text monospace size="xs" variant="muted" className="tracking-widest">
                PENDING REVIEW · {pending.length}
              </Text>
              <SkillCloud skills={pending} state="pending" />
            </div>
          ) : null}
        </Well>
      )}
    </section>
  );
}

function SkillCloud({ skills, state }: { skills: ProfileSkill[]; state: "active" | "pending" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <SkillChip key={skill.id} skill={skill} state={state} />
      ))}
    </div>
  );
}

function SkillChip({ skill, state }: { skill: ProfileSkill; state: "active" | "pending" }) {
  if (state === "pending") {
    return (
      <Badge variant="warning" className="gap-1.5 font-mono text-[11px] tracking-widest uppercase">
        <HugeiconsIcon icon={HourglassIcon} size={10} />
        {skill.name}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="font-mono text-[11px] tracking-widest uppercase">
      {skill.name}
      {skill.category ? (
        <span className="ml-1 text-muted-foreground">· {skill.category}</span>
      ) : null}
    </Badge>
  );
}
