import { motion } from 'framer-motion';
import { useMagnetic } from '@/lib/hooks/use-cursor';
import { cn } from '@/lib/utils';

export const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

export function MagneticFooterButton({
  onClick,
  children,
  className,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { ref, position } = useMagnetic(0.25);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="flex-1"
    >
      <button type="button" onClick={onClick} disabled={disabled} className={className}>
        {children}
      </button>
    </motion.div>
  );
}

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 border-b border-muted/30">
      <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
        {children}
      </span>
    </div>
  );
}

export function FieldError({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return <p className="font-mono text-[10px] text-destructive mt-1">{errors[0]}</p>;
}

export function CharCount({ current, min, max }: { current: number; min?: number; max: number }) {
  const atLimit = current >= max;
  const nearLimit = current > max * 0.8;
  const belowMin = min !== undefined && current > 0 && current < min;

  return (
    <span
      className={cn(
        'font-mono text-[10px]',
        atLimit ? 'text-destructive' :
        nearLimit ? 'text-brackeys-yellow' :
        belowMin ? 'text-brackeys-yellow' :
        'text-muted-foreground/40',
      )}
    >
      {current} / {max}
      {belowMin && ` (min ${min})`}
    </span>
  );
}
