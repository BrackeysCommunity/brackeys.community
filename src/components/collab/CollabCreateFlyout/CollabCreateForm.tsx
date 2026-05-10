import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/typography";
import { collabStore, resetWizard, setWizardStep, updateWizardDraft } from "@/lib/collab-store";
import { client } from "@/orpc/client";

import { CollabCreateFooter } from "./CollabCreateFooter";
import { CollabCreateStepper } from "./CollabCreateStepper";
import { WizardFormContext } from "./form-context";
import {
  formatCompensation,
  getStepValidationError,
  getWizardTabs,
  uploadCollabPostImage,
  type WizardFormValues,
  type WizardTabId,
} from "./shared";
import { StepBasics } from "./StepBasics";
import { StepMentor } from "./StepMentor";
import { StepPlaytest } from "./StepPlaytest";
import { StepProject } from "./StepProject";
import { StepReview } from "./StepReview";
import { StepRoles } from "./StepRoles";

// Step body cross-fade matches the profile flyout: a short ease-out on
// opacity/scale plus a directional x nudge so 1→2 enters from the
// right and 2→1 enters from the left.
const STEP_BODY_TRANSITION = { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const };
const STEP_SHIFT_PX = 28;
const STEP_VARIANTS = {
  enter: (dir: number) => ({
    opacity: 0,
    scale: 0.97,
    x: dir * STEP_SHIFT_PX,
    filter: "blur(6px)",
  }),
  center: { opacity: 1, scale: 1, x: 0, filter: "blur(0px)" },
  exit: (dir: number) => ({
    opacity: 0,
    scale: 0.97,
    x: -dir * STEP_SHIFT_PX,
    filter: "blur(6px)",
  }),
};

interface CollabCreateFormProps {
  isTouch: boolean;
  onClose: () => void;
  onCreated: (postId: number) => void;
}

/**
 * Authenticated body of the create flyout. Owns the tanstack-form
 * instance, drives the visible tab strip, and renders the active
 * step's body inside a directional cross-fade that mirrors the
 * profile flyout's transition.
 */
