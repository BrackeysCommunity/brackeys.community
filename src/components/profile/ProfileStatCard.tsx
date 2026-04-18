import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";

import { useMagnetic } from "@/lib/hooks/use-cursor";

const springTransition = { type: "spring", stiffness: 1000, damping: 30, mass: 0.1 } as const;

interface ProfileStatCardProps {
  index: string;
  label: string;
  value: string | number;
  icon: IconSvgElement;
}

export function ProfileStatCard({ index, label, value, icon }: ProfileStatCardProps) {
  const { ref, position } = useMagnetic(0.2);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      data-cursor-corner-size="lg"
      data-cursor-padding-x="24"
      data-cursor-padding-y="24"
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="pointer-events-auto relative z-10 w-full sm:w-auto"
    >
      <div className="group flex h-24 w-full min-w-[200px] flex-col justify-between border-2 border-muted bg-card p-4 transition-all duration-100 hover:-translate-y-1 hover:border-primary hover:bg-background hover:shadow-[4px_4px_0px_var(--color-primary)]">
        <div className="flex justify-between">
          <span className="font-mono text-xs text-muted-foreground group-hover:text-primary">
            {index}
          </span>
          <HugeiconsIcon
            icon={icon}
            size={20}
            className="text-muted-foreground group-hover:text-primary"
          />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-2xl leading-none font-bold tracking-tight text-foreground group-hover:text-primary">
            {value}
          </span>
          <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            {label}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
