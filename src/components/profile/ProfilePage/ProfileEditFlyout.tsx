import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  DragDropHorizontalIcon,
  GithubIcon,
  HourglassIcon,
  ClipboardIcon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GlowStopPicker } from "@/components/profile/ProfilePage/GlowStopPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Heading, Text } from "@/components/ui/typography";
import { MarkedText } from "@/components/ui/typography/marked-text";
import { Well } from "@/components/ui/well";
import { siteOrigin } from "@/env";
import { updateActiveUserProfile } from "@/lib/active-user-store";
import { startGitHubLink } from "@/lib/auth-client";
import { compensationLabel } from "@/lib/collab-vocabulary";
import { CURRENCY_OPTIONS, type Currency, normalizeCurrency } from "@/lib/currency";
import { errorMessage } from "@/lib/error-message";
import { EVENTS, FLOWS, flowStep } from "@/lib/event-taxonomy";
import { useAnimatedUnderline } from "@/lib/hooks/use-animated-underline";
import { useAutosavedField } from "@/lib/hooks/use-autosaved-field";
import { useAvailabilityToggle } from "@/lib/hooks/use-availability-toggle";
import { useDebouncedCallback } from "@/lib/hooks/use-debounced-callback";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { useStepScroll } from "@/lib/hooks/use-step-scroll";
import { useRolesCatalog } from "@/lib/hooks/use-taxonomy";
import { startItchOAuth } from "@/lib/itchio-oauth";
import { AVAILABILITY_OPTIONS } from "@/lib/member-vocabulary";
import { stepBody, stepBodyTransition } from "@/lib/motion";
import {
  decodeNameGlow,
  encodeNameGlow,
  MAX_GLOW_STOPS,
  NAME_GLOW_MOTION_LABELS,
  NAME_GLOW_MOTIONS,
  type NameGlowMotion,
  nameGlowProps,
  normalizeGlowMotion,
  resolveNameGlow,
} from "@/lib/name-glow";
import { captureEvent, reportMutationError } from "@/lib/product-insights";
import { PAGE_CUES } from "@/lib/sound";
import { allTimezones, browserTimezone, timezoneOffsetLabel } from "@/lib/timezones";
import { toast } from "@/lib/toast";
import { STUB_REGEX } from "@/lib/url-stub";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WEBSITE_LINK_TYPE,
  WEBSITE_LINK_TYPE_OPTIONS,
  type WebsiteLinkType,
} from "@/lib/website-link-type";
import { client, orpc } from "@/orpc/client";

import type { ProfileSkill, ProfileViewModel } from "./helpers";
import { EDIT_STEP_COUNT, EDIT_STEP_SLUGS, type EditStep } from "./shared-types";

interface ProfileEditFlyoutProps {
  open: boolean;
  step: EditStep;
  profile: ProfileViewModel;
  /** TanStack Query key for the underlying `getProfile` fetch — the
   * flyout invalidates it on every successful mutation so the page
   * re-renders with the persisted values. */
  queryKey?: readonly unknown[];
  onClose: () => void;
  onStepChange: (step: EditStep) => void;
}

interface StepDef {
  step: EditStep;
  title: string;
  hint: string;
}

/** What the swatch opens on before a booster has chosen anything. */
const DEFAULT_GLOW_SWATCH = "#7f5af0";

const STEPS: StepDef[] = [
  { step: 1, title: "IDENTITY", hint: "name, roles, timezone, profile URL" },
  { step: 2, title: "BIO & SKILLS", hint: "long-form bio + skill tags" },
  { step: 3, title: "AVAILABILITY", hint: "open to hire, rate, response time" },
  { step: 4, title: "LINKS", hint: "github, itch, portfolio" },
];

const STEP_IDS: readonly EditStep[] = STEPS.map((s) => s.step);

const DESKTOP_TRANSITION = { type: "spring" as const, stiffness: 480, damping: 36, mass: 0.7 };
const MOBILE_TRANSITION = { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.65 };

// ── Save status ────────────────────────────────────────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SaveContext {
  status: SaveStatus;
  setStatus: (s: SaveStatus) => void;
}

/**
 * Profile edit affordance — a desktop right-side flyout and a mobile
 * bottom sheet share one component. Each step's fields persist
 * directly to the profile via `updateProfile` / `setUrlStub` /
 * skill-list mutations. Switches and selects save instantly; text
 * fields save when the member leaves them (`useAutosavedField`), and
 * the profile URL alone waits for Enter or blur, since the route is
 * keyed on it. The query key passed in is invalidated on every success
 * so the page reflects the latest values without a manual refetch.
 */
