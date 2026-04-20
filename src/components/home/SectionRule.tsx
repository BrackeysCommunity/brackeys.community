import { cn } from "@/lib/utils";

interface SectionRuleProps {
  label: string;
  className?: string;
}

export function SectionRule({ label, className }: SectionRuleProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 font-mono text-xs tracking-widest text-muted-foreground uppercase",
        className,
      )}
    >
      <span className="shrink-0">[ {label} ]</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
