import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Text } from "@/components/ui/typography";
import { authStore } from "@/lib/auth-store";
import { collabStore, resetWizard, updateWizardDraft } from "@/lib/collab-store";
import { errorMessage } from "@/lib/error-message";
import { EVENTS, FLOWS, flowStep } from "@/lib/event-taxonomy";
import { isExternalUrl } from "@/lib/external-url";
import { useReleaseFocusOnOpen } from "@/lib/hooks/use-release-focus";
import { useStepScroll } from "@/lib/hooks/use-step-scroll";
import { stepBody, stepBodyTransition } from "@/lib/motion";
import { captureEvent, reportMutationError } from "@/lib/product-insights";

import { CollabCreateFooter } from "../CollabCreateFlyout/CollabCreateFooter";
import { CollabCreateHeader, savePost } from "../CollabCreateFlyout/CollabCreateForm";
import { CollabCreateStepper } from "../CollabCreateFlyout/CollabCreateStepper";
import { CollabCreateUnauth } from "../CollabCreateFlyout/CollabCreateUnauth";
import { WizardFormContext } from "../CollabCreateFlyout/form-context";
import {
  getQuickFieldErrors,
  getStepValidationError,
  normalizePortfolioUrl,
  postValidationErrors,
  type QuickFieldErrors,
  type WizardFormValues,
} from "../CollabCreateFlyout/shared";
import { CollabFunnelExplainer, JoinInsteadNote } from "../CollabFunnelExplainer";
import { ContextChips, KindSection, PitchSection, WhoSection } from "./sections";

const EXPLAINER_DISMISS_KEY = "collab.quickpost.explainer.dismissed";

type ModalStepId = "roles" | "details" | "type";

const MODAL_STEPS: { id: ModalStepId; num: string; label: string; desc: string }[] = [
  {
    id: "roles",
    num: "01",
    label: "ROLES",
    desc: "Who you're looking for — the seats you're filling and the stack they'd work in.",
  },
  {
    id: "details",
    num: "02",
    label: "DETAILS",
    desc: "The headline people scan on the board, and the pitch under it.",
  },
  {
    id: "type",
    num: "03",
    label: "TYPE",
    desc: "What kind of post this is and, if it's paid, the terms.",
  },
];

/** The field gates each step owns, in the order the footer reports them. */
function stepError(step: ModalStepId, errors: QuickFieldErrors): string | null {
  switch (step) {
    case "roles":
      return errors.roles ?? errors.skills ?? null;
    case "details":
      return errors.title ?? errors.description ?? null;
    case "type":
      return errors.type ?? errors.compensation ?? null;
  }
}

/** Which step a refused field belongs to, for routing a server rejection. */
function stepOwning(errors: QuickFieldErrors): number {
  const index = MODAL_STEPS.findIndex((s) => stepError(s.id, errors) !== null);
  return index === -1 ? 0 : index;
}

export interface CollabCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the post id once the create mutation resolves. */
  onCreated?: (postId: number) => void;
}

/**
 * The board's POST A ROLE surface: the same five fields as the old
 * one-screen post, dealt across three steps in a centered modal. Creation
 * only — an edit reopens the full wizard in its drawer, on the post's own
 * page. The draft is auto-saved, so dismissing never costs work.
 */
