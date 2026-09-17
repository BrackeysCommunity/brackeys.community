import { Badge } from "@/components/ui/badge";
import { deployEnvLabel } from "@/lib/deploy-env";
import { cn } from "@/lib/utils";

/**
 * "This is not the real site."
 *
 * Testers kept filing staging findings as production bugs, and screenshotting
 * staging as proof the site had shipped, because nothing on the page said
 * which one they were on. Two parts, because either alone has a hole: the
 * badge names the environment but rides the header, which hides itself on
 * scroll-down, and the stripe survives that but can't say a word.
 *
 * Both render nothing on production, so the canonical deploy pays no pixels
 * and no bundle beyond the string compare in `deployEnvLabel`.
 */
export function DeployEnvBadge({ className }: { className?: string }) {
  const label = deployEnvLabel();
  if (!label) return null;

  return (
    <Badge variant="warning" size="label" className={cn("uppercase", className)}>
      {label}
    </Badge>
  );
}

/** The hazard strip pinned to the very top edge, above every fixed layer. */
export function DeployEnvStripe() {
  const label = deployEnvLabel();
  if (!label) return null;

  return (
    <div
      aria-hidden
      data-testid="deploy-env-stripe"
      className="pointer-events-none fixed inset-x-0 top-0 z-9999 h-[3px]"
      style={{
        background:
          "repeating-linear-gradient(45deg, var(--warning) 0 8px, color-mix(in srgb, var(--warning) 35%, black) 8px 16px)",
      }}
    />
  );
}
