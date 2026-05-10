import { ArrowLeft01Icon, ArrowRight01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";

interface CollabCreateFooterProps {
  /** Optional validation / submit error to surface above the buttons. */
  error: string | null;
  /** Disables the back button (true on first step). */
  isFirstStep: boolean;
  /** Switches the primary action between "NEXT" and "SUBMIT". */
  isLastStep: boolean;
  /** True while the create mutation is in flight. */
  isSubmitting: boolean;
  onBack: () => void;
  onNext: () => void;
}

/**
 * Sticky footer for the create flyout — auto-save indicator on the
 * left, back / next (or submit) buttons on the right.
 */
export function CollabCreateFooter({
  error,
  isFirstStep,
  isLastStep,
  isSubmitting,
  onBack,
  onNext,
}: CollabCreateFooterProps) {
  return (
    <>
      {error ? (
        <div className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-5 py-2">
          <Text monospace size="xs" variant="danger">
            {error}
          </Text>
        </div>
      ) : null}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-muted/30 px-5 py-3">
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          {isSubmitting ? "SUBMITTING…" : "⟢ AUTO-SAVED"}
        </Text>
        <div className="flex items-center gap-2">
          {!isFirstStep ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              className="font-mono tracking-widest"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={12} />
              BACK
            </Button>
          ) : null}
          <Button
            variant="default"
            size="sm"
            onClick={onNext}
            disabled={isSubmitting}
            className="font-mono tracking-widest"
          >
            {isLastStep ? (isSubmitting ? "SUBMITTING…" : "SUBMIT") : "NEXT"}
            <HugeiconsIcon icon={isLastStep ? Tick01Icon : ArrowRight01Icon} size={12} />
          </Button>
        </div>
      </div>
    </>
  );
}
