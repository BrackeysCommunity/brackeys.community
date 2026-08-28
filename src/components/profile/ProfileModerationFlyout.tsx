import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useState } from "react";

import { Field, MarkdownField, ModerationShell } from "@/components/moderation/ModerationShell";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { authStore } from "@/lib/auth-store";
import { errorMessage } from "@/lib/error-message";
import { reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

import type { ProfileViewModel } from "./ProfilePage/helpers";

const PROPOSAL_FILED = "Proposal filed — an admin will review.";
const APPLIED = "Applied.";

/**
 * MODERATE affordance for the profile hero. Renders nothing for
 * non-staff viewers (and while the staff check loads); staff get the
 * button plus the flyout. Kept together so the hero only mounts one
 * component and the staff query never runs for regular visitors' pages.
 */
export function ProfileModerateButton({
  profile,
  queryKey,
}: {
  profile: ProfileViewModel;
  queryKey?: readonly unknown[];
}) {
  const { session } = useStore(authStore);
  const [open, setOpen] = useState(false);

  const { data: staff } = useQuery({
    queryKey: ["getStaffStatus"],
    queryFn: () => client.getStaffStatus(),
    enabled: session?.user?.id != null,
  });

  if (!staff?.isStaff) return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <span className="tracking-widest">MODERATE</span>
      </Button>
      <ProfileModerationFlyout
        open={open}
        onClose={() => setOpen(false)}
        profile={profile}
        isAdmin={staff.isAdmin}
        queryKey={queryKey}
      />
    </>
  );
}

type ProfilePatch = {
  bio?: string | null;
  tagline?: string | null;
  lookingFor?: string | null;
  location?: string | null;
  githubUrl?: string | null;
  twitterUrl?: string | null;
  websiteUrl?: string | null;
};

/**
 * Staff moderation surface for someone else's profile. Mods file
 * proposals (an admin reviews and applies); admins may apply directly.
 * The server refuses actions against admins' profiles and your own —
 * those errors surface as toasts.
 */
export function ProfileModerationFlyout({
  open,
  onClose,
  profile,
  isAdmin,
  queryKey,
}: {
  open: boolean;
  onClose: () => void;
  profile: ProfileViewModel;
  isAdmin: boolean;
  queryKey?: readonly unknown[];
}) {
  const qc = useQueryClient();
  const invalidate = () => {
    if (queryKey) void qc.invalidateQueries({ queryKey });
  };

  return (
    <ModerationShell
      open={open}
      onClose={onClose}
      title={`Moderate @${profile.handle}`}
      description="Staff moderation actions for this profile."
      tabs={[
        {
          key: "content",
          label: "CONTENT",
          content: <ContentSection profile={profile} isAdmin={isAdmin} onChanged={invalidate} />,
        },
        {
          key: "handle",
          label: "HANDLE",
          content: <HandleSection profile={profile} isAdmin={isAdmin} onChanged={invalidate} />,
        },
      ]}
    />
  );
}

function ContentSection({
  profile,
  isAdmin,
  onChanged,
}: {
  profile: ProfileViewModel;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const current = {
    bio: profile.bio ?? "",
    tagline: profile.tag ?? "",
    lookingFor: profile.availability.lookingFor ?? "",
    location: profile.location ?? "",
    githubUrl: profile.socialUrls.githubUrl ?? "",
    twitterUrl: profile.socialUrls.twitterUrl ?? "",
    websiteUrl: profile.socialUrls.websiteUrl ?? "",
  };
  const [values, setValues] = useState(current);
  const [reason, setReason] = useState("");
  const set = (key: keyof typeof current) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const patch: ProfilePatch = {};
  for (const key of Object.keys(current) as (keyof typeof current)[]) {
    if (values[key].trim() !== current[key]) patch[key] = values[key].trim() || null;
  }
  const ready = Object.keys(patch).length > 0 && reason.trim().length > 0;

  const propose = useMutation({
    mutationFn: () =>
      client.proposeModerationEdit({
        action: "profile_update",
        targetId: profile.profileId,
        payload: patch,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(PROPOSAL_FILED);
      setReason("");
    },
    onError: (err) => {
      reportMutationError(err, "moderation.profile_update_propose");
      toast.error(errorMessage(err));
    },
  });
  const apply = useMutation({
    mutationFn: () =>
      client.staffUpdateProfile({ userId: profile.profileId, reason: reason.trim(), ...patch }),
    onSuccess: () => {
      toast.success(APPLIED);
      setReason("");
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.profile_update_apply");
      toast.error(errorMessage(err));
    },
  });
  const pending = propose.isPending || apply.isPending;

  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="TAGLINE">
          <Input value={values.tagline} onChange={set("tagline")} />
        </Field>
        <Field label="LOCATION">
          <Input value={values.location} onChange={set("location")} maxLength={100} />
        </Field>
        <MarkdownField
          label="BIO"
          className="sm:col-span-2"
          value={values.bio}
          onChange={(bio) => setValues((v) => ({ ...v, bio }))}
        />
        <Field label="LOOKING FOR" className="sm:col-span-2">
          <Input value={values.lookingFor} onChange={set("lookingFor")} maxLength={280} />
        </Field>
        <Field label="GITHUB">
          <Input value={values.githubUrl} onChange={set("githubUrl")} placeholder="https://…" />
        </Field>
        <Field label="TWITTER">
          <Input value={values.twitterUrl} onChange={set("twitterUrl")} placeholder="https://…" />
        </Field>
        <Field label="WEBSITE">
          <Input value={values.websiteUrl} onChange={set("websiteUrl")} placeholder="https://…" />
        </Field>
      </div>
      <Field label="REASON" hint="shown to the member">
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Required"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <Button size="sm" disabled={!ready || pending} onClick={() => apply.mutate()}>
            APPLY NOW
          </Button>
        ) : null}
        <Button
          variant={isAdmin ? "outline" : "default"}
          size="sm"
          disabled={!ready || pending}
          onClick={() => propose.mutate()}
        >
          FILE PROPOSAL
        </Button>
      </div>
    </section>
  );
}

function HandleSection({
  profile,
  isAdmin,
  onChanged,
}: {
  profile: ProfileViewModel;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const ready = reason.trim().length > 0;

  const mutation = useMutation({
    mutationFn: async () => {
      if (isAdmin) {
        await client.staffResetUrlStub({ userId: profile.profileId, reason: reason.trim() });
      } else {
        await client.proposeModerationEdit({
          action: "profile_stub_reset",
          targetId: profile.profileId,
          payload: {},
          reason: reason.trim(),
        });
      }
    },
    onSuccess: () => {
      toast.success(isAdmin ? APPLIED : PROPOSAL_FILED);
      setReason("");
      if (isAdmin) onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.profile_stub_reset");
      toast.error(errorMessage(err));
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <Field label="REASON" hint={`currently @${profile.handle}`}>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Required"
        />
      </Field>
      <div>
        <Confirm
          variant="destructive"
          title="Reset this member's handle?"
          message={
            isAdmin
              ? "Their claimed URL stub is released immediately; links fall back to their id."
              : "Files a proposal — an admin applies the reset."
          }
          confirmText={isAdmin ? "RESET" : "FILE PROPOSAL"}
          onConfirm={() => mutation.mutateAsync()}
        >
          <Button variant="outline" size="sm" disabled={!ready || mutation.isPending}>
            RESET HANDLE
          </Button>
        </Confirm>
      </div>
    </section>
  );
}
