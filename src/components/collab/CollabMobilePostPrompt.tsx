import { Add01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

interface CollabMobilePostPromptProps {
  onClick: () => void;
}

/**
 * Mobile-only "// YOU NEED A CREW?" prompt card. Renders as a tappable
 * `Well` with a leading plus glyph and trailing chevron.
 */
export function CollabMobilePostPrompt({ onClick }: CollabMobilePostPromptProps) {
  return (
    <Well variant="ghost" className="border-warning/40 bg-warning/5 p-0">
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-3 p-3 text-left"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center bg-warning/20 text-warning">
          <HugeiconsIcon icon={Add01Icon} size={18} />
        </span>
        <span className="flex flex-1 flex-col">
          <Text monospace size="xs" variant="muted" className="tracking-widest">
            // YOU NEED A CREW?
          </Text>
          <Text size="sm" bold className="text-foreground">
            Post a role or call.
          </Text>
        </span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={18}
          className="text-foreground/70 transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </Well>
  );
}
