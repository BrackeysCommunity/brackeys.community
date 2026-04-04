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
            <span className="font-mono text-[9px] font-bold tracking-widest text-muted-foreground/40 uppercase mb-1.5 block">
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
          className="inline-flex items-center px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest uppercase border border-brackeys-yellow/30 text-brackeys-yellow/90 bg-brackeys-yellow/5 hover:bg-brackeys-yellow/15 hover:border-brackeys-yellow/50 transition-colors"
        >
          {skill.name}
        </span>
      ))}
    </div>
  );
}
