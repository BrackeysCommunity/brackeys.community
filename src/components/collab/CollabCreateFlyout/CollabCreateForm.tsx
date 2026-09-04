import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { Heading, Text } from "@/components/ui/typography";
import {
  collabStore,
  resetWizard,
  setWizardStep,
  updateWizardDraft,
  type UploadedImage,
} from "@/lib/collab-store";
import { errorMessage } from "@/lib/error-message";
import { EVENTS, FLOWS, flowStep } from "@/lib/event-taxonomy";
import { EASE_OUT } from "@/lib/motion";
import { captureEvent, reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

import { CollabCreateFooter } from "./CollabCreateFooter";
import { CollabCreateStepper } from "./CollabCreateStepper";
import { WizardFormContext } from "./form-context";
import {
  getFirstIncompleteStep,
  getStepValidationError,
  uploadCollabPostImage,
  uploadTeamAvatarImage,
  WIZARD_TABS,
  type WizardFormValues,
  type WizardTabId,
} from "./shared";
import { StepBasics } from "./StepBasics";
import { StepProject } from "./StepProject";
import { StepReview } from "./StepReview";
import { StepRoles } from "./StepRoles";
import { StepTeam } from "./StepTeam";

// Step body cross-fade matches the profile flyout: a short ease-out on
// opacity/scale plus a directional x nudge so 1→2 enters from the
// right and 2→1 enters from the left.
const STEP_BODY_TRANSITION = { duration: 0.16, ease: EASE_OUT };
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

/**
 * Images added during an edit land after whatever the post already has.
 * Creation writes 0..n, so starting well past that keeps the existing
 * cover image the cover image.
 */
const EDIT_IMAGE_SORT_BASE = 100;

interface CollabCreateFormProps {
  onCreated: (postId: number) => void;
}

/**
 * Authenticated body of the create flyout. Owns the tanstack-form
 * instance, drives the visible tab strip, and renders the active
 * step's body inside a directional cross-fade that mirrors the
 * profile flyout's transition.
 *
 * Doubles as the edit form: when the store carries an `editingPostId`
 * the same four steps submit through `updatePost` instead. That reuse
 * is only possible because compensation, jam, and stack round-trip as
 * structured values — the old formatted `"$25 - $75 /hr"` string could
 * never repopulate the sliders.
 */
export function CollabCreateForm({ onCreated }: CollabCreateFormProps) {
  // Selector subscriptions, not the whole store: the draft now updates
  // on every keystroke (that's what makes it survivable across a
  // reload), and re-rendering the entire wizard for each one would be
  // paying for persistence with input latency.
  const step = useStore(collabStore, (s) => s.wizard.step);
  const editingPostId = useStore(collabStore, (s) => s.wizard.editingPostId);
  const draftRestored = useStore(collabStore, (s) => s.wizard.draftRestored);
  const [error, setError] = useState<string | null>(null);
  // Set when the post itself saved but its images didn't. Holds the live
  // post id so retrying attaches to it rather than creating a second
  // post — the old generic error left the user staring at a filled
  // wizard with a live post behind it and no safe way forward.
  const [imageRetryPostId, setImageRetryPostId] = useState<number | null>(null);

  // Whatever the store held when this form mounted — a restored draft,
  // an edit seeded from `getPost`, or an empty one. Whoever opened the
  // flyout has already put it there; the form only reads it.
  const [initialDraft] = useState(() => collabStore.state.wizard.draft);

  const form = useForm({
    defaultValues: {
      type: initialDraft.type,
      jamId: initialDraft.jamId,
      teamId: initialDraft.teamId,
      newTeamName: initialDraft.newTeamName,
      newTeamDescription: initialDraft.newTeamDescription,
      newTeamImage: initialDraft.newTeamImage,
      projectId: initialDraft.projectId,
      title: initialDraft.title,
      description: initialDraft.description,
      isIndividual: initialDraft.isIndividual,
      projectName: initialDraft.projectName,
      platforms: initialDraft.platforms,
      projectLength: initialDraft.projectLength,
      experienceLevel: initialDraft.experienceLevel,
      compensationType: initialDraft.compensationType,
      compensationMin: initialDraft.compensationMin,
      compensationMax: initialDraft.compensationMax,
      contactType: initialDraft.contactType,
      contactMethod: initialDraft.contactMethod,
      portfolioUrl: initialDraft.portfolioUrl,
      roleIds: initialDraft.roleIds,
      skillIds: initialDraft.skillIds,
      images: initialDraft.images,
      removedImageIds: initialDraft.removedImageIds,
    },
    onSubmit: async ({ value }) => {
      const v = value as WizardFormValues;
      setError(null);

      // The TEAM step's quick-create runs first, and the fresh id is
      // written back into the form — if the post save below fails, the
      // retry links the team that already exists instead of minting a
      // duplicate.
      let teamId = v.teamId;
      if (!v.isIndividual && teamId === undefined && v.newTeamName.trim().length >= 2) {
        try {
          teamId = await createDraftTeam(v);
          form.setFieldValue("teamId", teamId);
        } catch (err) {
          reportMutationError(err, "collab.team_create");
          setError(errorMessage(err, "Could not create the team."));
          return;
        }
      }

      // The post save and the image upload are separate failure domains,
      // so they get separate try/catches — a failed upload must not read
      // as "your post didn't save".
      let postId: number;
      try {
        postId = await savePost({ ...v, teamId }, editingPostId);
      } catch (err) {
        reportMutationError(err, "collab.post_save");
        setError(errorMessage(err, "Could not save the post."));
        return;
      }

      if (v.images.length > 0 || v.removedImageIds.length > 0) {
        try {
          await applyImageChanges(postId, v.images, v.removedImageIds, editingPostId !== null);
        } catch {
          setImageRetryPostId(postId);
          setError("Your post is live, but the images didn't upload. Retry below.");
          return;
        }
      }

      resetWizard();
      onCreated(postId);
    },
  });

  // Mirror the live form values into the store, which is what gets
  // persisted. Before this the draft lived only in memory, so a refresh,
  // a tab close, or an auth redirect wiped a four-step form.
  useEffect(() => {
    const sync = () => updateWizardDraft(form.state.values as WizardFormValues);
    sync();
    return form.store.subscribe(sync);
  }, [form]);

  const activeIndex = Math.min(step, WIZARD_TABS.length - 1);
  const currentTab: WizardTabId = WIZARD_TABS[activeIndex]!.id;
  const isLastStep = activeIndex === WIZARD_TABS.length - 1;

  // Track the previous step so the body's cross-fade can pick a
  // direction (forward vs. back). Same trick the profile flyout uses.
  const [trackedIndex, setTrackedIndex] = useState(activeIndex);
  const [previousIndex, setPreviousIndex] = useState(activeIndex);
  if (activeIndex !== trackedIndex) {
    setPreviousIndex(trackedIndex);
    setTrackedIndex(activeIndex);
  }
  const direction = activeIndex >= previousIndex ? 1 : -1;

  const validationStepId = currentTab === "project" ? "details" : currentTab;

  const stepProps = () =>
    flowStep(FLOWS.collabPost, currentTab, activeIndex + 1, WIZARD_TABS.length);

  const handleNext = () => {
    const validationError = getStepValidationError(
      validationStepId,
      form.state.values as WizardFormValues,
    );
    if (validationError) {
      // Separating "wouldn't let them through" from "walked away" — both
      // look like drop-off on the funnel, and they need opposite fixes.
      // The message itself, not a code — the set is bounded by the
      // validators in `shared.ts`, and it names the exact field that
      // stopped them, which is the whole reason to record the block.
      captureEvent(EVENTS.collabPostStepBlocked, {
        ...stepProps(),
        reason: validationError,
      });
      setError(validationError);
      return;
    }
    setError(null);
    if (isLastStep) {
      captureEvent(EVENTS.collabPostSubmitted, {
        ...stepProps(),
        mode: editingPostId !== null ? "edit" : "create",
        surface: "wizard",
      });
      form.handleSubmit();
    } else {
      captureEvent(EVENTS.collabPostStepAdvanced, stepProps());
      setWizardStep(activeIndex + 1);
    }
  };

  const handleBack = () => {
    setError(null);
    if (activeIndex > 0) setWizardStep(activeIndex - 1);
  };

  const handleRetryImages = async () => {
    if (imageRetryPostId === null) return;
    const v = form.state.values as WizardFormValues;
    try {
      await applyImageChanges(
        imageRetryPostId,
        v.images,
        v.removedImageIds,
        editingPostId !== null,
      );
    } catch {
      setError("The images still didn't upload. Try again, or continue without them.");
      return;
    }
    const postId = imageRetryPostId;
    setImageRetryPostId(null);
    resetWizard();
    onCreated(postId);
  };

  const handleSkipImages = () => {
    const postId = imageRetryPostId;
    setImageRetryPostId(null);
    resetWizard();
    if (postId !== null) onCreated(postId);
  };

  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);

  // Editing: the POST step's images save on their own, so a cover swap
  // doesn't wait for a walk to REVIEW. Pending picks and removals both
  // count; closing the panel drops whatever wasn't saved.
  const queryClient = useQueryClient();
  const [savingImages, setSavingImages] = useState(false);
  const pendingImageChanges = useStore(
    form.store,
    (s) =>
      (s.values as WizardFormValues).images.length +
      (s.values as WizardFormValues).removedImageIds.length,
  );
  const handleSaveImages = async (): Promise<boolean> => {
    if (editingPostId === null) return false;
    const v = form.state.values as WizardFormValues;
    setSavingImages(true);
    setError(null);
    try {
      await applyImageChanges(editingPostId, v.images, v.removedImageIds, true);
    } catch (err) {
      reportMutationError(err, "collab.post_images");
      setError(errorMessage(err, "Could not save the images."));
      setSavingImages(false);
      return false;
    }
    form.setFieldValue("images", []);
    form.setFieldValue("removedImageIds", []);
    void queryClient.invalidateQueries({
      queryKey: orpc.getPost.queryOptions({ input: { postId: editingPostId } }).queryKey,
    });
    setSavingImages(false);
    toast.success("Images saved.", { position: "bottom-left" });
    return true;
  };
  const handleSaveImagesAndNext = async () => {
    if (await handleSaveImages()) handleNext();
  };

  // The step label blocking submit, or null when the post is valid. A
  // string selector keeps the subscription cheap (Object.is), and only
  // the REVIEW step pays for the validation re-run per keystroke.
  const submitBlockedBy = useStore(form.store, (s) =>
    isLastStep ? (getFirstIncompleteStep(s.values as WizardFormValues)?.label ?? null) : null,
  );

  return (
    <>
      <CollabCreateHeader
        title={editingPostId !== null ? "EDIT POST." : "POST A GIG."}
        stepLabel={`STEP ${activeIndex + 1}/${WIZARD_TABS.length} · ${WIZARD_TABS[activeIndex]?.label}`}
        restored={draftRestored && editingPostId === null}
      />
      <CollabCreateStepper
        tabs={WIZARD_TABS}
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
            {/* Intro prose, not a label: sized above the 11px field
                labels and given room to breathe, so it reads as the
                step's preamble rather than a caption on the first field. */}
            <Text
              as="p"
              size="md"
              variant="muted"
              density="comfortable"
              textWrap="pretty"
              className="mb-6"
            >
              {WIZARD_TABS[activeIndex]?.desc}
            </Text>
            <WizardFormContext.Provider value={form}>
              {renderStep(currentTab)}
            </WizardFormContext.Provider>
          </motion.div>
        </AnimatePresence>
      </div>
      <CollabCreateFooter
        error={error}
        isFirstStep={activeIndex === 0}
        isLastStep={isLastStep}
        isSubmitting={isSubmitting}
        submitBlockedBy={submitBlockedBy}
        submitLabel={editingPostId !== null ? "SAVE CHANGES" : "SUBMIT"}
        imageRetry={
          imageRetryPostId !== null
            ? { onRetry: () => void handleRetryImages(), onSkip: handleSkipImages }
            : null
        }
        imageSave={
          editingPostId !== null && activeIndex === 0 && pendingImageChanges > 0
            ? {
                count: pendingImageChanges,
                saving: savingImages,
                onSaveAndNext: () => void handleSaveImagesAndNext(),
              }
            : null
        }
        onBack={handleBack}
        onNext={handleNext}
      />
    </>
  );
}

