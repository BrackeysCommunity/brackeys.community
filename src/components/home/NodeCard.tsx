import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useState } from "react";

import { Chonk } from "@/components/ui/chonk";
import { GlitchTransition } from "@/components/ui/glitch-transition";

const NODE_CARD_HEIGHT = 280;

interface NodeCardProps {
  index: string;
  title: string;
  icon: IconSvgElement;
  to: string;
  stat: string;
  statLabel: string;
  middle?: React.ReactNode;
  className?: string;
}

export function NodeCard({
  index,
  title,
  icon,
  to,
  stat,
  statLabel,
  middle,
  className,
}: NodeCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Chonk
      variant="surface"
      size="xl"
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      render={
        <Link
          to={to}
          data-magnetic
          data-cursor-no-drift
          data-cursor-corner-size="lg"
          className="group/node flex flex-col p-4"
          style={{ height: NODE_CARD_HEIGHT }}
        />
      }
    >
      {/* Header row */}
      <div className="flex shrink-0 items-start justify-between">
        <span className="font-mono text-xs tracking-widest text-muted-foreground transition-colors group-hover/node:text-accent">
          § {index}
        </span>
        <HugeiconsIcon
          icon={icon}
          size={18}
          className="text-muted-foreground transition-colors group-hover/node:text-accent"
        />
      </div>

      {/* Middle region */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Title — animate fontSize/paddingTop for smooth size interpolation */}
        <motion.div
          initial={false}
          animate={{
            fontSize: hovered ? "1.5rem" : "2.5rem",
            paddingTop: hovered ? "0.5rem" : "1.5rem",
          }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="origin-top-left font-mono font-bold leading-[0.95] tracking-tight whitespace-pre-line text-foreground"
        >
          {title}
        </motion.div>

        {/* Middle slot — animated reveal with glitch */}
        {middle && (
          <motion.div
            initial={false}
            animate={hovered ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="mt-3 flex-1"
          >
            <GlitchTransition
              trigger="manual"
              active={hovered}
              duration={0.5}
              intensity={0.7}
              scanlines
              flicker
              style={{ width: "100%" }}
            >
              {middle}
            </GlitchTransition>
          </motion.div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 flex shrink-0 items-end justify-between">
        <div className="flex flex-col">
          <span className="font-mono text-3xl font-bold tracking-tight text-accent tabular-nums">
            {stat}
          </span>
          <span className="mt-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            {statLabel}
          </span>
        </div>
        <span className="flex items-center gap-1 font-mono text-xs tracking-widest text-muted-foreground uppercase transition-colors group-hover/node:text-accent">
          Enter
          <HugeiconsIcon icon={ArrowRight02Icon} size={14} />
        </span>
      </div>
    </Chonk>
  );
}

export function NodeCardTagRow({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="border border-muted/60 bg-muted/70 px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

export function NodeCardCommandList({ commands }: { commands: string[] }) {
  return (
    <ul className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
      {commands.map((c) => (
        <li key={c} className="flex items-center gap-2">
          <span className="text-accent">{">"}</span>
          <span className="text-accent/80">/{c}</span>
          <span className="text-muted-foreground/50">…</span>
        </li>
      ))}
    </ul>
  );
}

export function NodeCardSparkline({ heights }: { heights: number[] }) {
  return (
    <div className="flex h-16 w-full items-end gap-1">
      {heights.map((h, i) => {
        const clamped = Math.max(8, Math.min(100, h));
        const opacity = 0.35 + (clamped / 100) * 0.55;
        return (
          <div
            key={`${i}-${h}`}
            className="min-w-[4px] flex-1 rounded-[1px] bg-accent"
            style={{ height: `${clamped}%`, opacity }}
          />
        );
      })}
    </div>
  );
}
