import { Link01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { cn } from '@/lib/utils';

interface Project {
  id: number;
  title: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  tags: string[] | null;
  pinned: boolean | null;
  status: string;
}

interface ProfileProjectsProps {
  projects: Project[];
  className?: string;
}

export function ProfileProjects({ projects, className }: ProfileProjectsProps) {
  if (projects.length === 0) return null;

  const sorted = [...projects].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  });

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {sorted.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <div className="group border border-muted/60 bg-card/30 transition-all duration-200 hover:border-muted hover:bg-card/60 hover:-translate-y-0.5 hover:shadow-[2px_2px_0px_var(--color-muted)]">
      {project.imageUrl && (
        <img
          src={project.imageUrl}
          alt={project.title}
          className="w-full h-28 object-cover border-b border-muted/40 grayscale group-hover:grayscale-0 transition-all duration-500"
        />
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <h5 className="font-mono text-xs font-bold tracking-widest text-foreground uppercase group-hover:text-primary transition-colors">
            {project.pinned && (
              <span className="text-brackeys-yellow mr-1.5" title="Pinned">*</span>
            )}
            {project.title}
          </h5>
          {project.url && (
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground/50 hover:text-primary transition-colors shrink-0"
            >
              <HugeiconsIcon icon={Link01Icon} size={12} />
            </a>
          )}
        </div>
        {project.description && (
          <p className="font-sans text-xs text-muted-foreground/70 mt-1.5 line-clamp-2 leading-relaxed">
            {project.description}
          </p>
        )}
        {project.tags && project.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {project.tags.map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground/50 border border-muted/30 uppercase hover:text-muted-foreground hover:border-muted/60 transition-colors"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