/**
 * Creates the TEAM step's quick-create team and uploads its avatar,
 * returning the new id. The avatar is best-effort: the team and post
 * are the deliverables, and a failed image can be re-added from the
 * team page later.
 */
export async function createDraftTeam(v: WizardFormValues): Promise<string> {
  const team = await client.createTeam({
    name: v.newTeamName.trim(),
    tagline: v.newTeamDescription.trim() || undefined,
  });
  if (v.newTeamImage) {
    try {
      await uploadTeamAvatarImage(team.id, v.newTeamImage.file);
    } catch (err) {
      console.error("Team avatar upload failed", err);
    }
  }
  return team.id;
}

/**
 * Creates or updates the post, returning its id either way. Shared with
 * the quick screen, which fills a subset of the same draft — the rest
 * rides through untouched, so nothing typed in one surface is lost by
 * submitting from the other.
 */
export async function savePost(v: WizardFormValues, editingPostId: number | null): Promise<number> {
  let portfolioUrl: string | undefined;
  if (v.portfolioUrl.trim()) {
    const url = v.portfolioUrl.trim();
    portfolioUrl = /^https?:\/\//.test(url) ? url : `https://${url}`;
  }

  // Compensation goes over the wire as numbers now. It used to be
  // flattened to a display string here and stored that way, which made
  // it unfilterable, unsortable, and impossible to load back into the
  // sliders — the single reason no edit flow could exist.
  const payload = {
    type: v.type!,
    // `null` unlinks on edit; the create path treats both the same.
    jamId: v.jamId ?? null,
    // Guarded against a stale pick surviving a flip to solo.
    teamId: v.isIndividual ? null : (v.teamId ?? null),
    projectId: v.projectId ?? null,
    title: v.title.trim(),
    description: v.description.trim(),
    projectName: v.projectName.trim() || undefined,
    compensationType: v.compensationType,
    compensationMin: v.compensationType === "negotiable" ? undefined : v.compensationMin,
    compensationMax: v.compensationType === "negotiable" ? undefined : v.compensationMax,
    projectLength: v.projectLength,
    platforms: v.platforms,
    experienceLevel: v.experienceLevel,
    portfolioUrl,
    contactMethod: v.contactMethod || undefined,
    contactType: v.contactType,
    isIndividual: v.isIndividual || undefined,
    roleIds: v.roleIds,
    skillIds: v.skillIds.length > 0 ? v.skillIds : undefined,
  };

  if (editingPostId !== null) {
    const updated = await client.updatePost({ postId: editingPostId, ...payload });
    return updated.id;
  }
  const post = await client.createPost(payload);
  return post.id;
}

