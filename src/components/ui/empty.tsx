import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

/**
 * The house empty state: a ghost well with one muted, centered line.
 * Promoted from the admin surface (where it proved out as `AdminEmpty`);
 * new empty states use this instead of hand-rolling the well + text pair.
 */
export function Empty({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Well className={cn("items-center justify-center p-10", className)} variant="ghost">
      <Text size="sm" variant="muted" align="center">
        {children}
      </Text>
    </Well>
  );
}
