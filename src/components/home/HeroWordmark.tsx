import { cn } from "@/lib/utils";

interface HeroWordmarkProps {
  primary: React.ReactNode;
  secondary: string;
  className?: string;
  noPunctuation?: boolean;
}

export function HeroWordmark({ primary, secondary, noPunctuation, className }: HeroWordmarkProps) {
  const punctuate = !noPunctuation;
  return (
    <h1
      className={cn(
        "flex flex-col font-mono leading-[0.9] font-bold tracking-tighter",
        "text-[clamp(2.5rem,9vw,7rem)]",
        className,
      )}
    >
      <span className="block leading-[0.9] text-primary">{primary}</span>
      <span className="relative inline-block leading-[0.9] text-background transition-colors duration-300 [-webkit-text-stroke:1px_var(--color-muted-foreground)] hover:[-webkit-text-stroke:1px_var(--color-primary)]">
        {secondary}
        {punctuate && <span className="text-accent [-webkit-text-stroke:0]">.</span>}
      </span>
    </h1>
  );
}