export function CollabCreateForm({ isTouch, onClose, onCreated }: CollabCreateFormProps) {
  const { wizard } = useStore(collabStore);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm({
    defaultValues: {
      type: wizard.draft.type,
      title: wizard.draft.title,
      description: wizard.draft.description,
      isIndividual: wizard.draft.isIndividual,
      projectName: wizard.draft.projectName,
      platforms: wizard.draft.platforms,
      teamSize: wizard.draft.teamSize,
      projectLength: wizard.draft.projectLength,
      experienceLevel: wizard.draft.experienceLevel,
      compensationType: wizard.draft.compensationType,
      compensationMin: wizard.draft.compensationMin,
      compensationMax: wizard.draft.compensationMax,
      contactType: wizard.draft.contactType,
      contactMethod: wizard.draft.contactMethod,
      portfolioUrl: wizard.draft.portfolioUrl,
      experience: wizard.draft.experience,
      roleIds: wizard.draft.roleIds,
      images: wizard.draft.images,
    },
    onSubmit: async ({ value }) => {
      const v = value as WizardFormValues;
      let portfolioUrl: string | undefined;
      if (v.portfolioUrl.trim()) {
        const url = v.portfolioUrl.trim();
        portfolioUrl = /^https?:\/\//.test(url) ? url : `https://${url}`;
      }
      const compensation =
        formatCompensation(v.compensationType, v.compensationMin, v.compensationMax) || undefined;

      const post = await client.createPost({
        type: v.type!,
        title: v.title,
        description: v.description,
        projectName: v.projectName || undefined,
        compensation,
        compensationType: v.compensationType || undefined,
        teamSize: v.teamSize || undefined,
        projectLength: v.projectLength || undefined,
        platforms: v.platforms.length > 0 ? v.platforms : undefined,
        experience: v.experience || undefined,
        experienceLevel: v.experienceLevel || undefined,
        portfolioUrl,
        contactMethod: v.isIndividual ? undefined : v.contactMethod || undefined,
        contactType: v.isIndividual ? "discord_dm" : v.contactType || undefined,
        isIndividual: v.isIndividual || undefined,
        roleIds: v.roleIds.length > 0 ? v.roleIds : undefined,
      });
      // Images are uploaded at submit time so abandoned drafts don't
      // leave orphan objects in MinIO. Upload all pending files in
      // parallel, then attach the resulting keys to the post.
      if (v.images.length > 0) {
        const uploaded = await Promise.all(v.images.map((img) => uploadCollabPostImage(img.file)));
        await Promise.all(
          uploaded.map((rec, idx) =>
            client.addPostImage({
              postId: post.id,
              strapiMediaId: rec.key,
              url: rec.url,
              alt: v.images[idx]?.alt,
              sortOrder: idx,
            }),
          ),
        );
      }
      resetWizard();
      onCreated(post.id);
    },
  });

  const formType = useStore(form.store, (s) => s.values.type);
  const formIsIndividual = useStore(form.store, (s) => s.values.isIndividual);
  useEffect(() => {
    updateWizardDraft({ type: formType, isIndividual: formIsIndividual });
  }, [formType, formIsIndividual]);

  const tabs = getWizardTabs(formType);
  const activeIndex = Math.min(wizard.step, tabs.length - 1);
  const currentTab: WizardTabId = tabs[activeIndex]!.id;
  const isLastStep = activeIndex === tabs.length - 1;

  // Track the previous step so the body's cross-fade can pick a
  // direction (forward vs. back). Same trick the profile flyout uses.
  const [trackedIndex, setTrackedIndex] = useState(activeIndex);
  const [previousIndex, setPreviousIndex] = useState(activeIndex);
  if (activeIndex !== trackedIndex) {
    setPreviousIndex(trackedIndex);
    setTrackedIndex(activeIndex);
  }
  const direction = activeIndex >= previousIndex ? 1 : -1;

  const validationStepId = (() => {
    if (currentTab === "basics") return "basics";
    if (currentTab === "review") return "review";
    if (currentTab === "roles") return "roles";
    if (formType === "playtest") return "playtest";
    if (formType === "mentor") return "mentor";
    return "details";
  })();

  const handleNext = () => {
    const validationError = getStepValidationError(
      validationStepId,
      form.state.values as WizardFormValues,
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    if (isLastStep) {
      form.handleSubmit();
    } else {
      setWizardStep(activeIndex + 1);
    }
  };

  const handleBack = () => {
    setError(null);
    if (activeIndex > 0) setWizardStep(activeIndex - 1);
  };

  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);

  return (
    <>
      <CollabCreateHeader
        isTouch={isTouch}
        onClose={onClose}
        stepLabel={`STEP ${activeIndex + 1}/${tabs.length} · ${tabs[activeIndex]?.label}`}
      />
      <CollabCreateStepper
        tabs={tabs}
        activeIndex={activeIndex}
        onSelect={(i) => setWizardStep(i)}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={currentTab}
            custom={direction}
            variants={STEP_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={STEP_BODY_TRANSITION}
            className="h-full overflow-y-auto px-5 py-5"
          >
            <WizardFormContext.Provider value={form}>
              {renderStep(currentTab, formType)}
            </WizardFormContext.Provider>
          </motion.div>
        </AnimatePresence>
      </div>
      <CollabCreateFooter
        error={error}
        isFirstStep={activeIndex === 0}
        isLastStep={isLastStep}
        isSubmitting={isSubmitting}
        onBack={handleBack}
        onNext={handleNext}
      />
    </>
  );
}

function renderStep(tab: WizardTabId, type: WizardFormValues["type"]) {
  if (tab === "basics") return <StepBasics />;
  if (tab === "review") return <StepReview />;
  if (tab === "roles") return <StepRoles />;
  // tab === "project" — body depends on post type
  if (type === "playtest") return <StepPlaytest />;
  if (type === "mentor") return <StepMentor />;
  return <StepProject />;
}

function CollabCreateHeader({
  isTouch,
  onClose,
  stepLabel,
}: {
  isTouch: boolean;
  onClose: () => void;
  stepLabel: string;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-muted/30 px-5 pt-5 pb-4">
      {isTouch ? (
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Heading as="h2" monospace className="text-lg tracking-widest uppercase">
            POST A GIG.
          </Heading>
          <Text monospace size="xs" variant="muted" className="tracking-widest">
            {stepLabel}
          </Text>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Close"
          onClick={onClose}
          className="font-mono"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
    </div>
  );
}
