import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  Field,
  MarkdownField,
  ModerationShell,
  ReasonField,
} from "@/components/moderation/ModerationShell";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { errorMessage } from "@/lib/error-message";
import { reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client } from "@/orpc/client";

import type { RpcTeam, TeamMember } from "./TeamPage";

const PROPOSAL_FILED = "Proposal filed — an admin will review.";
const APPLIED = "Applied.";

/**
 * Staff-only surface on a team page. Mods file proposals for content
 * edits (an admin reviews and applies); admins may also apply directly.
 * Hide/unhide is staff-direct, delete is admin-only. Every action here
 * requires a reason and lands in the moderation log.
 */
export function TeamModerationFlyout({
  open,
  onClose,
  team,
  onInvalidate,
}: {
  open: boolean;
  onClose: () => void;
  team: RpcTeam;
  onInvalidate: () => void;
}) {
  const { data: staff } = useQuery({
    queryKey: ["getStaffStatus"],
    queryFn: () => client.getStaffStatus(),
  });
  const isAdmin = staff?.isAdmin ?? false;

  return (
    <ModerationShell
      open={open}
      onClose={onClose}
      title={`Moderate ${team.name}`}
      description="Staff moderation actions for this team."
      tabs={[
        {
          key: "visibility",
          label: "VISIBILITY",
          content: <VisibilitySection team={team} onChanged={onInvalidate} />,
        },
        {
          key: "content",
          label: "CONTENT",
          content: <ContentSection team={team} isAdmin={isAdmin} onChanged={onInvalidate} />,
        },
        {
          key: "handle",
          label: "HANDLE",
          content: <HandleSection team={team} isAdmin={isAdmin} onChanged={onInvalidate} />,
        },
        {
          key: "images",
          label: "IMAGES",
          content: <ImagesSection team={team} isAdmin={isAdmin} onChanged={onInvalidate} />,
        },
        {
          key: "roster",
          label: "ROSTER",
          content: <RosterSection team={team} isAdmin={isAdmin} onChanged={onInvalidate} />,
        },
        ...(isAdmin
          ? [
              {
                key: "delete",
                label: "DELETE",
                content: <DeleteSection team={team} onGone={onClose} />,
              },
            ]
          : []),
      ]}
    />
  );
}

// ── Visibility (staff-direct) ────────────────────────────────────────────────

