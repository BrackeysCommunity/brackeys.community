import { ArrowLeft01Icon, ArrowRight01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";

interface CollabCreateFooterProps {
  /** Optional validation / submit error to surface above the buttons. */
  error: string | null;
  /** Disables the back button (true on first step). */
  isFirstStep: boolean;
  /** Switches the primary action between "NEXT" and the submit label. */
  isLastStep: boolean;
  /** True while the create mutation is in flight. */
  isSubmitting: boolean;
  /**
   * On the last step: the label of the first step whose requirements
   * aren't met ("BASICS", "PROJECT", …), or null when the post can
   * submit. Non-null disables the primary button — the validator always
   * enforced this; the button just used to look live anyway.
   */
  submitBlockedBy?: string | null;
  /** "SUBMIT" when creating, "SAVE CHANGES" when editing. */
  submitLabel: string;
  /**
   * Set when the post saved but its images didn't. Replaces the step
   * controls entirely: the post is already live, so offering NEXT/SUBMIT
   * here would invite a duplicate.
   */
  imageRetry: { onRetry: () => void; onSkip: () => void } | null;
  /**
   * Editing, on the POST step, with image picks or removals waiting: a
   * save for just those, above the step controls, so art changes land
   * without walking to REVIEW.
   */
  imageSave?: { count: number; saving: boolean; onSave: () => void } | null;
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
  submitBlockedBy = null,
  submitLabel,
  imageRetry,
  imageSave = null,
  onBack,
  onNext,
}: CollabCreateFooterProps) {
  const submitBlocked = isLastStep && submitBlockedBy !== null;
  return (
    <>
      {error ? (
        <div className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-5 py-2">
          <Text size="xs" variant="danger">
            {error}
          </Text>
        </div>
      ) : null}
      {imageSave ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-warning/30 bg-warning/5 px-5 py-2">
          <Text size="xs" variant="muted" className="tracking-widest">
            {imageSave.count === 1 ? "1 IMAGE CHANGE" : `${imageSave.count} IMAGE CHANGES`} ·
            UNSAVED
          </Text>
          <Button
            variant="outline"
            size="xs"
            onClick={imageSave.onSave}
            disabled={imageSave.saving}
            className="tracking-widest"
          >
            {imageSave.saving ? "SAVING…" : "SAVE IMAGES"}
            <HugeiconsIcon icon={Tick01Icon} size={12} />
          </Button>
        </div>
      ) : null}
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-muted/30 px-5 py-3">
        <Text size="xs" variant="muted" className="tracking-widest">
          {isSubmitting ? "SUBMITTING…" : imageRetry ? "POST SAVED" : "⟢ AUTO-SAVED"}
        </Text>
        <div className="flex items-center gap-2">
          {imageRetry ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={imageRetry.onSkip}
                className="tracking-widest"
              >
                CONTINUE WITHOUT
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={imageRetry.onRetry}
                className="tracking-widest"
              >
                RETRY IMAGES
                <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
              </Button>
            </>
          ) : (
            <>
              {!isFirstStep ? (
                <Button variant="outline" size="sm" onClick={onBack} className="tracking-widest">
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={12} />
                  BACK
                </Button>
              ) : null}
              {submitBlocked ? (
                <Text size="xs" variant="muted" className="tracking-widest">
                  FINISH {submitBlockedBy} FIRST
                </Text>
              ) : null}
              <Button
                variant="default"
                size="sm"
                onClick={onNext}
                disabled={isSubmitting || submitBlocked}
                className="tracking-widest"
              >
                {isLastStep ? (isSubmitting ? "SUBMITTING…" : submitLabel) : "NEXT"}
                <HugeiconsIcon icon={isLastStep ? Tick01Icon : ArrowRight01Icon} size={12} />
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
