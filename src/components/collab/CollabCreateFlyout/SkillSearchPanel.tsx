import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { orpc } from "@/orpc/client";

import { TagPickerPanel } from "./TagPickerPanel";

/** A post's stack is a shortlist, not a tag dump. Mirrors the server cap. */
export const MAX_POST_SKILLS = 10;

interface SkillSearchPanelProps {
  skillIds: number[];
  onChange: (skillIds: number[]) => void;
  /** Offers a one-tap prefill from the poster's own profile skills. */
  offerMySkills?: boolean;
}

/**
 * Tech-stack picker for a post — "what would I be working in", as
 * opposed to `RoleSearchPanel`'s "which seat are you filling". Both are
 * the same control; see `TagPickerPanel`.
 *
 * Deliberately backed by the same `user.skills` vocabulary the profiles
 * use rather than a third tag table: shared ids are what let a post say
 * "this applicant matches Godot, C#" instead of comparing spellings.
 */
export function SkillSearchPanel({ skillIds, onChange, offerMySkills }: SkillSearchPanelProps) {
  const { data: allSkills } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: myProfile } = useQuery({
    ...orpc.getMyProfile.queryOptions({ input: {} }),
    enabled: !!offerMySkills,
    staleTime: 60 * 1000,
  });

  const atCap = skillIds.length >= MAX_POST_SKILLS;

  const myUnusedSkillIds = useMemo(() => {
    const mine = myProfile?.skills ?? [];
    return mine.map((s) => s.skillId).filter((id) => !skillIds.includes(id));
  }, [myProfile, skillIds]);

  return (
    <TagPickerPanel
      label="TECH STACK"
      hint={`optional · ${skillIds.length}/${MAX_POST_SKILLS}`}
      action={
        offerMySkills && myUnusedSkillIds.length > 0 && !atCap ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="tracking-widest"
            onClick={() => onChange([...skillIds, ...myUnusedSkillIds].slice(0, MAX_POST_SKILLS))}
          >
            USE MY SKILLS
          </Button>
        ) : null
      }
      options={allSkills ?? []}
      selectedIds={skillIds}
      onChange={onChange}
      searchPlaceholder="Search engines, languages, tools…"
      emptyMessage="No skills available."
      max={MAX_POST_SKILLS}
      atCapMessage={`${MAX_POST_SKILLS} is the limit — remove one to add another.`}
    />
  );
}
