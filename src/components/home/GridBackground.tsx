import { PatternLines } from '@visx/pattern';
import { Group } from '@visx/group';
import { cn } from '@/lib/utils';

interface GridBackgroundProps {
  className?: string;
  opacity?: number;
}

export function GridBackground({ className, opacity = 0.1 }: GridBackgroundProps) {
  return (
    <div className={cn("absolute inset-0 z-0 pointer-events-none", className)} style={{ opacity }}>
      <svg width="100%" height="100%">
        <PatternLines
          id="grid-pattern"
          height={40}
          width={40}
          stroke="#6B6B6B"
          strokeWidth={1}
          orientation={['vertical', 'horizontal']}
        />
        <Group>
          <rect width="100%" height="100%" fill="url(#grid-pattern)" />
        </Group>
      </svg>
    </div>
  );
}
