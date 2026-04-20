import { cn } from "@/lib/utils";

interface HeroWordmarkProps {
  primary: React.ReactNode;
  secondary: string;
  className?: string;
}

export function HeroWordmark({ primary, secondary, className }: HeroWordmarkProps) {
  return (
    <h1
      className={cn(
        "flex flex-col font-mono font-bold leading-[0.9] tracking-tighter",
        "text-[clamp(2.5rem,9vw,7rem)]",
        className,
      )}
    >
      <span className="block leading-[0.9] text-primary">{primary}</span>
      <span className="relative inline-block leading-[0.9] text-background [-webkit-text-stroke:1px_var(--color-muted-foreground)] transition-colors duration-300 hover:[-webkit-text-stroke:1px_var(--color-primary)]">
        {secondary}
        <span className="text-accent [-webkit-text-stroke:0]">.</span>
      </span>
    </h1>
  );
}
