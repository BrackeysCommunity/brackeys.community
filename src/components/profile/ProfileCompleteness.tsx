import { Tick01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { motion } from 'framer-motion';
import { NotchedCard } from '@/components/ui/notched-card';
import { cn } from '@/lib/utils';

export interface CompletenessItem {
  label: string;
  ok: boolean;
}

export function buildCompletenessItems(data: {
  tagline: string | null;
  bio: string | null;
  skills: unknown[];
  githubUrl: string | null;
  twitterUrl: string | null;
  websiteUrl: string | null;
  projects: unknown[];
  jams: unknown[];
}): CompletenessItem[] {
  return [
    { label: 'Tagline', ok: !!data.tagline?.trim() },
    { label: 'Bio', ok: !!data.bio?.trim() },
    { label: 'Skills', ok: data.skills.length > 0 },
    { label: 'Links', ok: !!(data.githubUrl || data.twitterUrl || data.websiteUrl) },
    { label: 'Projects', ok: data.projects.length > 0 },
    { label: 'Jams', ok: data.jams.length > 0 },
  ];
}

export function ProfileCompletenessCard({ items }: { items: CompletenessItem[] }) {
  const score = items.filter((i) => i.ok).length;

  const header = (
    <div className="flex items-center justify-between">
      <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
        Completeness
      </span>
      <span className={cn(
        'font-mono text-xs font-bold',
        score === items.length ? 'text-green-500' : 'text-muted-foreground',
      )}>
        {score}/{items.length}
      </span>
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
                  className={cn(
                    'h-full',
                    item.ok ? 'bg-green-500' : 'bg-transparent',
                  )}
                  initial={false}
                  animate={{
                    scaleX: item.ok ? 1 : 0,
                    opacity: item.ok ? 1 : 0,
                  }}
                  transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                  style={{ originX: 0 }}
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
            {items.map((item) => (
              <motion.div
                key={item.label}
                className="flex items-center gap-2"
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                <motion.div
                  className={cn(
                    'w-3.5 h-3.5 flex items-center justify-center border shrink-0',
                    item.ok
                      ? 'border-green-500/50 bg-green-500/10 text-green-500'
                      : 'border-muted/40',
                  )}
                  animate={{
                    scale: item.ok ? [1, 1.2, 1] : 1,
                    borderColor: item.ok ? 'rgba(34,197,94,0.5)' : 'rgba(128,128,128,0.4)',
                  }}
                  transition={{ duration: 0.3 }}
                >
                  {item.ok && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ duration: 0.2, delay: 0.1 }}
                    >
                      <HugeiconsIcon icon={Tick01Icon} size={8} />
                    </motion.div>
                  )}
                </motion.div>
                <span className={cn(
                  'font-mono text-[10px] tracking-widest uppercase transition-colors duration-200',
                  item.ok
                    ? 'text-muted-foreground/40 line-through decoration-muted-foreground/20'
                    : 'text-muted-foreground',
                )}>
                  {item.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </NotchedCard>
    </div>
  );
}

export function ProfileCompletenessMini({ items }: { items: CompletenessItem[] }) {
  const score = items.filter((i) => i.ok).length;
  return (
    <div className="px-4 py-3 border-b border-muted/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">Completeness</span>
        <span className="font-mono text-[10px] text-primary">{score}/{items.length}</span>
      </div>
      <div className="flex gap-0.5">
        {items.map((item) => (
          <motion.div
            key={item.label}
            className="h-1 flex-1 bg-muted/20 overflow-hidden"
            title={item.label}
          >
            <motion.div
              className="h-full bg-primary"
              initial={false}
              animate={{ scaleX: item.ok ? 1 : 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              style={{ originX: 0 }}
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
