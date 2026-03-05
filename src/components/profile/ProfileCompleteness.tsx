import { Clock01Icon, Tick01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { motion } from 'framer-motion';
import { NotchedCard } from '@/components/ui/notched-card';
import { cn } from '@/lib/utils';

export type CompletenessStatus = 'done' | 'pending' | 'empty';

export interface CompletenessItem {
  label: string;
  status: CompletenessStatus;
}

export function buildCompletenessItems(data: {
  tagline: string | null;
  bio: string | null;
  skills: unknown[];
  pendingSkillCount?: number;
  githubUrl?: string | null;
  twitterUrl?: string | null;
  websiteUrl: string | null;
  projects: Array<{ status?: string }>;
  jams: unknown[];
}): CompletenessItem[] {
  const approvedProjects = data.projects.filter((p) => p.status !== 'pending');
  const pendingProjects = data.projects.filter((p) => p.status === 'pending');

  return [
    { label: 'Tagline', status: data.tagline?.trim() ? 'done' : 'empty' },
    { label: 'Bio', status: data.bio?.trim() ? 'done' : 'empty' },
    {
      label: 'Skills',
      status: data.skills.length > 0
        ? 'done'
        : (data.pendingSkillCount ?? 0) > 0 ? 'pending' : 'empty',
    },
    { label: 'Links', status: (data.githubUrl || data.twitterUrl || data.websiteUrl) ? 'done' : 'empty' },
    {
      label: 'Projects',
      status: approvedProjects.length > 0
        ? 'done'
        : pendingProjects.length > 0 ? 'pending' : 'empty',
    },
    { label: 'Jams', status: data.jams.length > 0 ? 'done' : 'empty' },
  ];
}

const barColors: Record<CompletenessStatus, string> = {
  done: 'bg-green-500',
  pending: 'bg-brackeys-yellow',
  empty: 'bg-transparent',
};

const checkboxStyles: Record<CompletenessStatus, string> = {
  done: 'border-green-500/50 bg-green-500/10 text-green-500',
  pending: 'border-brackeys-yellow/50 bg-brackeys-yellow/10 text-brackeys-yellow',
  empty: 'border-muted/40',
};

const labelStyles: Record<CompletenessStatus, string> = {
  done: 'text-muted-foreground/40 line-through decoration-muted-foreground/20',
  pending: 'text-brackeys-yellow/60',
  empty: 'text-muted-foreground',
};

export function ProfileCompletenessCard({ items }: { items: CompletenessItem[] }) {
  const doneCount = items.filter((i) => i.status === 'done').length;
  const pendingCount = items.filter((i) => i.status === 'pending').length;

  const header = (
    <div className="flex items-center justify-between">
      <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
        Completeness
      </span>
      <div className="flex items-center gap-2">
        {pendingCount > 0 && (
          <span className="font-mono text-[10px] text-brackeys-yellow/60">
            {pendingCount} pending
          </span>
        )}
        <span className={cn(
          'font-mono text-xs font-bold',
          doneCount === items.length ? 'text-green-500' : 'text-muted-foreground',
        )}>
          {doneCount}/{items.length}
        </span>
      </div>
    </div>
  );

  return (
    <div className="my-6 sm:mt-12 pointer-events-auto">
      <NotchedCard header={header} scrollable={false}>
        <div className="p-4 space-y-4">
          <div className="flex gap-1">
            {items.map((item) => (
              <div key={item.label} className="flex-1 h-2 bg-muted/20 overflow-hidden">
                <motion.div
                  className={barColors[item.status]}
                  initial={false}
                  animate={{
                    scaleX: item.status !== 'empty' ? 1 : 0,
                    opacity: item.status !== 'empty' ? 1 : 0,
                  }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                  style={{ originX: 0, height: '100%' }}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
            {items.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <div
                  className={cn(
                    'w-3.5 h-3.5 flex items-center justify-center border shrink-0 transition-colors duration-300',
                    checkboxStyles[item.status],
                  )}
                >
                  {item.status === 'done' && (
                    <HugeiconsIcon icon={Tick01Icon} size={8} />
                  )}
                  {item.status === 'pending' && (
                    <HugeiconsIcon icon={Clock01Icon} size={7} />
                  )}
                </div>
                <span className={cn(
                  'font-mono text-[10px] tracking-widest uppercase transition-colors duration-200',
                  labelStyles[item.status],
                )}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </NotchedCard>
    </div>
  );
}

export function ProfileCompletenessMini({ items }: { items: CompletenessItem[] }) {
  const doneCount = items.filter((i) => i.status === 'done').length;
  return (
    <div className="px-4 py-3 border-b border-muted/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">Completeness</span>
        <span className="font-mono text-[10px] text-primary">{doneCount}/{items.length}</span>
      </div>
      <div className="flex gap-0.5">
        {items.map((item) => (
          <motion.div
            key={item.label}
            className="h-1 flex-1 bg-muted/20 overflow-hidden"
            title={`${item.label}: ${item.status}`}
          >
            <motion.div
              className={cn('h-full', item.status === 'done' ? 'bg-primary' : item.status === 'pending' ? 'bg-brackeys-yellow' : '')}
              initial={false}
              animate={{ scaleX: item.status !== 'empty' ? 1 : 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              style={{ originX: 0 }}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
