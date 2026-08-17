import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-none bg-muted", className)}
      {...props}
    />
  );
}

/**
 * A paragraph-shaped placeholder. The last line is short so the block
 * reads as prose rather than a solid slab.
 */
function SkeletonText({
  lines = 3,
  className,
  lineClassName,
}: {
  lines?: number;
  className?: string;
  lineClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5 bg-muted/50", i === lines - 1 ? "w-2/3" : "w-full", lineClassName)}
        />
      ))}
    </div>
  );
}

export { Skeleton, SkeletonText };
