import { Add01Icon, Login01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";

interface CollabCreateCtaProps {
  /** True when the user has an authenticated session — switches the
   * label/icon between create and sign-in. */
  authenticated: boolean;
  onClick: () => void;
}

/**
 * Top-of-rail CTA used to open the create flyout. Built on the `Button`
 * primitive (chonk-emboss surface) so it matches the embossed-tile
 * language of the rest of the system.
 */
export function CollabCreateCta({ authenticated, onClick }: CollabCreateCtaProps) {
  return (
    <Button
      onClick={onClick}
      variant="default"
      size="lg"
      className="w-full justify-center font-mono tracking-widest"
    >
      <HugeiconsIcon icon={authenticated ? Add01Icon : Login01Icon} size={14} />
      {authenticated ? "CREATE POST" : "SIGN IN TO POST"}
    </Button>
  );
}
