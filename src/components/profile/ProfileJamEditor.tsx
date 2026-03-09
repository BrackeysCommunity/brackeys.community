import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useMagnetic } from '@/lib/hooks/use-cursor';

const fieldSpring = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;
const inputCls = 'w-full bg-transparent border border-muted/20 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/25 outline-none focus:border-primary/40 transition-colors';

export function EditableJamEntry({
  jam,
  onRemove,
}: {
  jam: { id: string; jamName: string; submissionTitle?: string | null; result?: string | null };
  onRemove: () => void;
}) {
  return (
    <div className="group border border-muted/20 bg-muted/5 hover:border-muted/40 transition-colors p-3">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[11px] font-bold text-foreground uppercase tracking-wider block truncate">{jam.jamName}</span>
          {jam.submissionTitle && (
            <p className="font-mono text-[10px] text-muted-foreground/60 mt-0.5 truncate">{jam.submissionTitle}</p>
          )}
          {jam.result && (
            <span className="inline-block mt-1.5 bg-brackeys-yellow/10 border border-brackeys-yellow/25 px-1.5 py-0.5 font-mono text-[9px] text-brackeys-yellow uppercase tracking-wider">
              {jam.result}
            </span>
          )}
        </div>
        <button type="button" onClick={onRemove} className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all shrink-0 mt-0.5">
          <HugeiconsIcon icon={Delete02Icon} size={12} />
        </button>
      </div>
    </div>
  );
}

export function AddJamForm({ onAdd }: { onAdd: (data: { jamName: string; submissionTitle?: string; submissionUrl?: string; result?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [jamName, setJamName] = useState('');
  const [submissionTitle, setSubmissionTitle] = useState('');
  const [result, setResult] = useState('');

  const handleSubmit = () => {
    if (!jamName.trim()) return;
    onAdd({
      jamName: jamName.trim(),
      submissionTitle: submissionTitle.trim() || undefined,
      result: result.trim() || undefined,
    });
    setJamName('');
    setSubmissionTitle('');
    setResult('');
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
        Add Jam Entry
      </motion.button>
    );
  }

  return (
    <div className="border border-primary/20 bg-primary/3 p-3 space-y-2">
      <input type="text" value={jamName} onChange={(e) => setJamName(e.target.value)} placeholder="Jam name (e.g. Brackeys 2025.1) *" className={inputCls} />
      <input type="text" value={submissionTitle} onChange={(e) => setSubmissionTitle(e.target.value)} placeholder="Submission title" className={inputCls} />
      <input type="text" value={result} onChange={(e) => setResult(e.target.value)} placeholder="Result (e.g. 3rd Place)" className={inputCls} />
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
