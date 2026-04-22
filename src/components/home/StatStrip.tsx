import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

export interface StatCellProps {
  value: string;
  label: string;
  accent?: React.ReactNode;
  className?: string;
}

export function StatCell({ value, label, accent, className }: StatCellProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 px-4 py-3 not-last:border-r not-last:border-muted/40",
        className,
      )}
    >
      <span className="flex items-center gap-2 font-mono text-2xl font-bold tracking-tight text-foreground tabular-nums">
        {value}
        {accent}
      </span>
      <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
    </div>
  );
}

export function StatStrip({ children }: { children: React.ReactNode }) {
  return (
    <Well notchOpts={{ size: 12 }}>
      <div className="mt-1 grid grid-cols-2 xl:grid-cols-4">{children}</div>
    </Well>
  );
}

export function OnlinePulse() {
  return (
    <span className="relative inline-flex h-3 w-3">
      <span className="absolute inset-0 animate-ping rounded-sm bg-success opacity-60" />
      <span className="relative inline-block h-3 w-3 rounded-sm bg-success" />
    </span>
  );
}
