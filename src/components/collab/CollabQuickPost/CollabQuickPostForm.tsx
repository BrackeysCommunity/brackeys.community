import {
  BriefcaseIcon,
  Cancel01Icon,
  Flag02Icon,
  GameController01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { collabStore, resetWizard, updateWizardDraft } from "@/lib/collab-store";
import { CONTACT_TYPE_LABELS } from "@/lib/collab-vocabulary";
import { errorMessage } from "@/lib/error-message";
import { EVENTS, FLOWS, flowStep } from "@/lib/event-taxonomy";
import { useRolesCatalog } from "@/lib/hooks/use-taxonomy";
import { captureEvent, reportMutationError } from "@/lib/product-insights";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { CollabCreateFooter } from "../CollabCreateFlyout/CollabCreateFooter";
import { CollabCreateHeader, savePost } from "../CollabCreateFlyout/CollabCreateForm";
import { ContactFields, useDiscordContactPrefill } from "../CollabCreateFlyout/ContactFields";
import {
  CompensationField,
  FieldRow,
  SelectField,
  TextAreaField,
  TextField,
} from "../CollabCreateFlyout/fields";
import { useWizardForm, WizardFormContext } from "../CollabCreateFlyout/form-context";
import { JamPickerField } from "../CollabCreateFlyout/JamPickerField";
import { RoleSearchPanel } from "../CollabCreateFlyout/RoleSearchPanel";
import {
  COMPENSATION_TYPE_OPTIONS,
  getQuickFieldErrors,
  getStepValidationError,
  profanityCheck,
  projectLengthForJam,
  type AnyFormStore,
  type QuickFieldErrors,
  type WizardFormValues,
} from "../CollabCreateFlyout/shared";
import { SkillSearchPanel } from "../CollabCreateFlyout/SkillSearchPanel";
import { CollabFunnelExplainer } from "./CollabFunnelExplainer";

const EXPLAINER_DISMISS_KEY = "collab.quickpost.explainer.dismissed";

/** One flow, one step: the funnel reads the quick screen as a single stage. */
const QUICK_STEP = flowStep(FLOWS.collabPost, "quick", 1, 1);

/**
 * The KIND control's three faces. JAM LFG is not a post type — it is a
 * hobby post with the jam picker open, the cheapest slice of a jam-shaped
 * archetype — so `type` stays the two-value enum the board filters on.
 */
type Kind = "paid" | "hobby" | "jam";

const KIND_OPTIONS: { value: Kind; label: string; desc: string; icon: IconSvgElement }[] = [
  {
    value: "paid",
    label: "PAID WORK",
    desc: "Contract, freelance, commissions.",
    icon: BriefcaseIcon,
  },
  {
    value: "hobby",
    label: "HOBBY",
    desc: "Passion project, rev-share.",
    icon: GameController01Icon,
  },
  { value: "jam", label: "JAM LFG", desc: "Forming a crew for a jam.", icon: Flag02Icon },
];

/**
 * The one-screen post: who you need, the pitch, what kind of post, and how
 * to reach you. Everything the five-step wizard also asked — team, project,
 * platforms, timeline, experience, images — moved to the live post's
 * STRENGTHEN panel, where each has a payoff to state.
 *
 * Reads and writes the same draft the wizard does, as the same
 * `WizardFormValues`: a draft started here can be finished there and vice
 * versa, and fields this screen doesn't show ride through to `createPost`
 * untouched.
 */
export function CollabQuickPostForm({
  onCreated,
  onSwitchToWizard,
}: {
  onCreated: (postId: number) => void;
  /** The `?flow=wizard` hatch, one click away for a tester who hits a wall. */
  onSwitchToWizard: () => void;
}) {
  const draftRestored = useStore(collabStore, (s) => s.wizard.draftRestored);
  const [initialDraft] = useState(() => collabStore.state.wizard.draft);
  const [error, setError] = useState<string | null>(null);
  // Inline errors appear after the first refused PUBLISH, then track live.
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [jamMode, setJamMode] = useState(initialDraft.jamId !== undefined);

  const form = useForm({
    defaultValues: { ...initialDraft },
    onSubmit: async ({ value }) => {
      const v = value as WizardFormValues;
      setError(null);
      try {
        const postId = await savePost(
          {
            ...v,
            // No crew yet unless the entrance carried one: the crew is
            // minted when the poster accepts someone.
            isIndividual: v.teamId === undefined,
            // A fragment left in a wizard draft is not a project name.
            projectName: v.projectName.trim().length >= 3 ? v.projectName : "",
          },
          null,
        );
        resetWizard();
        onCreated(postId);
      } catch (err) {
        reportMutationError(err, "collab.post_save");
        setError(errorMessage(err, "Could not publish the post."));
      }
    },
  });

  // Mirror the live values into the store so a reload survives — same
  // contract as the wizard.
  useEffect(() => {
    const sync = () => updateWizardDraft(form.state.values as WizardFormValues);
    sync();
    return form.store.subscribe(sync);
  }, [form]);

  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  const values = useStore(form.store, (s) =>
    showFieldErrors ? (s.values as WizardFormValues) : null,
  );
  const fieldErrors: QuickFieldErrors = values ? getQuickFieldErrors(values) : {};

  const handlePublish = () => {
    const v = form.state.values as WizardFormValues;
    const validationError = getStepValidationError("quick", v);
    if (validationError) {
      setShowFieldErrors(true);
      // The message, not a code: the set is bounded by `getQuickFieldErrors`
      // and names the field that stopped them.
      captureEvent(EVENTS.collabPostStepBlocked, { ...QUICK_STEP, reason: validationError });
      setError(validationError);
      return;
    }
    setError(null);
    captureEvent(EVENTS.collabPostSubmitted, { ...QUICK_STEP, mode: "create", surface: "quick" });
    form.handleSubmit();
  };

  return (
    <>
      <CollabCreateHeader
        title="POST A GIG."
        stepLabel="FIVE FIELDS · ADD THE REST ONCE IT'S LIVE"
        restored={draftRestored}
        action={
          <Button
            variant="ghost"
            size="xs"
            className="tracking-widest"
            onClick={onSwitchToWizard}
            title="Open the full five-step form instead"
          >
            FULL FORM
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <WizardFormContext.Provider value={form}>
          <div className="flex flex-col gap-6">
            <CollabFunnelExplainer dismissKey={EXPLAINER_DISMISS_KEY} />
            <ContextChips />
            <WhoSection error={fieldErrors.roles} />
            <PitchSection
              titleError={fieldErrors.title}
              descriptionError={fieldErrors.description}
            />
            <KindSection
              jamMode={jamMode}
              onJamMode={setJamMode}
              typeError={fieldErrors.type}
              compensationError={fieldErrors.compensation}
            />
            <ContactSection />
          </div>
        </WizardFormContext.Provider>
      </div>
      <CollabCreateFooter
        error={error}
        isFirstStep
        isLastStep
        isSubmitting={isSubmitting}
        submitLabel="PUBLISH"
        imageRetry={null}
        onBack={() => {}}
        onNext={handlePublish}
      />
    </>
  );
}

// ── Context chips ──────────────────────────────────────────────────────────

/**
 * What a team page's POST AN OPENING or a project's RECRUIT entrance
 * carried, as removable chips. Nothing else about teams or projects
 * appears on this screen: a team chip means the post is that team's,
 * removing it makes the post solo again. A jam entrance shows up on the
 * KIND control instead, as JAM LFG with the jam under it.
 */
function ContextChips() {
  const form = useWizardForm();
  const teamId = useStore(form.store, (s: AnyFormStore) => s.values.teamId);
  const projectId = useStore(form.store, (s: AnyFormStore) => s.values.projectId);

  const { data: myTeams } = useQuery({
    ...orpc.listMyTeams.queryOptions({ input: {} }),
    enabled: teamId !== undefined,
  });
  const { data: myProjects } = useQuery({
    ...orpc.listEditableProjects.queryOptions({ input: {} }),
    enabled: projectId !== undefined,
    staleTime: STALE.listing,
  });

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (teamId !== undefined) {
    const team = myTeams?.find((t) => t.id === teamId);
    chips.push({
      key: "team",
      label: `as ${team?.name ?? "your team"}`,
      onRemove: () => {
        form.setFieldValue("teamId", undefined);
        form.setFieldValue("isIndividual", true);
      },
    });
  }
  if (projectId !== undefined) {
    const project = myProjects?.projects.find((p) => p.id === projectId);
    chips.push({
      key: "project",
      label: `for ${project?.title ?? "your project"}`,
      onRemove: () => form.setFieldValue("projectId", undefined),
    });
  }
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Text as="span" size="xs" variant="muted" className="tracking-widest uppercase">
        Posting
      </Text>
      {chips.map((chip) => (
        <Badge key={chip.key} variant="outline" size="label" className="gap-1.5 pr-1 uppercase">
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remove: ${chip.label}`}
            className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={9} />
          </button>
        </Badge>
      ))}
    </div>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────

/** Roles first: "I need a…" is the sentence the poster came to say, and
 *  the role filter is how most people find posts. */
function WhoSection({ error }: { error?: string }) {
  const form = useWizardForm();
  const roleIds = useStore(form.store, (s: AnyFormStore) => s.values.roleIds);
  const skillIds = useStore(form.store, (s: AnyFormStore) => s.values.skillIds);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <RoleSearchPanel
          label="WHO YOU NEED *"
          roleIds={roleIds}
          onChange={(ids) => form.setFieldValue("roleIds", ids)}
        />
        {error ? (
          <Text size="xs" variant="danger" className="tracking-wide">
            {error}
          </Text>
        ) : null}
      </div>
      <SkillSearchPanel
        skillIds={skillIds}
        onChange={(ids) => form.setFieldValue("skillIds", ids)}
        offerMySkills
      />
    </div>
  );
}

/** Where the title stops being scannable on a card. */
const TITLE_SOFT_LIMIT = 80;

/**
 * The title placeholder follows the picked roles — a nudge toward the
 * shape that reads best on the board, never written into the field.
 */
function titlePlaceholder(roleNames: string[]): string {
  if (roleNames.length === 0) return "e.g. Pixel artist for a PSX-style horror RPG";
  if (roleNames.length === 1) return `e.g. ${roleNames[0]} for …`;
  return `e.g. ${roleNames[0]} and ${roleNames[1]!.toLowerCase()} for …`;
}

function PitchSection({
  titleError,
  descriptionError,
}: {
  titleError?: string;
  descriptionError?: string;
}) {
  const form = useWizardForm();
  const roleIds = useStore(form.store, (s: AnyFormStore) => s.values.roleIds);
  const { data: roles } = useRolesCatalog();
  const roleNames = roleIds
    .map((id: number) => roles?.find((r) => r.id === id)?.name)
    .filter((name: string | undefined): name is string => Boolean(name));

  return (
    <div className="flex flex-col gap-5">
      <form.Field
        name="title"
        validators={{
          onChange: ({ value }: { value: string }) => {
            if (value.trim().length > 0 && value.trim().length < 10)
              return "Title must be at least 10 characters.";
            return profanityCheck(value, "Title");
          },
        }}
      >
        {(field) => (
          <TextField
            label="TITLE *"
            hint={
              field.state.value.length > TITLE_SOFT_LIMIT
                ? "long titles get truncated on cards"
                : "be specific, people scan"
            }
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
            placeholder={titlePlaceholder(roleNames)}
            maxLength={200}
            error={field.state.meta.errors.map(String).join(" ") || titleError || null}
          />
        )}
      </form.Field>

      <form.Field
        name="description"
        validators={{
          onChange: ({ value }: { value: string }) => {
            if (value.trim().length > 0 && value.trim().length < 30)
              return "Description must be at least 30 characters.";
            return undefined;
          },
        }}
      >
        {(field) => (
          <TextAreaField
            label="DESCRIPTION *"
            hint="markdown supported"
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
            placeholder="What you're making, what the role is, and what you'd want to see from them…"
            maxLength={5000}
            rows={6}
            error={field.state.meta.errors.map(String).join(" ") || descriptionError || null}
          />
        )}
      </form.Field>
    </div>
  );
}

/**
 * PAID WORK / HOBBY / JAM LFG. Paid reveals the compensation fields; JAM
 * LFG opens the jam picker inline, keeps the picked jam showing under the
 * control, and fills a blank timeline from the jam's dates. Switching off
 * JAM LFG drops the jam — the control is the jam's only representation on
 * this screen.
 */
function KindSection({
  jamMode,
  onJamMode,
  typeError,
  compensationError,
}: {
  jamMode: boolean;
  onJamMode: (on: boolean) => void;
  typeError?: string;
  compensationError?: string;
}) {
  const form = useWizardForm();
  const type = useStore(form.store, (s: AnyFormStore) => s.values.type);
  const jamId = useStore(form.store, (s: AnyFormStore) => s.values.jamId);
  const compensationType = useStore(form.store, (s: AnyFormStore) => s.values.compensationType);
  const active: Kind | undefined = jamMode ? "jam" : type;

  const pick = (kind: Kind) => {
    form.setFieldValue("type", kind === "paid" ? "paid" : "hobby");
    if (kind === "jam") {
      onJamMode(true);
    } else {
      onJamMode(false);
      if (jamId !== undefined) form.setFieldValue("jamId", undefined);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <FieldRow label="KIND *" error={typeError ?? null}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {KIND_OPTIONS.map((opt) => {
            const isActive = active === opt.value;
            return (
              <Chonk
                key={opt.value}
                variant={isActive ? "default" : "surface"}
                size="lg"
                render={
                  <button type="button" aria-pressed={isActive} onClick={() => pick(opt.value)} />
                }
                className="flex w-full flex-col items-stretch gap-2 p-3 text-left"
              >
                <HugeiconsIcon
                  icon={opt.icon}
                  size={16}
                  className={isActive ? "text-primary" : "text-muted-foreground"}
                />
                <div className="flex flex-col gap-0.5">
                  <Text
                    as="span"
                    bold
                    size="xs"
                    className={cn(
                      "tracking-widest uppercase",
                      isActive ? "text-primary" : "text-foreground",
                    )}
                  >
                    {opt.label}
                  </Text>
                  <Text size="xs" variant="muted">
                    {opt.desc}
                  </Text>
                </div>
              </Chonk>
            );
          })}
        </div>
      </FieldRow>

      {jamMode ? (
        <JamPickerField
          value={jamId}
          onChange={(jam) => {
            form.setFieldValue("jamId", jam?.jamId);
            const derived = jam ? projectLengthForJam(jam.startsAt, jam.endsAt) : undefined;
            if (derived && !form.state.values.projectLength) {
              form.setFieldValue("projectLength", derived);
            }
          }}
        />
      ) : null}

      {type === "paid" ? (
        <>
          <form.Field name="compensationType">
            {(field) => (
              <SelectField
                label="COMPENSATION TYPE *"
                value={field.state.value}
                onChange={field.handleChange}
                options={COMPENSATION_TYPE_OPTIONS}
                placeholder="How you're paying…"
              />
            )}
          </form.Field>
          {compensationType && compensationType !== "negotiable" ? (
            <form.Field name="compensationMin">
              {(minField) => (
                <form.Field name="compensationMax">
                  {(maxField) => (
                    <CompensationField
                      compensationType={compensationType}
                      min={minField.state.value}
                      max={maxField.state.value}
                      onMinChange={(v) => minField.handleChange(v)}
                      onMaxChange={(v) => maxField.handleChange(v)}
                    />
                  )}
                </form.Field>
              )}
            </form.Field>
          ) : null}
          {compensationError ? (
            <Text size="xs" variant="danger" className="tracking-wide">
              {compensationError}
            </Text>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * Collapsed behind the prefilled Discord DM for everyone; CHANGE opens
 * the full contact fields. A poster with no handle on file sees the
 * fields directly.
 */
function ContactSection() {
  const form = useWizardForm();
  const discordUsername = useDiscordContactPrefill();
  const contactType = useStore(form.store, (s: AnyFormStore) => s.values.contactType);
  const contactMethod = useStore(form.store, (s: AnyFormStore) => s.values.contactMethod);
  const [expanded, setExpanded] = useState(false);

  const prefilled = Boolean(contactType && contactMethod.trim());
  if (expanded || !prefilled) return <ContactFields />;

  return (
    <FieldRow label="CONTACT" hint="optional · accepted people also get your Discord">
      <Well variant="ghost" className="flex-row items-center justify-between gap-3 p-2.5">
        <Text size="sm" ellipsis className="min-w-0">
          {CONTACT_TYPE_LABELS[contactType!] ?? contactType}
          {" · "}
          {contactType === "discord_dm" && contactMethod === discordUsername
            ? `@${contactMethod}`
            : contactMethod}
        </Text>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="shrink-0 tracking-widest"
          onClick={() => setExpanded(true)}
        >
          CHANGE
        </Button>
      </Well>
    </FieldRow>
  );
}