export function CollabCreateModal({ open, onClose, onCreated }: CollabCreateModalProps) {
  const { session, isPending } = useStore(authStore);
  useReleaseFocusOnOpen(open);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Hung from the top rather than centered, as the moderation shell
          is: the steps differ in height, and a centered box would jump
          around its midpoint on every NEXT. */}
      <DialogContent
        showCloseButton={false}
        className="top-24 flex max-h-[calc(100vh-8rem)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">Post a gig</DialogTitle>
        <DialogDescription className="sr-only">
          Create a collaboration post in three steps: roles, details, and type.
        </DialogDescription>

        {isPending ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <span className="animate-pulse text-xs tracking-widest text-muted-foreground uppercase">
              Authenticating…
            </span>
          </div>
        ) : !session?.user ? (
          <CollabCreateUnauth />
        ) : (
          /* Keyed on `open` so each opening mounts a fresh form — that's
             what re-runs the draft restore. */
          <CollabCreateSteps
            key={open ? "open" : "closed"}
            onCreated={(id) => {
              onCreated?.(id);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CollabCreateSteps({ onCreated }: { onCreated: (postId: number) => void }) {
  const draftRestored = useStore(collabStore, (s) => s.wizard.draftRestored);
  const [initialDraft] = useState(() => collabStore.state.wizard.draft);
  const [error, setError] = useState<string | null>(null);
  // Inline errors appear after the first refused NEXT, then track live.
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  // What the server refused that the client's own gates let through. Held
  // separately because nothing in the draft can clear it — only an edit can.
  const [serverErrors, setServerErrors] = useState<QuickFieldErrors>({});
  const [jamMode, setJamMode] = useState(initialDraft.jamId !== undefined);
  const [activeIndex, setActiveIndex] = useState(0);

  const form = useForm({
    defaultValues: { ...initialDraft },
    onSubmit: async ({ value }) => {
      const v = value as WizardFormValues;
      setError(null);
      setServerErrors({});
      try {
        const postId = await savePost(
          {
            ...v,
            // No crew yet unless the entrance carried one: the crew is
            // minted when the poster accepts someone.
            isIndividual: v.teamId === undefined,
            // A fragment left in a wizard draft is not a project name.
            projectName: v.projectName.trim().length >= 3 ? v.projectName : "",
            // The modal has no portfolio input — only the full wizard
            // does — so a draft carrying a link the schema refuses would
            // block PUBLISH from a surface with nowhere to fix it. A
            // valid one still rides through.
            portfolioUrl: isExternalUrl(normalizePortfolioUrl(v.portfolioUrl))
              ? v.portfolioUrl
              : "",
          },
          null,
        );
        resetWizard();
        onCreated(postId);
      } catch (err) {
        reportMutationError(err, "collab.post_save");
        const refused = postValidationErrors(err);
        if (Object.keys(refused.fields).length > 0) {
          // The server named fields the client's gates missed: show each
          // under its own control and land on the step that owns the
          // first one, rather than printing oRPC's phrasing in the footer.
          setServerErrors(refused.fields);
          setShowFieldErrors(true);
          setActiveIndex(stepOwning(refused.fields));
          setError(refused.other);
        } else {
          setError(refused.other ?? errorMessage(err, "Could not publish the post."));
        }
      }
    },
  });

  // Mirror the live values into the store so a reload survives — same
  // contract as the wizard. A server rejection is cleared by the first
  // edit after it: the values it described no longer exist.
  useEffect(() => {
    const sync = () => updateWizardDraft(form.state.values as WizardFormValues);
    sync();
    let seen = form.state.values;
    return form.store.subscribe(() => {
      sync();
      // Values only — the store also ticks for `isSubmitting`, which is
      // what flips right after the catch that set these.
      if (form.state.values === seen) return;
      seen = form.state.values;
      setServerErrors((prev) => (Object.keys(prev).length > 0 ? {} : prev));
    });
  }, [form]);

  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  const values = useStore(form.store, (s) =>
    showFieldErrors ? (s.values as WizardFormValues) : null,
  );
  const fieldErrors: QuickFieldErrors = {
    ...(values ? getQuickFieldErrors(values) : {}),
    ...serverErrors,
  };

  const step = MODAL_STEPS[activeIndex]!;
  const isLastStep = activeIndex === MODAL_STEPS.length - 1;
  const stepProps = () => flowStep(FLOWS.collabPost, step.id, activeIndex + 1, MODAL_STEPS.length);

  // Direction for the body's cross-fade: forward enters from the right.
  const [previousIndex, setPreviousIndex] = useState(activeIndex);
  const [trackedIndex, setTrackedIndex] = useState(activeIndex);
  if (activeIndex !== trackedIndex) {
    setPreviousIndex(trackedIndex);
    setTrackedIndex(activeIndex);
  }
  const direction = activeIndex >= previousIndex ? 1 : -1;
  const scrollRef = useStepScroll(activeIndex);

  const handleNext = () => {
    const v = form.state.values as WizardFormValues;
    const ownError = stepError(step.id, getQuickFieldErrors(v));
    // The last step publishes, so it re-checks every gate rather than
    // trusting that the user walked the steps in order.
    const validationError = isLastStep ? getStepValidationError("quick", v) : ownError;
    if (validationError) {
      setShowFieldErrors(true);
      captureEvent(EVENTS.collabPostStepBlocked, { ...stepProps(), reason: validationError });
      // A gate on this step is already showing under its field; the footer
      // only names one that lives on another step.
      setError(validationError === ownError ? null : validationError);
      return;
    }
    setError(null);
    if (isLastStep) {
      captureEvent(EVENTS.collabPostSubmitted, {
        ...stepProps(),
        mode: "create",
        surface: "modal",
      });
      form.handleSubmit();
    } else {
      captureEvent(EVENTS.collabPostStepAdvanced, stepProps());
      setActiveIndex(activeIndex + 1);
    }
  };

  const handleBack = () => {
    setError(null);
    if (activeIndex > 0) setActiveIndex(activeIndex - 1);
  };

  return (
    <>
      <CollabCreateHeader
        title="POST A GIG."
        stepLabel={`STEP ${activeIndex + 1}/${MODAL_STEPS.length} · ${step.label}`}
        restored={draftRestored}
        action={
          <DialogClose
            title="Close"
            render={<Button variant="ghost" size="icon-sm" className="-mr-2" />}
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
            <span className="sr-only">Close</span>
          </DialogClose>
        }
      />
      <CollabCreateStepper tabs={MODAL_STEPS} activeIndex={activeIndex} onSelect={setActiveIndex} />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={step.id}
            custom={direction}
            variants={stepBody}
            initial="enter"
            animate="center"
            exit="exit"
            transition={stepBodyTransition}
            className="px-5 py-5"
          >
            {/* Tight against the body: on step 1 the explainer follows, and
                two stacked blocks of prose pushed the picker off-screen. */}
            <Text
              as="p"
              size="md"
              variant="muted"
              density="comfortable"
              textWrap="pretty"
              className="mb-4"
            >
              {step.desc}
            </Text>
            <WizardFormContext.Provider value={form}>
              <div className="flex flex-col gap-6">
                {step.id === "roles" ? (
                  <>
                    <CollabFunnelExplainer
                      dismissKey={EXPLAINER_DISMISS_KEY}
                      aside={<JoinInsteadNote />}
                    />
                    <ContextChips />
                    <WhoSection error={fieldErrors.roles ?? fieldErrors.skills} />
                  </>
                ) : step.id === "details" ? (
                  <PitchSection
                    titleError={fieldErrors.title}
                    descriptionError={fieldErrors.description}
                  />
                ) : (
                  <KindSection
                    jamMode={jamMode}
                    onJamMode={setJamMode}
                    typeError={fieldErrors.type}
                    compensationError={fieldErrors.compensation}
                  />
                )}
              </div>
            </WizardFormContext.Provider>
          </motion.div>
        </AnimatePresence>
      </div>
      <CollabCreateFooter
        error={error}
        isFirstStep={activeIndex === 0}
        isLastStep={isLastStep}
        isSubmitting={isSubmitting}
        submitLabel="PUBLISH"
        imageRetry={null}
        autoSaveNote={false}
        onBack={handleBack}
        onNext={handleNext}
      />
    </>
  );
}