function VisibilitySection({ team, onChanged }: { team: RpcTeam; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const isHidden = team.hiddenAt != null;

  const mutation = useMutation({
    mutationFn: (hidden: boolean) =>
      client.setTeamHidden({
        teamId: team.id,
        hidden,
        reason: reason.trim() || undefined,
      }),
    onSuccess: (_data, hidden) => {
      toast.success(hidden ? "Team hidden from the public." : "Team is public again.");
      setReason("");
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_hide");
      toast.error(errorMessage(err));
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <Text size="xs" variant="muted" className="tracking-widest uppercase">
        {isHidden ? "Currently hidden — only members and staff see the page." : "Currently public."}
      </Text>
      {isHidden ? (
        <div>
          <Confirm
            title="Unhide this team?"
            message="The page becomes public again and edits unlock."
            confirmText="UNHIDE"
            onConfirm={async () => {
              await mutation.mutateAsync(false);
            }}
          >
            <Button variant="outline" size="sm" disabled={mutation.isPending}>
              UNHIDE TEAM
            </Button>
          </Confirm>
        </div>
      ) : (
        <>
          <ReasonField value={reason} onChange={setReason} />
          <div>
            <Confirm
              variant="destructive"
              title="Hide this team?"
              message="Only members and staff will see the page, and member edits lock."
              confirmText="HIDE"
              onConfirm={async () => {
                await mutation.mutateAsync(true);
              }}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={reason.trim().length === 0 || mutation.isPending}
              >
                HIDE TEAM
              </Button>
            </Confirm>
          </div>
        </>
      )}
    </section>
  );
}

// ── Content edit (propose / admin apply) ─────────────────────────────────────

type TeamContentPatch = {
  name?: string;
  tagline?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  itchUrl?: string | null;
};

function ContentSection({
  team,
  isAdmin,
  onChanged,
}: {
  team: RpcTeam;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState(team.name);
  const [tagline, setTagline] = useState(team.tagline ?? "");
  const [bio, setBio] = useState(team.bio ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(team.websiteUrl ?? "");
  const [itchUrl, setItchUrl] = useState(team.itchUrl ?? "");
  const [reason, setReason] = useState("");

  const patch: TeamContentPatch = {};
  if (name.trim() !== team.name) patch.name = name.trim();
  if (tagline.trim() !== (team.tagline ?? "")) patch.tagline = tagline.trim() || null;
  if (bio.trim() !== (team.bio ?? "")) patch.bio = bio.trim() || null;
  if (websiteUrl.trim() !== (team.websiteUrl ?? "")) patch.websiteUrl = websiteUrl.trim() || null;
  if (itchUrl.trim() !== (team.itchUrl ?? "")) patch.itchUrl = itchUrl.trim() || null;
  const hasChanges = Object.keys(patch).length > 0;
  const ready = hasChanges && name.trim().length >= 2 && reason.trim().length > 0;

  const propose = useMutation({
    mutationFn: () =>
      client.proposeModerationEdit({
        action: "team_update",
        targetId: team.id,
        payload: patch,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(PROPOSAL_FILED);
      setReason("");
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_update_propose");
      toast.error(errorMessage(err));
    },
  });
  const apply = useMutation({
    mutationFn: () => client.updateTeam({ teamId: team.id, reason: reason.trim(), ...patch }),
    onSuccess: () => {
      toast.success(APPLIED);
      setReason("");
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_update_apply");
      toast.error(errorMessage(err));
    },
  });
  const pending = propose.isPending || apply.isPending;

  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="NAME">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        <Field label="TAGLINE">
          <Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={200} />
        </Field>
        <MarkdownField
          label="BIO"
          className="sm:col-span-2"
          value={bio}
          onChange={setBio}
          maxLength={5000}
        />
        <Field label="WEBSITE">
          <Input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://…"
          />
        </Field>
        <Field label="ITCH.IO">
          <Input
            value={itchUrl}
            onChange={(e) => setItchUrl(e.target.value)}
            placeholder="https://team.itch.io"
          />
        </Field>
      </div>
      <ReasonField value={reason} onChange={setReason} />
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

// ── Handle (propose / admin apply) ───────────────────────────────────────────

function HandleSection({
  team,
  isAdmin,
  onChanged,
}: {
  team: RpcTeam;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [slug, setSlug] = useState(team.slug);
  const [reason, setReason] = useState("");
  const next = slug.trim().toLowerCase();
  const ready = next.length >= 3 && next !== team.slug && reason.trim().length > 0;

  const propose = useMutation({
    mutationFn: () =>
      client.proposeModerationEdit({
        action: "team_slug",
        targetId: team.id,
        payload: { slug: next },
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(PROPOSAL_FILED);
      setReason("");
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_slug_propose");
      toast.error(errorMessage(err));
    },
  });
  const apply = useMutation({
    mutationFn: () => client.setTeamSlug({ teamId: team.id, slug: next, reason: reason.trim() }),
    onSuccess: () => {
      toast.success(APPLIED);
      setReason("");
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_slug_apply");
      toast.error(errorMessage(err));
    },
  });
  const pending = propose.isPending || apply.isPending;

  return (
    <section className="flex flex-col gap-3">
      <Field label="NEW HANDLE" hint={`currently /teams/${team.slug}`}>
        <Input
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          maxLength={32}
        />
      </Field>
      <ReasonField value={reason} onChange={setReason} />
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

// ── Images (propose / admin apply) ───────────────────────────────────────────

function ImagesSection({
  team,
  isAdmin,
  onChanged,
}: {
  team: RpcTeam;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");

  const propose = useMutation({
    mutationFn: (kind: "avatar" | "banner") =>
      client.proposeModerationEdit({
        action: "team_image_clear",
        targetId: team.id,
        payload: { kind },
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success(PROPOSAL_FILED);
      setReason("");
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_image_propose");
      toast.error(errorMessage(err));
    },
  });
  const apply = useMutation({
    mutationFn: (kind: "avatar" | "banner") =>
      client.clearTeamImage({ teamId: team.id, kind, reason: reason.trim() }),
    onSuccess: () => {
      toast.success(APPLIED);
      setReason("");
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_image_apply");
      toast.error(errorMessage(err));
    },
  });
  const pending = propose.isPending || apply.isPending;
  const ready = reason.trim().length > 0;

  const clearButton = (kind: "avatar" | "banner", present: boolean) => (
    <Confirm
      variant="destructive"
      title={`Clear the team ${kind}?`}
      message={
        isAdmin
          ? "The image is removed immediately."
          : "Files a proposal — an admin applies the removal."
      }
      confirmText={isAdmin ? "CLEAR" : "FILE PROPOSAL"}
      onConfirm={async () => {
        await (isAdmin ? apply.mutateAsync(kind) : propose.mutateAsync(kind));
      }}
    >
      <Button variant="outline" size="sm" disabled={!present || !ready || pending}>
        CLEAR {kind.toUpperCase()}
      </Button>
    </Confirm>
  );

  return (
    <section className="flex flex-col gap-3">
      <ReasonField value={reason} onChange={setReason} />
      <div className="flex flex-wrap items-center gap-2">
        {clearButton("avatar", team.avatarUrl != null)}
        {clearButton("banner", team.bannerUrl != null)}
      </div>
    </section>
  );
}

// ── Roster (propose / admin apply) ───────────────────────────────────────────

function RosterSection({
  team,
  isAdmin,
  onChanged,
}: {
  team: RpcTeam;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState("");
  const ready = reason.trim().length > 0;

  return (
    <section className="flex flex-col gap-3">
      <ReasonField value={reason} onChange={setReason} hint="required for every roster action" />
      <div className="flex flex-col gap-2">
        {team.members.map((m) => (
          <MemberRow
            key={m.id}
            team={team}
            member={m}
            isAdmin={isAdmin}
            reason={reason.trim()}
            ready={ready}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  );
}

function MemberRow({
  team,
  member,
  isAdmin,
  reason,
  ready,
  onChanged,
}: {
  team: RpcTeam;
  member: TeamMember;
  isAdmin: boolean;
  reason: string;
  ready: boolean;
  onChanged: () => void;
}) {
  const isOwnerRow = member.role === "owner";
  const isSoleMember = team.members.length === 1;
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(member.title ?? "");

  const onProposed = () => toast.success(PROPOSAL_FILED);
  const onApplied = () => {
    toast.success(APPLIED);
    onChanged();
  };
  const onError = (scope: string) => (err: unknown) => {
    reportMutationError(err, scope);
    toast.error(errorMessage(err));
  };

  const remove = useMutation({
    mutationFn: async () => {
      if (isAdmin) {
        await client.removeMember({ teamId: team.id, userId: member.userId, reason });
      } else {
        await client.proposeModerationEdit({
          action: "team_member_remove",
          targetId: team.id,
          payload: { userId: member.userId },
          reason,
        });
      }
    },
    onSuccess: isAdmin ? onApplied : onProposed,
    onError: onError("moderation.team_member_remove"),
  });
  const transfer = useMutation({
    mutationFn: async () => {
      if (isAdmin) {
        await client.transferOwnership({ teamId: team.id, userId: member.userId, reason });
      } else {
        await client.proposeModerationEdit({
          action: "team_transfer",
          targetId: team.id,
          payload: { userId: member.userId },
          reason,
        });
      }
    },
    onSuccess: isAdmin ? onApplied : onProposed,
    onError: onError("moderation.team_transfer"),
  });
  const setMemberTitle = useMutation({
    mutationFn: async () => {
      const next = title.trim() || null;
      if (isAdmin) {
        await client.updateMemberTitle({
          teamId: team.id,
          memberId: member.id,
          title: next,
          reason,
        });
      } else {
        await client.proposeModerationEdit({
          action: "team_title_edit",
          targetId: team.id,
          payload: { memberId: member.id, title: next },
          reason,
        });
      }
    },
    onSuccess: () => {
      setEditingTitle(false);
      if (isAdmin) onApplied();
      else onProposed();
    },
    onError: onError("moderation.team_title_edit"),
  });
  const pending = remove.isPending || transfer.isPending || setMemberTitle.isPending;

  return (
    <Well variant="ghost" className="flex-col gap-2 p-2.5">
      <div className="flex items-center gap-3">
        <UserAvatar avatarUrl={member.avatarUrl} username={member.username} size={28} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Text as="span" size="sm" ellipsis>
            {member.username ?? "Unknown"}
          </Text>
          {isOwnerRow ? <MicroLabel>OWNER</MicroLabel> : null}
        </span>
        <Button
          variant="outline"
          size="xs"
          disabled={pending}
          onClick={() => setEditingTitle((v) => !v)}
        >
          EDIT TITLE
        </Button>
        {!isOwnerRow ? (
          <Confirm
            title={`Make ${member.username ?? "this member"} the owner?`}
            message={
              isAdmin
                ? "Ownership transfers immediately; the current owner becomes a member."
                : "Files a proposal — an admin applies the transfer."
            }
            confirmText={isAdmin ? "TRANSFER" : "FILE PROPOSAL"}
            onConfirm={() => transfer.mutateAsync()}
          >
            <Button variant="outline" size="xs" disabled={!ready || pending}>
              MAKE OWNER
            </Button>
          </Confirm>
        ) : null}
        <Confirm
          variant="destructive"
          title={`Remove ${member.username ?? "this member"} from the team?`}
          message={
            isAdmin
              ? "They are removed immediately and notified with your reason."
              : "Files a proposal — an admin applies the removal."
          }
          confirmText={isAdmin ? "REMOVE" : "FILE PROPOSAL"}
          onConfirm={() => remove.mutateAsync()}
        >
          <Button
            variant="outline"
            size="xs"
            disabled={isOwnerRow || !ready || pending}
            title={isOwnerRow && !isSoleMember ? "Transfer first" : undefined}
          >
            REMOVE
          </Button>
        </Confirm>
      </div>
      {isOwnerRow ? (
        <Text size="xs" variant="muted">
          {isSoleMember
            ? isAdmin
              ? "The sole member can't be removed — delete the team instead."
              : "The sole member can't be removed."
            : "The owner can't be removed — transfer first."}
        </Text>
      ) : null}
      {editingTitle ? (
        <div className="flex items-center gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="Roster title (blank to clear)"
          />
          <Confirm
            title="Change this roster title?"
            message={isAdmin ? "Applies immediately." : "Files a proposal for an admin to apply."}
            confirmText={isAdmin ? "SET" : "FILE PROPOSAL"}
            onConfirm={() => setMemberTitle.mutateAsync()}
          >
            <Button variant="outline" size="sm" disabled={!ready || pending}>
              SET
            </Button>
          </Confirm>
        </div>
      ) : null}
    </Well>
  );
}

// ── Delete (admin only) ──────────────────────────────────────────────────────

function DeleteSection({ team, onGone }: { team: RpcTeam; onGone: () => void }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const [armed, setArmed] = useState(false);

  const mutation = useMutation({
    mutationFn: () => client.deleteTeam({ teamId: team.id, reason: reason.trim() }),
    onSuccess: () => {
      toast.success("Team deleted.");
      onGone();
      void navigate({ to: "/teams" });
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_delete");
      toast.error(errorMessage(err));
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <ReasonField value={reason} onChange={setReason} />
      <div className="flex flex-wrap items-center gap-2">
        {armed ? (
          <>
            <Confirm
              variant="destructive"
              title="Delete this team?"
              message="The page goes away; posts stay on the board, unlinked. This can't be undone."
              confirmText="DELETE TEAM"
              onConfirm={async () => {
                await mutation.mutateAsync();
              }}
            >
              <Button
                variant="destructive"
                size="sm"
                disabled={reason.trim().length === 0 || mutation.isPending}
              >
                REALLY DELETE
              </Button>
            </Confirm>
            <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
              CANCEL
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={reason.trim().length === 0}
            onClick={() => setArmed(true)}
          >
            DELETE TEAM
          </Button>
        )}
      </div>
    </section>
  );
}
