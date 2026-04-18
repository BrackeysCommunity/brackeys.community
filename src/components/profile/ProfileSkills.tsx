import { cn } from "@/lib/utils";

interface Skill {
  id: number;
  name: string;
  category: string | null;
}

interface ProfileSkillsProps {
  skills: Skill[];
  className?: string;
}

export function ProfileSkills({ skills, className }: ProfileSkillsProps) {
  if (skills.length === 0) return null;

  const grouped = new Map<string, Skill[]>();
  for (const skill of skills) {
    const cat = skill.category ?? "Other";
    const existing = grouped.get(cat);
    if (existing) {
      existing.push(skill);
    } else {
      grouped.set(cat, [skill]);
    }
  }

  const hasCategories = grouped.size > 1 || !grouped.has("Other");

  return (
    <div className={cn("space-y-3", className)}>
      {hasCategories ? (
        Array.from(grouped.entries()).map(([category, catSkills]) => (
          <div key={category}>
            <span className="mb-1.5 block font-mono text-[9px] font-bold tracking-widest text-muted-foreground/40 uppercase">
              {category}
            </span>
            <SkillTagList skills={catSkills} />
          </div>
        ))
      ) : (
        <SkillTagList skills={skills} />
      )}
    </div>
  );
}

function SkillTagList({ skills }: { skills: Skill[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((skill) => (
        <span
          key={skill.id}
          className="inline-flex items-center border border-brackeys-yellow/30 bg-brackeys-yellow/5 px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-brackeys-yellow/90 uppercase transition-colors hover:border-brackeys-yellow/50 hover:bg-brackeys-yellow/15"
        >
          {skill.name}
        </span>
      ))}
    </div>
  );
}
