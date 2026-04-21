import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useState } from "react";

import { Chonk } from "@/components/ui/chonk";
import { GlitchTransition } from "@/components/ui/glitch-transition";
import { cn } from "@/lib/utils";

const NODE_CARD_HEIGHT = 280;

type NodeCardCommon = {
  index: string;
  title: string;
  icon: IconSvgElement;
  stat: string;
  statLabel: string;
  middle?: React.ReactNode;
  /** Label shown in the bottom-right corner. Defaults to `ENTER →` / `SELECT`. */
  footerLabel?: string;
  className?: string;
};

type NodeCardLinkProps = NodeCardCommon & {
  to: string;
  onClick?: never;
  active?: never;
};

type NodeCardToggleProps = NodeCardCommon & {
  to?: never;
  onClick: () => void;
  active?: boolean;
};

export type NodeCardProps = NodeCardLinkProps | NodeCardToggleProps;

/**
 * Shared card used by the home nav tiles and the command-center bot toggles.
 *
 * - `to` → renders as a `<Link>` (nav card).
 * - `onClick` + `active` → renders as a `<button>` toggle. When `active`, the
 *   card is fully depressed (`--chonk-y: 0`), hover lift is suppressed, the bg
 *   goes solid primary-tinted, and the middle visuals stay revealed.
 */
export function NodeCard(props: NodeCardProps) {
  const { index, title, icon, stat, statLabel, middle, footerLabel, className } = props;
  const isToggle = "onClick" in props && typeof props.onClick === "function";
  const active = isToggle ? Boolean(props.active) : false;

  const [hovered, setHovered] = useState(false);
  const revealed = hovered || active;

  // Fully depressed pressed state — overrides chonk-emboss's transform/shadow so
  // it doesn't lift on hover, looks solidly pressed-in, and reads as selected.
  const pressedClasses = cn(
    "[--chonk-y:0px]!",
    "border-primary bg-primary/25 backdrop-blur-none",
    "hover:border-primary hover:bg-primary/25",
  );

  return (
    <Chonk
      variant="surface"
      size="xl"
      className={cn("group/node", active && pressedClasses, className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      render={
        isToggle ? (
          <button
            type="button"
            onClick={props.onClick}
            aria-pressed={active}
            data-magnetic={active ? undefined : true}
            data-cursor-no-drift
            data-cursor-corner-size="lg"
            className="flex flex-col p-4 text-left"
            style={{ height: NODE_CARD_HEIGHT }}
          />
        ) : (
          <Link
            to={props.to}
            data-magnetic
            data-cursor-no-drift
            data-cursor-corner-size="lg"
            className="flex flex-col p-4"
            style={{ height: NODE_CARD_HEIGHT }}
          />
        )
      }
    >
      {/* Header row */}
      <div className="flex shrink-0 items-start justify-between">
        <span
          className={cn(
            "font-mono text-xs tracking-widest transition-colors",
            active ? "text-accent" : "text-muted-foreground group-hover/node:text-accent",
          )}
        >
          § {index}
        </span>
        <HugeiconsIcon
          icon={icon}
          size={18}
          className={cn(
            "transition-colors",
            active ? "text-accent" : "text-muted-foreground group-hover/node:text-accent",
          )}
        />
      </div>

      {/* Middle region */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <motion.div
          initial={false}
          animate={{
            fontSize: revealed ? "1.5rem" : "2.5rem",
            paddingTop: revealed ? "0.5rem" : "1.5rem",
          }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="origin-top-left font-mono leading-[0.95] font-bold tracking-tight whitespace-pre-line text-foreground"
        >
          {title}
        </motion.div>

        {middle && (
          <motion.div
            initial={false}
            animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="mt-3 flex-1"
          >
            <GlitchTransition
              trigger="manual"
              active={revealed}
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
        <span
          className={cn(
            "flex items-center gap-1 font-mono text-xs tracking-widest uppercase transition-colors",
            active ? "text-accent" : "text-muted-foreground group-hover/node:text-accent",
          )}
        >
          {footerLabel ?? (isToggle ? (active ? "Active" : "Select") : "Enter")}
          {!isToggle && <HugeiconsIcon icon={ArrowRight02Icon} size={14} />}
          {isToggle && (
            <span className="relative ml-1 inline-flex h-1.5 w-1.5">
              {active && (
                <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-75" />
              )}
              <span
                className={cn(
                  "relative inline-block h-1.5 w-1.5 rounded-full",
                  active ? "bg-accent" : "bg-muted-foreground/40",
                )}
              />
            </span>
          )}
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
