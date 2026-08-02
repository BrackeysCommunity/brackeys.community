import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { FieldRow } from "./fields";

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
 * opposed to `RoleSearchPanel`'s "which seat are you filling".
 *
 * Deliberately backed by the same `user.skills` vocabulary the profiles
 * use rather than a third tag table: shared ids are what let a post say
 * "this applicant matches Godot, C#" instead of comparing spellings.
 */
export function SkillSearchPanel({ skillIds, onChange, offerMySkills }: SkillSearchPanelProps) {
  const [search, setSearch] = useState("");
  const { data: allSkills } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: myProfile } = useQuery({
    ...orpc.getMyProfile.queryOptions({ input: {} }),
    enabled: !!offerMySkills,
    staleTime: 60 * 1000,
  });

  const skills = useMemo(() => allSkills ?? [], [allSkills]);
  const byId = useMemo(() => new Map(skills.map((s) => [s.id, s])), [skills]);
  const atCap = skillIds.length >= MAX_POST_SKILLS;

  // Search narrows the browsable list; selected chips always stay
  // visible above it so a filtered view never hides what's already on.
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = skills.filter(
      (s) => !skillIds.includes(s.id) && (!q || s.name.toLowerCase().includes(q)),
    );
    const map = new Map<string, typeof matches>();
    for (const skill of matches) {
      const key = skill.category ?? "Other";
      const bucket = map.get(key);
      if (bucket) bucket.push(skill);
      else map.set(key, [skill]);
    }
    return [...map.entries()];
  }, [skills, skillIds, search]);

  const myUnusedSkillIds = useMemo(() => {
    const mine = myProfile?.skills ?? [];
    return mine.map((s) => s.skillId).filter((id) => !skillIds.includes(id));
  }, [myProfile, skillIds]);

  const add = (id: number) => {
    if (skillIds.includes(id) || atCap) return;
    onChange([...skillIds, id]);
  };
  const remove = (id: number) => onChange(skillIds.filter((x) => x !== id));

  return (
    <FieldRow
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
    >
      {skillIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {skillIds.map((id) => (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => remove(id)}
              aria-label={`Remove ${byId.get(id)?.name ?? "skill"}`}
              className="border-primary/50 tracking-widest text-primary"
            >
              {byId.get(id)?.name ?? `#${id}`}
              <HugeiconsIcon icon={Cancel01Icon} size={10} />
            </Button>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search engines, languages, tools…"
          className="pl-8"
        />
      </div>

      {atCap ? (
        <Text size="xs" variant="muted">
          {MAX_POST_SKILLS} is the limit — remove one to add another.
        </Text>
      ) : groups.length === 0 ? (
        <Text size="xs" variant="muted">
          {search.trim() ? "Nothing matches that search." : "No skills available."}
        </Text>
      ) : (
        <div className="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
          {groups.map(([category, categorySkills]) => (
            <div key={category} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Text
                  as="span"
                  size="xs"
                  variant="muted"
                  className="shrink-0 tracking-widest text-foreground/80 uppercase"
                >
                  {category}
                </Text>
                <span aria-hidden className="h-px flex-1 bg-muted/40" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {categorySkills.map((skill) => (
                  <Toggle
                    key={skill.id}
                    variant="outline"
                    size="sm"
                    pressed={false}
                    onPressedChange={() => add(skill.id)}
                    className={cn(
                      "rounded bg-background px-2.5 text-xs tracking-widest dark:bg-emboss-surface",
                    )}
                  >
                    {skill.name}
                  </Toggle>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </FieldRow>
  );
}