/**
 * Uploads the pending files and links them to the post. Images are held
 * in memory until submit so abandoned drafts leave no orphan objects in
 * MinIO; the cost is that this step can fail after the post is already
 * live, which is why the caller keeps a retry path open.
 */
export async function attachImages(postId: number, images: UploadedImage[], isEdit: boolean) {
  await applyImageChanges(postId, images, [], isEdit);
}

/**
 * Removals first, then uploads, so a swap never trips the post's image
 * cap on the way through.
 */
export async function applyImageChanges(
  postId: number,
  images: UploadedImage[],
  removedImageIds: number[],
  isEdit: boolean,
) {
  await Promise.all(removedImageIds.map((imageId) => client.removePostImage({ imageId })));
  const uploaded = await Promise.all(images.map((img) => uploadCollabPostImage(postId, img.file)));
  await Promise.all(
    uploaded.map((rec, idx) =>
      client.addPostImage({
        postId,
        imageKey: rec.key,
        url: rec.url,
        alt: images[idx]?.alt,
        sortOrder: isEdit ? EDIT_IMAGE_SORT_BASE + idx : idx,
      }),
    ),
  );
}

function renderStep(tab: WizardTabId) {
  if (tab === "basics") return <StepBasics />;
  if (tab === "team") return <StepTeam />;
  if (tab === "review") return <StepReview />;
  if (tab === "roles") return <StepRoles />;
  return <StepProject />;
}

/** No close control — the drawer owns dismissal. Shared with the quick
 *  screen so the two create surfaces read as one drawer. */
export function CollabCreateHeader({
  title,
  stepLabel,
  restored,
  action,
}: {
  title: string;
  stepLabel: string;
  restored: boolean;
  /** Trailing slot on the title line. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5 border-b border-muted/30 px-5 pt-4 pb-4">
      <div className="flex items-center justify-between gap-3">
        <Heading as="h2" className="text-lg tracking-widest uppercase">
          {title}
        </Heading>
        {action}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Text size="xs" variant="muted" className="tracking-widest">
          {stepLabel}
        </Text>
        {restored ? (
          <Text size="xs" variant="success" className="tracking-widest">
            · DRAFT RESTORED
          </Text>
        ) : null}
      </div>
    </div>
  );
}