export function ProfileEditFlyout({
  open,
  step,
  profile,
  queryKey,
  onClose,
  onStepChange,
}: ProfileEditFlyoutProps) {
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<SaveStatus>("idle");
  // Track the previous step so step transitions can pick a
  // direction: forward (1→2) slides the new content in from the
  // right, backward (2→1) slides it in from the left. We mirror the
  // current step into a `previousStep` state value via a render-time
  // setter — same trick React's docs recommend for "track previous
  // value" patterns without violating the no-ref-read-during-render
  // rule.
  const [trackedStep, setTrackedStep] = useState<EditStep>(step);
  const [previousStep, setPreviousStep] = useState<EditStep>(step);
  if (step !== trackedStep) {
    setPreviousStep(trackedStep);
    setTrackedStep(step);
  }
  const direction = step >= previousStep ? 1 : -1;
  const scrollRef = useStepScroll(step);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  // The collab wizard separates "wouldn't let them through" from "walked
  // away" with a step_blocked event; this flyout has no NEXT gate — its
  // equivalent friction is a field save being refused — so the same event
  // fires when a step's save lands in error.
  const setStatusTracked = (s: SaveStatus) => {
    if (s === "error") {
      captureEvent(EVENTS.profileEditStepBlocked, {
        ...flowStep(FLOWS.profileEdit, EDIT_STEP_SLUGS[step], step, EDIT_STEP_COUNT),
        reason: "save_failed",
      });
    }
    setStatus(s);
  };
  const saveCtx: SaveContext = { status, setStatus: setStatusTracked };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
            style={{ touchAction: "none" }}
          />
          <motion.div
            key="panel"
            initial={isMobile ? { y: "100%" } : { x: "100%" }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: "100%" } : { x: "100%" }}
            transition={isMobile ? MOBILE_TRANSITION : DESKTOP_TRANSITION}
            className={cn(
              "fixed z-50 flex flex-col border-muted/30 bg-background shadow-[0_0_60px_0_rgba(0,0,0,0.4)]",
              // Mobile bottom sheet sits at a fixed two-thirds height
              // — content scrolls inside it. A variable-height sheet
              // looks great on paper but the resize on every step
              // change ends up feeling janky no matter how it's
              // animated, so we lock the size and let the body
              // overflow.
              isMobile
                ? "inset-x-0 bottom-0 h-[66vh] rounded-t-xl border-t"
                : "inset-y-0 right-0 w-[28rem] max-w-[100vw] border-l",
            )}
          >
            <FlyoutHeader profile={profile} step={step} isMobile={isMobile} onClose={onClose} />
            <Stepper step={step} onSelect={onStepChange} />
            {/* Step content cross-fades with a slight scale and a
                directional nudge on each step change. `mode="wait"`
                holds the new content until the old one finishes its
                exit so the body never renders two steps stacked. */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={step}
                  custom={direction}
                  variants={stepBody}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={stepBodyTransition}
                  className="px-5 py-5"
                >
                  <StepBody step={step} profile={profile} queryKey={queryKey} save={saveCtx} />
                </motion.div>
              </AnimatePresence>
            </div>
            <FlyoutFooter
              status={status}
              step={step}
              onStepChange={onStepChange}
              onClose={onClose}
            />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

// ── Header / stepper / footer chrome ───────────────────────────────

function FlyoutHeader({
  profile,
  step,
  isMobile,
  onClose,
}: {
  profile: ProfileViewModel;
  step: EditStep;
  isMobile: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-muted/30 px-5 pt-5 pb-4">
      {isMobile ? (
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Heading as="h2" className="text-lg tracking-widest uppercase">
            EDIT PROFILE
          </Heading>
          <Text size="xs" variant="muted" className="tracking-widest">
            @{profile.handle.toLowerCase()} · STEP {step}/{STEPS.length}
          </Text>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" tooltip="Close" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
    </div>
  );
}

function Stepper({ step, onSelect }: { step: EditStep; onSelect: (s: EditStep) => void }) {
  const { containerRef, registerTab, motionStyle } = useAnimatedUnderline({
    active: step,
    tabIds: STEP_IDS,
  });
  return (
    <div ref={containerRef} className="relative flex border-b border-muted/30">
      {STEPS.map((s) => {
        const isActive = s.step === step;
        return (
          <button
            key={s.step}
            ref={registerTab(s.step)}
            type="button"
            onClick={() => onSelect(s.step)}
            {...PAGE_CUES}
            className={cn(
              // flex-auto sizes each tab from its label so the long
              // ones ("AVAILABILITY") keep room on narrow screens.
              "relative flex flex-auto cursor-pointer flex-col items-center justify-center gap-1 px-1.5 py-3 transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Text
              as="span"
              size="xs"
              variant="muted"
              className={cn(
                "rounded px-1.5 py-0.5 tracking-widest tabular-nums",
                isActive ? "bg-warning/20 text-warning" : "bg-muted/40",
              )}
            >
              {s.step.toString().padStart(2, "0")}
            </Text>
            <span className="text-[10px] tracking-widest">{s.title}</span>
          </button>
        );
      })}
      <motion.span
        aria-hidden
        style={motionStyle}
        className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-accent"
      />
    </div>
  );
}

function FlyoutFooter({
  status,
  step,
  onStepChange,
  onClose,
}: {
  status: SaveStatus;
  step: EditStep;
  onStepChange: (s: EditStep) => void;
  onClose: () => void;
}) {
  const isLast = step === STEPS.length;
  const isFirst = step === 1;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-muted/30 px-5 py-3">
      <SaveStatusIndicator status={status} />
      <div className="flex items-center gap-2">
        {!isFirst ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStepChange((step - 1) as EditStep)}
            className="tracking-widest"
          >
            ← BACK
          </Button>
        ) : null}
        {isLast ? (
          <Button variant="default" size="sm" onClick={onClose} className="tracking-widest">
            DONE
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={() => onStepChange((step + 1) as EditStep)}
            className="tracking-widest"
          >
            NEXT →
          </Button>
        )}
      </div>
    </div>
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs tracking-widest text-muted-foreground uppercase">
        <Spinner className="size-3" />
        SAVING…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs tracking-widest text-success uppercase">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
        SAVED
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs tracking-widest text-destructive uppercase">
        SAVE FAILED — RETRY
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs tracking-widest text-muted-foreground/60 uppercase">
      ⟢ AUTO-SAVE
    </span>
  );
}

// ── Step bodies ────────────────────────────────────────────────────

interface StepProps {
  profile: ProfileViewModel;
  queryKey?: readonly unknown[];
  save: SaveContext;
}

function StepBody({ step, profile, queryKey, save }: { step: EditStep } & StepProps) {
  if (step === 1) return <IdentityStep profile={profile} queryKey={queryKey} save={save} />;
  if (step === 2) return <BioSkillsStep profile={profile} queryKey={queryKey} save={save} />;
  if (step === 3) return <AvailabilityStep profile={profile} queryKey={queryKey} save={save} />;
  return <LinksStep profile={profile} queryKey={queryKey} save={save} />;
}

function IdentityStep({ profile, queryKey, save }: StepProps) {
  const update = useUpdateProfile(queryKey, save);
  const tagline = useAutosavedField(profile.tag ?? "", (value) =>
    update.mutateAsync({ tagline: value }),
  );
  const location = useAutosavedField(profile.location ?? "", (value) =>
    update.mutateAsync({ location: value.trim() || null }),
  );

  return (
    <StepFrame title="IDENTITY">
      <FieldRow label="DISPLAY NAME" hint="comes from your discord profile">
        <Input value={profile.name} disabled />
      </FieldRow>
      <FieldRow label="TAG" hint="shows under your name in the hero">
        <Input
          value={tagline.value}
          onChange={(e) => tagline.onChange(e.target.value)}
          onBlur={tagline.onBlur}
          placeholder="dev, designer, etc."
        />
      </FieldRow>
      <RolesField profile={profile} queryKey={queryKey} save={save} />
      <FieldRow label="TIMEZONE" hint="powers the directory's “within ±3h of me” filter">
        <TimezoneField
          value={profile.availability.timezone}
          onChange={(tz) => update.mutate({ timezone: tz })}
        />
      </FieldRow>
      <FieldRow label="LOCATION" hint="optional, free text — “Lisbon-ish” counts">
        <Input
          value={location.value}
          onChange={(e) => location.onChange(e.target.value)}
          onBlur={location.onBlur}
          placeholder="city, country, or vibe"
        />
      </FieldRow>
      {profile.canUseNameGlow ? (
        <NameGlowField profile={profile} queryKey={queryKey} save={save} />
      ) : null}
      <ProfileUrlField profile={profile} queryKey={queryKey} save={save} />
    </StepFrame>
  );
}

/** The name glow: up to three stops, and how they move. Only mounted for
 *  members entitled to one — the server refuses the write for anyone else, so
 *  showing the control to them would be a lie. */
function NameGlowField({ profile, queryKey, save }: StepProps) {
  const update = useUpdateProfile(queryKey, save);
  // Serialised through the shared autosave field rather than saved per change:
  // a slider drag is one decision, and a write per frame is a request storm.
  const field = useAutosavedField((profile.nameGlowColors ?? []).join(","), (value) => {
    const next = splitStops(value);
    return update.mutateAsync({ nameGlowColors: next.length > 0 ? next : null });
  });
  const stops = splitStops(field.value);
  // Held locally so the strip and the preview move on the press. Reading the
  // motion back off `profile` means waiting for the write *and* the query
  // that follows it, which is a visible lag on what should feel like a
  // toggle. The draft stands once set — it is what the member chose.
  const [motionDraft, setMotionDraft] = useState<NameGlowMotion | null>(null);
  const motion = motionDraft ?? normalizeGlowMotion(profile.nameGlowMotion);
  // The field only mounts for an entitled member, so the preview asserts
  // entitlement rather than re-deriving it from roles it doesn't hold.
  const glow = nameGlowProps(resolveNameGlow({ nameGlowColors: stops, isBooster: true }), motion);

  /** Adding, removing and clearing are single presses, so they skip the
   *  debounce the sliders need. */
  const commit = (next: string[]) => {
    field.onChange(next.join(","));
    field.onBlur();
  };

  const setMotion = (next: NameGlowMotion) => {
    setMotionDraft(next);
    update.mutate({ nameGlowMotion: next });
  };

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(encodeNameGlow(stops, motion));
      toast.success("Glow copied");
    } catch {
      toast.error("Couldn't reach the clipboard");
    }
  };

  const pasteConfig = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast.error("Couldn't read the clipboard");
      return;
    }
    const config = decodeNameGlow(text);
    if (!config) {
      toast.error("That isn't a glow", {
        description: "Expected something like glow:rotate:7f5af0,1f0fbd",
      });
      return;
    }
    commit(config.stops);
    if (config.motion && config.motion !== motion) setMotion(config.motion);
    toast.success("Glow applied");
  };

  return (
    <FieldRow
      label="NAME GLOW"
      hint="boosters, BIPs & staff · up to three colours"
      action={
        <div className="flex items-center gap-0.5">
          {stops.length > 0 ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Copy glow"
              tooltip="Copy this glow as one line"
              onClick={copyConfig}
            >
              <HugeiconsIcon icon={Copy01Icon} size={14} />
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Paste glow"
            tooltip="Paste a copied glow"
            onClick={pasteConfig}
          >
            <HugeiconsIcon icon={ClipboardIcon} size={14} />
          </Button>
          {stops.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => commit([])}
              tooltip="Back to the default name colour"
            >
              CLEAR
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {stops.map((stop, index) => (
            <GlowStopPicker
              key={index}
              index={index}
              value={stop}
              onChange={(hex) =>
                field.onChange(stops.map((c, n) => (n === index ? hex : c)).join(","))
              }
              onCommit={field.onBlur}
              onRemove={() => commit(stops.filter((_, n) => n !== index))}
            />
          ))}
          {stops.length < MAX_GLOW_STOPS ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 tracking-widest"
              onClick={() => commit([...stops, DEFAULT_GLOW_SWATCH])}
            >
              {stops.length === 0 ? "+ COLOUR" : "+ STOP"}
            </Button>
          ) : null}
          <span
            className={cn("ml-auto truncate text-lg font-semibold tracking-tight", glow.className)}
            style={glow.style}
          >
            {profile.name}
          </span>
        </div>

        {/* A single stop is a flat colour, so there is nothing to move yet. */}
        {stops.length > 1 ? (
          <SegmentedControl
            value={motion}
            onChange={(next) => setMotion(normalizeGlowMotion(next))}
            aria-label="Name glow motion"
            className="w-full"
          >
            {NAME_GLOW_MOTIONS.map((option) => (
              <SegmentedControl.Item key={option} value={option} className="tracking-widest">
                {NAME_GLOW_MOTION_LABELS[option]}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
        ) : null}
      </div>
    </FieldRow>
  );
}

/** The stop list as the autosave field carries it — one string, so the shared
 *  hook's "did this actually change" check stays a string comparison. */
function splitStops(value: string): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

/**
 * The vanity URL — the one field here that commits explicitly, on Enter or
 * blur. Saving mid-keystroke publishes every prefix as a real claim, and the
 * route is keyed on the stub, so the first one strands the member on a URL
 * that no longer resolves.
 *
 * Clearing it is a claim too: the profile falls back to the Discord-derived
 * default, or to its raw id. Both paths write the stub back to
 * `activeUserStore`, which is where the header's ME link reads from.
 */
function ProfileUrlField({ profile, queryKey, save }: StepProps) {
  const siteHost = new URL(siteOrigin()).host;
  const setStub = useSetUrlStub(queryKey, save);
  const clearStub = useClearUrlStub(queryKey, save);
  const followStub = useFollowStub();
  // `handle` falls back to the discord username for display; only a slug
  // that isn't the raw id is a stub actually held.
  const claimed = profile.slug === profile.profileId ? "" : profile.slug;
  const [value, setValue] = useState(claimed);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const savedRef = useRef(claimed);

  const commit = () => {
    const next = value.trim();
    const previous = savedRef.current;
    if (next === previous || setStub.isPending || clearStub.isPending) return;
    setError(null);

    if (!next) {
      savedRef.current = "";
      clearStub.mutate(undefined, {
        onSuccess: ({ stub, slug }) => {
          savedRef.current = stub ?? "";
          setValue(stub ?? "");
          updateActiveUserProfile({ urlStub: stub });
          setNote(
            stub
              ? `Cleared — you're back on your discord handle, @${stub}.`
              : "Cleared — your profile answers to its id now.",
          );
          followStub(previous, slug);
        },
        onError: (err) => {
          savedRef.current = previous;
          setError(errorMessage(err, "Couldn't clear"));
        },
      });
      return;
    }

    if (!STUB_REGEX.test(next)) {
      setError("3–32 characters, starting and ending with a letter or number.");
      return;
    }

    savedRef.current = next;
    setStub.mutate(
      { stub: next },
      {
        onSuccess: (row) => {
          savedRef.current = row.stub;
          setValue(row.stub);
          setNote(null);
          updateActiveUserProfile({ urlStub: row.stub });
          followStub(previous, row.stub);
        },
        onError: (err) => {
          savedRef.current = previous;
          setError(errorMessage(err, "Couldn't save"));
        },
      },
    );
  };

  return (
    <FieldRow
      label="PROFILE URL"
      hint="3–32 chars · saves on enter or when you leave the field"
      error={error}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
        <Badge variant="secondary" className="font-mono text-[11px] tracking-widest normal-case">
          {siteHost}/profile/
        </Badge>
        <Input
          value={value}
          onChange={(e) => {
            setNote(null);
            setValue(
              e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "")
                .slice(0, 32),
            );
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit();
          }}
          placeholder="leave empty for your discord handle"
        />
      </div>
      {note ? (
        <Text size="xs" variant="muted" className="tracking-wide">
          {note}
        </Text>
      ) : null}
    </FieldRow>
  );
}

/** Mirrors the server's cap (`MAX_PROFILE_ROLES` in the profile router). */
const MAX_ROLES = 3;

/**
 * The member's craft claims — up to three picks from the same curated
 * `collab_roles` vocabulary the board hires against. A replace-set
 * mutation rather than add/remove pairs: the chip row always knows the
 * whole intended set.
 */
function RolesField({ profile, queryKey, save }: StepProps) {
  const seedProfile = useSeedProfile(queryKey);
  const { data: allRoles } = useRolesCatalog();

  const setRoles = useMutation({
    mutationFn: (roleIds: number[]) => client.setMyRoles({ roleIds }),
    onMutate: () => save.setStatus("saving"),
    onSuccess: (roles) => {
      save.setStatus("saved");
      seedProfile({ roles });
    },
    onError: (err) => {
      reportMutationError(err, "profile.set_roles");
      save.setStatus("error");
    },
  });

  const selected = profile.roles;
  const selectedIds = new Set(selected.map((r) => r.id));
  const options = (allRoles ?? []).filter((r) => !selectedIds.has(r.id));
  const atCap = selected.length >= MAX_ROLES;

  return (
    <FieldRow
      label="ROLES"
      hint={`what you are, up to ${MAX_ROLES} — the board hires against the same list`}
    >
      <div className="flex flex-col gap-2">
        {selected.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((role) => (
              <Badge
                key={role.id}
                variant="secondary"
                className="gap-1.5 font-mono text-[11px] tracking-widest uppercase"
              >
                {role.name}
                <button
                  type="button"
                  onClick={() =>
                    setRoles.mutate(selected.filter((r) => r.id !== role.id).map((r) => r.id))
                  }
                  aria-label={`Remove ${role.name}`}
                  className="-mr-0.5 inline-flex cursor-pointer items-center text-secondary-foreground/60 transition-colors hover:text-destructive"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={10} />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        {!atCap ? (
          <Combobox
            items={options}
            value={null}
            onValueChange={(next: (typeof options)[number] | null) => {
              if (next) setRoles.mutate([...selected.map((r) => r.id), next.id]);
            }}
            itemToStringLabel={(role: (typeof options)[number]) => role.name}
            isItemEqualToValue={(a: (typeof options)[number], b: (typeof options)[number]) =>
              a.id === b.id
            }
          >
            <ComboboxInput placeholder="Add a role — composer, pixel artist…" className="w-full" />
            <ComboboxContent>
              <ComboboxList>
                {(role: (typeof options)[number]) => (
                  <ComboboxItem key={role.id} value={role}>
                    <span className="flex-1">{role.name}</span>
                    {role.category ? (
                      <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                        {role.category}
                      </span>
                    ) : null}
                  </ComboboxItem>
                )}
              </ComboboxList>
              <ComboboxEmpty>No matching role</ComboboxEmpty>
            </ComboboxContent>
          </Combobox>
        ) : null}
      </div>
    </FieldRow>
  );
}

/**
 * IANA zone picker. Offsets in the option rows are *current* (DST-aware),
 * derived per render — never stored. The shortcut chip fills in the
 * browser's own zone, which is the right answer for nearly everyone.
 */
function TimezoneField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (tz: string | null) => void;
}) {
  const zones = allTimezones();
  const detected = browserTimezone();

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Combobox
          items={zones}
          value={value}
          onValueChange={(next: string | null) => {
            // The combobox clears itself while typing; only a real pick
            // (or the explicit × button) should write the profile.
            if (next) onChange(next);
          }}
          itemToStringLabel={(tz: string) => tz}
        >
          <ComboboxInput placeholder="Europe/Madrid, America/Chicago…" className="w-full" />
          <ComboboxContent>
            <ComboboxList>
              {(tz: string) => (
                <ComboboxItem key={tz} value={tz}>
                  <span className="flex-1">{tz}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {timezoneOffsetLabel(tz)}
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
            <ComboboxEmpty>No matching zone</ComboboxEmpty>
          </ComboboxContent>
        </Combobox>
        {value ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange(null)}
            aria-label="Clear timezone"
            tooltip="Clear timezone"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </Button>
        ) : null}
      </div>
      {detected && detected !== value ? (
        <Button
          variant="outline"
          size="xs"
          onClick={() => onChange(detected)}
          className="self-start tracking-widest"
        >
          USE {detected.toUpperCase()} · {timezoneOffsetLabel(detected)}
        </Button>
      ) : null}
    </div>
  );
}

function BioSkillsStep({ profile, queryKey, save }: StepProps) {
  const update = useUpdateProfile(queryKey, save);
  const bio = useAutosavedField(profile.bio ?? "", (value) => update.mutateAsync({ bio: value }));
  const [preview, setPreview] = useState(false);
  return (
    <StepFrame title="BIO & SKILLS">
      <FieldRow
        label="BIO"
        hint={preview ? "preview · markdown rendered" : "markdown supported · keep it human"}
        action={
          <Button
            variant="outline"
            size="xs"
            onClick={() => setPreview((p) => !p)}
            className="tracking-widest"
          >
            <HugeiconsIcon icon={preview ? ViewOffSlashIcon : ViewIcon} size={12} />
            {preview ? "EDIT" : "PREVIEW"}
          </Button>
        }
      >
        {preview ? (
          <Well className="min-h-32 p-3">
            {bio.value.trim() ? (
              <MarkedText censor={false} className="text-foreground">
                {bio.value}
              </MarkedText>
            ) : (
              <Text size="sm" variant="muted" className="italic">
                Nothing to preview yet — switch back to EDIT.
              </Text>
            )}
          </Well>
        ) : (
          <Textarea
            value={bio.value}
            rows={6}
            onChange={(e) => bio.onChange(e.target.value)}
            onBlur={bio.onBlur}
            placeholder="game-adjacent dev who…"
            className="min-h-32"
          />
        )}
      </FieldRow>
      <SkillsField profile={profile} queryKey={queryKey} save={save} />
    </StepFrame>
  );
}

/**
 * Inline skills editor — same model as the legacy `SkillAutocomplete`
 * but rebuilt to live inside the new flyout's typography. Renders the
 * user's active skills as removable chips, the pending skill-requests
 * with a clock glyph, and a search/add input that hits `listSkills`
 * for autocomplete and falls back to `requestSkill` when the typed
 * name doesn't match an existing entry.
 */
function SkillsField({ profile, queryKey, save }: StepProps) {
  const qc = useQueryClient();
  const seedProfile = useSeedProfile(queryKey);
  const invalidate = () => {
    if (queryKey) void qc.invalidateQueries({ queryKey });
  };

  const addSkill = useMutation({
    mutationFn: (skillId: number) => client.addUserSkill({ skillId }),
    onMutate: () => save.setStatus("saving"),
    onSuccess: (skills) => {
      save.setStatus("saved");
      seedProfile({ skills });
    },
    onError: (err) => {
      reportMutationError(err, "profile.add_skill");
      save.setStatus("error");
    },
  });
  const removeSkill = useMutation({
    mutationFn: (userSkillId: number) => client.removeUserSkill({ userSkillId }),
    onMutate: () => save.setStatus("saving"),
    onSuccess: (skills) => {
      save.setStatus("saved");
      seedProfile({ skills });
    },
    onError: (err) => {
      reportMutationError(err, "profile.remove_skill");
      save.setStatus("error");
    },
  });
  const requestSkill = useMutation({
    mutationFn: (name: string) => client.requestSkill({ name }),
    onMutate: () => save.setStatus("saving"),
    onSuccess: () => {
      save.setStatus("saved");
      invalidate();
      toast.success("Skill request submitted");
    },
    onError: (err) => {
      reportMutationError(err, "profile.request_skill");
      save.setStatus("error");
    },
  });
  const cancelRequest = useMutation({
    mutationFn: (name: string) => client.cancelSkillRequest({ name }),
    onMutate: () => save.setStatus("saving"),
    onSuccess: () => {
      save.setStatus("saved");
      invalidate();
    },
    onError: (err) => {
      reportMutationError(err, "profile.cancel_skill_request");
      save.setStatus("error");
    },
  });

  // The order is the claim: the profile's meta line shows the first one or
  // two and nothing else. Held locally between the drop and the server's
  // answer so the chips don't snap back for a round trip.
  const [draggedOrder, setDraggedOrder] = useState<number[] | null>(null);
  const setSkills = useMutation({
    mutationFn: (skillIds: number[]) => client.setMySkills({ skillIds }),
    onMutate: () => save.setStatus("saving"),
    onSuccess: (skills) => {
      save.setStatus("saved");
      setDraggedOrder(null);
      seedProfile({ skills });
    },
    onError: (err) => {
      reportMutationError(err, "profile.set_skills");
      setDraggedOrder(null);
      save.setStatus("error");
    },
  });

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so the remove button on
    // a chip stays clickable.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const saved = profile.skills.filter((s) => s.state === "active");
  const active = draggedOrder
    ? [...saved].sort(
        (a, b) => draggedOrder.indexOf(Number(a.id)) - draggedOrder.indexOf(Number(b.id)),
      )
    : saved;
  const pending = profile.skills.filter((s) => s.state === "pending");
  // The unique `(user_id, skill_id)` pair means a duplicate add is a no-op
  // server-side; filtering the search as well keeps it from looking like
  // one silently failed.
  const takenNames = new Set([...active, ...pending].map((s) => s.name.toLowerCase()));

  const onDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) return;
    const rowIds = active.map((s) => Number(s.id));
    const from = rowIds.indexOf(Number(dragged.id));
    const to = rowIds.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;

    const next = arrayMove(rowIds, from, to);
    setDraggedOrder(next);
    const skillIdByRow = new Map(active.map((s) => [Number(s.id), s.skillId]));
    setSkills.mutate(
      next.map((rowId) => skillIdByRow.get(rowId)).filter((id): id is number => id != null),
    );
  };

  return (
    <FieldRow label="SKILLS" hint="drag to reorder, add and remove inline">
      <Well className="gap-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={active.map((s) => Number(s.id))}
              strategy={horizontalListSortingStrategy}
            >
              {active.map((skill) => (
                <SortableSkillChip
                  key={skill.id}
                  skill={skill}
                  onRemove={() => {
                    if (typeof skill.id === "number") removeSkill.mutate(skill.id);
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
          {pending.map((skill) => (
            <PendingChip
              key={skill.id}
              skill={skill}
              onCancel={() => cancelRequest.mutate(skill.name)}
            />
          ))}
          <SkillSearch
            takenNames={takenNames}
            onAdd={(skillId) => addSkill.mutate(skillId)}
            onRequest={(name) => requestSkill.mutate(name)}
          />
        </div>
        <Text size="xs" variant="muted">
          The first couple show on your profile's byline — drag a chip, or focus its handle and use
          the arrow keys, to choose which. Search picks an existing skill from the global list; if
          yours isn't there, submit a request — moderators approve it before it goes live.
        </Text>
      </Well>
    </FieldRow>
  );
}

/** A skill chip with a drag handle. The handle carries the drag listeners
 *  rather than the whole chip, so the remove button keeps working and the
 *  keyboard has one predictable place to pick the chip up from. */
function SortableSkillChip({ skill, onRemove }: { skill: ProfileSkill; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: Number(skill.id),
  });

  return (
    <span
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      <SkillChip
        skill={skill}
        onRemove={onRemove}
        handle={
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${skill.name}`}
            className="-ml-0.5 inline-flex cursor-grab items-center text-secondary-foreground/50 transition-colors hover:text-secondary-foreground active:cursor-grabbing"
          >
            <HugeiconsIcon icon={DragDropHorizontalIcon} size={10} />
          </button>
        }
      />
    </span>
  );
}

function SkillChip({
  skill,
  onRemove,
  handle,
}: {
  skill: ProfileSkill;
  onRemove: () => void;
  handle?: React.ReactNode;
}) {
  return (
    <Badge variant="secondary" className="gap-1.5 font-mono text-[11px] tracking-widest uppercase">
      {handle}
      {skill.name}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${skill.name}`}
        className="-mr-0.5 inline-flex cursor-pointer items-center text-secondary-foreground/60 transition-colors hover:text-destructive"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} />
      </button>
    </Badge>
  );
}

function PendingChip({ skill, onCancel }: { skill: ProfileSkill; onCancel: () => void }) {
  return (
    <Badge variant="warning" className="gap-1.5 font-mono text-[11px] tracking-widest uppercase">
      <HugeiconsIcon icon={HourglassIcon} size={10} />
      {skill.name}
      <button
        type="button"
        onClick={onCancel}
        aria-label={`Cancel ${skill.name} request`}
        className="-mr-0.5 inline-flex cursor-pointer items-center text-warning-foreground/70 transition-colors hover:text-destructive"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} />
      </button>
    </Badge>
  );
}

function SkillSearch({
  takenNames,
  onAdd,
  onRequest,
}: {
  /** Lowercased names already active or pending for this profile —
   * excluded from the add list so picking one twice isn't possible. */
  takenNames: Set<string>;
  onAdd: (skillId: number) => void;
  onRequest: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounced = useDebouncedValue(search, 250);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const { data: results } = useQuery({
    ...orpc.listSkills.queryOptions({ input: { search: debounced || undefined } }),
    enabled: debounced.length > 0,
  });

  const trimmed = search.trim();
  const hasExact = results?.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  const addableResults = (results ?? []).filter((s) => !takenNames.has(s.name.toLowerCase()));

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onFocus={() => trimmed && setOpen(true)}
        placeholder="+ add skill"
        className="w-32 rounded-md border border-dashed border-muted-foreground/40 bg-transparent px-2 py-0.5 text-[11px] tracking-widest text-foreground placeholder:text-muted-foreground/60 focus:border-accent/60 focus:outline-none"
      />
      {open && trimmed ? (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-muted/60 bg-card shadow-lg">
          {addableResults.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => {
                onAdd(skill.id);
                setSearch("");
                setOpen(false);
              }}
              className="block w-full px-2 py-1.5 text-left text-[11px] tracking-widest text-foreground uppercase hover:bg-accent/10 hover:text-accent"
            >
              {skill.name}
              {skill.category ? (
                <span className="ml-1 text-muted-foreground">({skill.category})</span>
              ) : null}
            </button>
          ))}
          {!hasExact ? (
            <button
              type="button"
              onClick={() => {
                onRequest(trimmed);
                setSearch("");
                setOpen(false);
              }}
              className="block w-full border-t border-muted/30 px-2 py-1.5 text-left text-[11px] tracking-widest text-warning uppercase hover:bg-warning/10"
            >
              REQUEST &apos;{trimmed}&apos;
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// The AVAILABILITY selects speak the shared vocabularies: wire keys match
// the oRPC `updateProfile` enum schema, labels are the one display
// spelling every surface uses.
const COMMITMENT_OPTIONS = AVAILABILITY_OPTIONS;
const RATE_OPTIONS: { value: "hourly" | "fixed" | "negotiable"; label: string }[] = (
  ["hourly", "fixed", "negotiable"] as const
).map((value) => ({ value, label: compensationLabel(value) }));
// The collab board's people lane *is* the availability listing — there
// is no "I'm available" post type, because a post goes stale the moment
// its author finds work and a profile flag doesn't. These two carry
// what such a post would have said, and both are people-lane filters.
const COLLAB_PREFERENCE_OPTIONS: { value: "paid" | "hobby" | "either"; label: string }[] = [
  { value: "paid", label: "Paid work" },
  { value: "hobby", label: "Hobby projects" },
  { value: "either", label: "Either" },
];

/** Mirrors `MAX_RATE` in the profile router. */
const MAX_RATE = 1_000_000;

/** Select for an optional field: the menu carries an explicit way back to unset. */
function OptionalSelect<T extends string>({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string | null;
  options: { value: T; label: string }[];
  placeholder: string;
  onChange: (next: T | null) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(typeof v === "string" ? (v as T) : null)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder}>
          {value ? (options.find((o) => o.value === value)?.label ?? value) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={null} className="text-muted-foreground">
          Not set
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** What's wrong with the pair on screen, in the words the field shows. */
function rateProblem(min: number | null, max: number | null): string | null {
  const amounts = [min, max].filter((n): n is number => n != null);
  if (amounts.some((n) => n < 0)) return "Rates can't be negative.";
  if (amounts.some((n) => !Number.isInteger(n))) return "Whole numbers only.";
  if (amounts.some((n) => n > MAX_RATE)) return "Rates cap out at 1,000,000.";
  if (min != null && max != null && max < min) return "Maximum can't be below the minimum.";
  return null;
}

function AvailabilityStep({ profile, queryKey, save }: StepProps) {
  const update = useUpdateProfile(queryKey, save);
  // Same writer as the hero card and the header's quick toggle, so all three
  // agree the moment any one of them is flipped. Reports into this flyout's
  // save indicator rather than a toast, like every other field here.
  const availability = useAvailabilityToggle({
    initial: profile.availability.state === "open",
    queryKey,
    onStatus: save.setStatus,
    notify: false,
  });
  const open = availability.available;
  // Selects are always controlled — `null` means "no selection" so
  // base-ui doesn't flip between uncontrolled/controlled when the
  // user picks a value (which was triggering the React DevTools
  // warning we saw).
  const [commitment, setCommitment] = useState<string | null>(profile.availability.commitment);
  const [rateType, setRateType] = useState<string | null>(profile.availability.rateType);
  const [rateMin, setRateMin] = useState<string>(
    profile.availability.rateMin != null ? String(profile.availability.rateMin) : "",
  );
  const [rateMax, setRateMax] = useState<string>(
    profile.availability.rateMax != null ? String(profile.availability.rateMax) : "",
  );
  const lookingFor = useAutosavedField(profile.availability.lookingFor ?? "", (value) =>
    update.mutateAsync({ lookingFor: value.trim() || null }),
  );
  const [collabPreference, setCollabPreference] = useState<string | null>(
    profile.availability.collabPreference,
  );
  const [currency, setCurrency] = useState<Currency>(
    normalizeCurrency(profile.availability.currency),
  );
  const [rateError, setRateError] = useState<string | null>(null);

  // Both bounds go in one save. Undebounced, typing `10000000` was eight
  // POSTs, eight profile refetches and eight persisted half-numbers; sending
  // the pair together is also the only way the server sees it as a pair.
  const debouncedSaveRate = useDebouncedCallback((minText: string, maxText: string) => {
    const min = minText ? Number(minText) : null;
    const max = maxText ? Number(maxText) : null;
    const problem = rateProblem(min, max);
    setRateError(problem);
    if (problem) return;
    update.mutate({ rateMin: min, rateMax: max });
  });

  return (
    <StepFrame title="AVAILABILITY">
      <FieldRow label="OPEN TO HIRE" hint="show the green chip on your profile">
        <div className="flex items-center gap-3">
          <Switch
            checked={open}
            disabled={availability.isPending}
            onCheckedChange={availability.setAvailable}
          />
          <Text size="sm" variant="muted">
            {open ? "Visible — you'll get inbound requests." : "Hidden from the directory."}
          </Text>
        </div>
      </FieldRow>
      <FieldRow label="COMMITMENT">
        <OptionalSelect
          value={commitment}
          options={COMMITMENT_OPTIONS}
          placeholder="— select —"
          onChange={(next) => {
            setCommitment(next);
            update.mutate({ availability: next });
          }}
        />
      </FieldRow>
      <FieldRow label="RATE" error={rateError}>
        <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,7rem)_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <OptionalSelect
            value={rateType}
            options={RATE_OPTIONS}
            placeholder="type"
            onChange={(next) => {
              setRateType(next);
              update.mutate({ rateType: next });
            }}
          />
          {/* Display only — nothing here or anywhere else converts. */}
          <Select
            value={currency}
            onValueChange={(v) => {
              if (typeof v !== "string") return;
              setCurrency(v as Currency);
              update.mutate({ currency: v as Currency });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            max={MAX_RATE}
            placeholder="min"
            value={rateMin}
            onChange={(e) => {
              const v = e.target.value;
              setRateMin(v);
              debouncedSaveRate(v, rateMax);
            }}
          />
          <Text variant="muted">–</Text>
          <Input
            type="number"
            min={0}
            max={MAX_RATE}
            placeholder="max"
            value={rateMax}
            onChange={(e) => {
              const v = e.target.value;
              setRateMax(v);
              debouncedSaveRate(rateMin, v);
            }}
          />
        </div>
      </FieldRow>
      <FieldRow label="OPEN TO" hint="filters you into the collab board's people lane">
        <OptionalSelect
          value={collabPreference}
          options={COLLAB_PREFERENCE_OPTIONS}
          placeholder="— select —"
          onChange={(next) => {
            setCollabPreference(next);
            update.mutate({ collabPreference: next });
          }}
        />
      </FieldRow>
      <FieldRow label="LOOKING FOR" hint="one line, shown on your directory card">
        <Input
          value={lookingFor.value}
          maxLength={280}
          placeholder="e.g. Small jam teams that need a composer"
          onChange={(e) => lookingFor.onChange(e.target.value)}
          onBlur={lookingFor.onBlur}
        />
      </FieldRow>
    </StepFrame>
  );
}

function LinksStep({ profile, queryKey, save }: StepProps) {
  const update = useUpdateProfile(queryKey, save);
  const [linking, setLinking] = useState<"github" | "itchio" | null>(null);
  const githubUrl = useAutosavedField(profile.socialUrls.githubUrl ?? "", (value) =>
    update.mutateAsync({ githubUrl: value.trim() || null }),
  );
  const twitterUrl = useAutosavedField(profile.socialUrls.twitterUrl ?? "", (value) =>
    update.mutateAsync({ twitterUrl: value.trim() || null }),
  );
  const websiteUrl = useAutosavedField(profile.socialUrls.websiteUrl ?? "", (value) =>
    update.mutateAsync({ websiteUrl: value.trim() || null }),
  );
  const [websiteLabel, setWebsiteLabel] = useState<WebsiteLinkType>(
    (profile.socialUrls.websiteLabel as WebsiteLinkType | null) ?? DEFAULT_WEBSITE_LINK_TYPE,
  );
  return (
    <StepFrame title="LINKS">
      <Text size="sm" variant="muted">
        Connect provider accounts so they appear in the LINKED section. OAuth flows hand off to the
        provider — you'll come back here when they finish.
      </Text>
      <div className="flex flex-col gap-3">
        <ProviderConnectButton
          icon={<HugeiconsIcon icon={GithubIcon} size={14} />}
          label="GitHub"
          connectedTo={profile.links.find((l) => l.label === "GITHUB")?.display}
          loading={linking === "github"}
          onClick={async () => {
            setLinking("github");
            save.setStatus("saving");
            try {
              await startGitHubLink();
              save.setStatus("saved");
            } catch (err) {
              reportMutationError(err, "profile.link_github");
              save.setStatus("error");
            } finally {
              setLinking(null);
            }
          }}
        />
        <ProviderConnectButton
          icon={
            <span
              aria-hidden
              className="inline-flex h-3.5 w-3.5 items-center justify-center font-bold"
            >
              ⌑
            </span>
          }
          label="itch.io"
          connectedTo={profile.links.find((l) => l.label === "ITCHIO")?.display}
          needsReconnect={profile.links.find((l) => l.label === "ITCHIO")?.needsReconnect}
          loading={linking === "itchio"}
          onClick={() => {
            setLinking("itchio");
            try {
              startItchOAuth();
            } finally {
              setLinking(null);
            }
          }}
        />
      </div>
      <Text size="sm" variant="muted">
        Plain URLs show in the LINKED section when the matching provider isn't connected.
      </Text>
      <FieldRow label="GITHUB URL">
        <Input
          value={githubUrl.value}
          onChange={(e) => githubUrl.onChange(e.target.value)}
          onBlur={githubUrl.onBlur}
          placeholder="https://github.com/you"
        />
      </FieldRow>
      <FieldRow label="TWITTER / X URL">
        <Input
          value={twitterUrl.value}
          onChange={(e) => twitterUrl.onChange(e.target.value)}
          onBlur={twitterUrl.onBlur}
          placeholder="https://x.com/you"
        />
      </FieldRow>
      <FieldRow label="YOUR OWN SITE" hint="the type is what the LINKED row is labelled">
        <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-2">
          <Select
            value={websiteLabel}
            onValueChange={(v) => {
              if (typeof v !== "string") return;
              const next = v as WebsiteLinkType;
              setWebsiteLabel(next);
              update.mutate({ websiteLabel: next });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEBSITE_LINK_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={websiteUrl.value}
            onChange={(e) => websiteUrl.onChange(e.target.value)}
            onBlur={websiteUrl.onBlur}
            placeholder="https://yoursite.dev"
          />
        </div>
      </FieldRow>
    </StepFrame>
  );
}

function ProviderConnectButton({
  icon,
  label,
  connectedTo,
  needsReconnect,
  loading,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  connectedTo: string | undefined | null;
  /** The provider revoked our stored token — escalate the RECONNECT state. */
  needsReconnect?: boolean;
  loading: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Well className="flex flex-row items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-muted/40 text-warning">
          {icon}
        </div>
        <div className="flex min-w-0 flex-col">
          <Text size="xs" variant="muted" className="tracking-widest">
            {label.toUpperCase()}
          </Text>
          <Text size="sm" className={needsReconnect ? "truncate text-warning" : "truncate"}>
            {needsReconnect
              ? "Connection expired — reconnect to keep your games in sync"
              : (connectedTo ?? "Not connected")}
          </Text>
        </div>
      </div>
      <Button
        variant={needsReconnect ? "destructive" : connectedTo ? "outline" : "default"}
        size="sm"
        onClick={onClick}
        disabled={disabled || loading}
        className="tracking-widest"
      >
        {loading ? <Spinner className="size-3" /> : connectedTo ? "RECONNECT" : "CONNECT"}
      </Button>
    </Well>
  );
}

// ── Reusable form chrome ───────────────────────────────────────────

function StepFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <Heading as="h3" className="text-sm tracking-widest text-foreground uppercase">
        {title}
      </Heading>
      {children}
    </div>
  );
}

function FieldRow({
  label,
  hint,
  error,
  action,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        {/* The label holds its line; the hint is what gives way, so a long
            one wraps on the right instead of breaking "NAME GLOW" in two. */}
        <Label className="shrink-0 text-[11px] tracking-widest whitespace-nowrap text-muted-foreground uppercase">
          {label}
        </Label>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {hint ? (
            <Text
              size="xs"
              variant="muted"
              className="min-w-0 text-right tracking-wide text-balance"
            >
              {hint}
            </Text>
          ) : null}
          {action}
        </div>
      </div>
      {children}
      {error ? (
        <Text size="xs" variant="danger" className="tracking-wide">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────

type CachedProfile = Awaited<ReturnType<typeof client.getProfile>>;

/**
 * Seed the `getProfile` cache with the server's own answer, then invalidate.
 *
 * Invalidating alone left the page showing roles the user had just removed:
 * the refetch goes to the public, edge-cached mount, and when the
 * recent-write bypass misses it answers `304` with the pre-write body. The
 * mutation already knows the resulting set, so the writer's own screen
 * doesn't have to take the network's word for it. Only the exact key is
 * written — the owner overlay nests one level deeper and still refetches.
 */
function useSeedProfile(queryKey: readonly unknown[] | undefined) {
  const qc = useQueryClient();
  return (patch: Partial<NonNullable<CachedProfile>>) => {
    if (!queryKey) return;
    qc.setQueryData(queryKey, (prev: CachedProfile) => (prev ? { ...prev, ...patch } : prev));
    void qc.invalidateQueries({ queryKey });
  };
}

function useUpdateProfile(queryKey: readonly unknown[] | undefined, save: SaveContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof client.updateProfile>[0]) => client.updateProfile(input),
    onMutate: () => save.setStatus("saving"),
    onSuccess: () => {
      save.setStatus("saved");
      if (queryKey) void qc.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      reportMutationError(err, "profile.autosave");
      save.setStatus("error");
    },
  });
}

/**
 * Follow a stub change in the address bar. The route is keyed on the stub,
 * so a new claim strands whoever came in by the old one — a profile reached
 * by raw id keeps routing either way.
 */
function useFollowStub() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  return (previous: string, next: string) => {
    if (!previous || params.userId !== previous) return;
    void navigate({ to: "/profile/$userId", params: { userId: next }, replace: true });
  };
}

function useSetUrlStub(queryKey: readonly unknown[] | undefined, save: SaveContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { stub: string }) => client.setUrlStub(input),
    onMutate: () => save.setStatus("saving"),
    onSuccess: () => {
      save.setStatus("saved");
      if (queryKey) void qc.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      reportMutationError(err, "profile.save_url_stub");
      save.setStatus("error");
    },
  });
}

function useClearUrlStub(queryKey: readonly unknown[] | undefined, save: SaveContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.clearUrlStub(),
    onMutate: () => save.setStatus("saving"),
    onSuccess: () => {
      save.setStatus("saved");
      if (queryKey) void qc.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      reportMutationError(err, "profile.clear_url_stub");
      save.setStatus("error");
    },
  });
}
