import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useMagnetic } from '@/lib/hooks/use-cursor';

const fieldSpring = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;
const inputCls = 'w-full bg-transparent border border-muted/20 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/25 outline-none focus:border-primary/40 transition-colors';

export function EditableProjectCard({
  project,
  onRemove,
}: {
  project: { id: number; title: string; description?: string | null; url?: string | null; imageUrl?: string | null; status: string };
  onRemove: () => void;
}) {
  return (
    <div className="group border border-muted/20 bg-muted/5 hover:border-muted/40 hover:bg-muted/10 transition-colors overflow-hidden">
      {project.imageUrl && (
        <img src={project.imageUrl} alt={project.title} className="w-full h-28 object-cover border-b border-muted/20" />
      )}
      <div className="p-3 space-y-1.5">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[11px] font-bold text-foreground uppercase tracking-wider truncate">{project.title}</span>
            {project.status === 'pending' && (
              <span className="shrink-0 bg-brackeys-yellow/10 border border-brackeys-yellow/25 px-1.5 py-0.5 font-mono text-[9px] text-brackeys-yellow uppercase tracking-wider">
                PENDING
              </span>
            )}
          </div>
          <button type="button" onClick={onRemove} className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all shrink-0">
            <HugeiconsIcon icon={Delete02Icon} size={12} />
          </button>
        </div>
        {project.description && (
          <p className="font-mono text-[10px] text-muted-foreground/60 line-clamp-2 leading-relaxed">{project.description}</p>
        )}
        {project.url && (
          <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] text-primary/60 hover:text-primary transition-colors truncate block">
            {project.url}
          </a>
        )}
      </div>
    </div>
  );
}

export function AddProjectForm({ onAdd }: { onAdd: (data: { title: string; description?: string; url?: string; imageUrl?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onAdd({
      title: title.trim(),
      description: description.trim() || undefined,
      url: url.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
    });
    setTitle('');
    setDescription('');
    setUrl('');
    setImageUrl('');
    setOpen(false);
  };

  const { ref, position } = useMagnetic(0);

  if (!open) {
    return (
      <motion.button
        ref={ref as React.RefObject<HTMLButtonElement>}
        data-magnetic
        data-cursor-no-drift
        animate={{ x: position.x, y: position.y }}
        transition={fieldSpring}
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border border-dashed border-muted/25 py-3 font-mono text-[10px] text-muted-foreground/50 hover:border-primary/40 hover:text-primary transition-colors uppercase tracking-widest flex items-center justify-center gap-1.5"
      >
        <HugeiconsIcon icon={Add01Icon} size={10} />
        Add Project
      </motion.button>
    );
  }

  return (
    <div className="border border-primary/20 bg-primary/3 p-3 space-y-2">
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Project title *" className={inputCls} />
      <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" className={inputCls} />
      <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL (itch.io, GitHub...)" className={inputCls} />
      <input type="text" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Cover image URL" className={inputCls} />
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={handleSubmit} className="flex-1 bg-primary/15 border border-primary/30 py-1.5 font-mono text-[10px] text-primary uppercase tracking-widest hover:bg-primary/25 transition-colors">
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="flex-1 border border-muted/20 py-1.5 font-mono text-[10px] text-muted-foreground/50 uppercase tracking-widest hover:border-muted/40 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
