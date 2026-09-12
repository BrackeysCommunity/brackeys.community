import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { uploadTeamAvatarImage } from "@/components/collab/CollabCreateFlyout/shared";
import {
  Field,
  MarkdownField,
  ModerationShell,
  ReasonField,
} from "@/components/moderation/ModerationShell";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { errorMessage } from "@/lib/error-message";
import { itchImageUrl } from "@/lib/itch-image";
import { reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

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
  recruiting?: boolean;
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
  const [recruiting, setRecruiting] = useState(team.recruiting);
  const [reason, setReason] = useState("");

  const patch: TeamContentPatch = {};
  if (name.trim() !== team.name) patch.name = name.trim();
  if (tagline.trim() !== (team.tagline ?? "")) patch.tagline = tagline.trim() || null;
  if (bio.trim() !== (team.bio ?? "")) patch.bio = bio.trim() || null;
  if (websiteUrl.trim() !== (team.websiteUrl ?? "")) patch.websiteUrl = websiteUrl.trim() || null;
  if (itchUrl.trim() !== (team.itchUrl ?? "")) patch.itchUrl = itchUrl.trim() || null;
  if (recruiting !== team.recruiting) patch.recruiting = recruiting;
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
      <div className="flex items-center gap-3">
        <Switch
          id="mod-team-recruiting"
          checked={recruiting}
          disabled={pending}
          onCheckedChange={(checked) => setRecruiting(!!checked)}
        />
        <Label htmlFor="mod-team-recruiting" className="text-sm text-muted-foreground">
          Recruiting — the badge shows while the team has an opening posted.
        </Label>
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

// ── Reason-collecting confirm ───────────────────────────────────────────────

/**
 * The confirm for every one-shot action on the IMAGES and ROSTER tabs. The
 * reason lives here, in the dialog, rather than in a field above the list:
 * a tester who clicks REMOVE first and reads second should meet the
 * requirement at the moment it applies, not find a disabled button. Confirm
 * stays disabled until something is typed, and the field is cleared on
 * close so a reason never carries over to the next action.
 */
function ActionConfirm({
  title,
  message,
  confirmText,
  variant,
  onConfirm,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  message: string;
  confirmText: string;
  variant?: "default" | "destructive";
  onConfirm: (reason: string) => Promise<unknown>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactElement;
}) {
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  return (
    <Confirm
      variant={variant}
      title={title}
      confirmText={confirmText}
      confirmDisabled={trimmed.length === 0}
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange?.(next);
      }}
      onConfirm={async () => {
        await onConfirm(trimmed);
        setReason("");
      }}
      message={
        <>
          <p>{message}</p>
          <ReasonField value={reason} onChange={setReason} />
        </>
      }
    >
      {children}
    </Confirm>
  );
}

// ── Images (propose / admin apply) ───────────────────────────────────────────

type ImageKind = "avatar" | "banner";

const MAX_TEAM_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Clear or replace either image. A replacement is two steps on purpose:
 * the file goes up through the member upload route (minted, scanned, but
 * left unattached), then the attach rides the same propose/apply split as
 * everything else here — so a mod's replacement waits on an admin, and the
 * audit row names the object that went live.
 */
function ImagesSection({
  team,
  isAdmin,
  onChanged,
}: {
  team: RpcTeam;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [picked, setPicked] = useState<{ kind: ImageKind; file: File } | null>(null);

  const clear = useMutation({
    mutationFn: async ({ kind, reason }: { kind: ImageKind; reason: string }) => {
      if (isAdmin) {
        await client.clearTeamImage({ teamId: team.id, kind, reason });
      } else {
        await client.proposeModerationEdit({
          action: "team_image_clear",
          targetId: team.id,
          payload: { kind },
          reason,
        });
      }
    },
    onSuccess: () => {
      toast.success(isAdmin ? APPLIED : PROPOSAL_FILED);
      if (isAdmin) onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_image_clear");
      toast.error(errorMessage(err));
    },
  });
  const replace = useMutation({
    mutationFn: async ({ kind, file, reason }: { kind: ImageKind; file: File; reason: string }) => {
      const uploaded = await uploadTeamAvatarImage(team.id, file, kind);
      if (isAdmin) {
        await client.setTeamImage({ teamId: team.id, kind, key: uploaded.key, reason });
      } else {
        await client.proposeModerationEdit({
          action: "team_image_set",
          targetId: team.id,
          payload: { kind, key: uploaded.key },
          reason,
        });
      }
    },
    onSuccess: () => {
      toast.success(isAdmin ? APPLIED : PROPOSAL_FILED);
      setPicked(null);
      if (isAdmin) onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_image_set");
      toast.error(errorMessage(err));
    },
  });
  const pending = clear.isPending || replace.isPending;

  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(["avatar", "banner"] as const).map((kind) => {
          const current = kind === "avatar" ? team.avatarUrl : team.bannerUrl;
          return (
            <Field key={kind} label={kind.toUpperCase()}>
              <div className="flex flex-col gap-2">
                <ImagePreview kind={kind} url={current} teamName={team.name} />
                <div className="flex flex-wrap items-center gap-2">
                  <ImagePicker
                    label={current ? "REPLACE" : "SET"}
                    disabled={pending}
                    onPick={(file) => setPicked({ kind, file })}
                  />
                  <ActionConfirm
                    variant="destructive"
                    title={`Clear the team ${kind}?`}
                    message={
                      isAdmin
                        ? "The image is removed immediately and the owner is told why."
                        : "Files a proposal — an admin applies the removal."
                    }
                    confirmText={isAdmin ? "CLEAR" : "FILE PROPOSAL"}
                    onConfirm={(reason) => clear.mutateAsync({ kind, reason })}
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!current || pending}
                      title={current ? undefined : `No ${kind} set`}
                    >
                      CLEAR
                    </Button>
                  </ActionConfirm>
                </div>
              </div>
            </Field>
          );
        })}
      </div>
      {/* Raised by the file pick: the upload only starts once the reason is
          in, so a cancelled dialog leaves nothing in the bucket. */}
      <ActionConfirm
        open={picked !== null}
        onOpenChange={(next) => {
          if (!next) setPicked(null);
        }}
        title={picked ? `Replace the team ${picked.kind} with ${picked.file.name}?` : ""}
        message={
          isAdmin
            ? "Uploads and goes live immediately; the owner is told why."
            : "Uploads now and goes live when an admin approves the proposal."
        }
        confirmText={isAdmin ? "REPLACE" : "FILE PROPOSAL"}
        onConfirm={(reason) =>
          picked ? replace.mutateAsync({ ...picked, reason }) : Promise.resolve()
        }
      />
    </section>
  );
}

function ImagePreview({
  kind,
  url,
  teamName,
}: {
  kind: ImageKind;
  url: string | null;
  teamName: string;
}) {
  if (kind === "avatar") return <UserAvatar avatarUrl={url} username={teamName} size={40} />;
  return (
    <div
      className="h-10 w-24 shrink-0 border border-muted/40 bg-muted/20 bg-cover bg-center"
      style={
        url
          ? { backgroundImage: `url("${encodeURI(itchImageUrl(url, { width: 192 }))}")` }
          : undefined
      }
      aria-label={url ? "Current banner" : "No banner set"}
    />
  );
}

/** A file button with the same client-side gate as the owner's picker. */
function ImagePicker({
  label,
  disabled,
  onPick,
}: {
  label: string;
  disabled: boolean;
  onPick: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        {label}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (!file.type.startsWith("image/")) {
            setError("Only image files are allowed.");
            return;
          }
          if (file.size > MAX_TEAM_IMAGE_BYTES) {
            setError("Image must be under 5MB.");
            return;
          }
          setError(null);
          onPick(file);
        }}
      />
      {error ? (
        <Text size="xs" className="basis-full text-destructive">
          {error}
        </Text>
      ) : null}
    </>
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
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {team.members.map((m) => (
          <MemberRow key={m.id} team={team} member={m} isAdmin={isAdmin} onChanged={onChanged} />
        ))}
      </div>
      {team.status === "active" ? (
        <AddMemberField team={team} isAdmin={isAdmin} onChanged={onChanged} />
      ) : null}
    </section>
  );
}

/**
 * The break-glass insert: no invite, no acceptance. The person is seated
 * the moment it applies and told that staff did it, which is why the
 * search is the staff lookup (it knows about bans) rather than the
 * member-facing one.
 */
function AddMemberField({
  team,
  isAdmin,
  onChanged,
}: {
  team: RpcTeam;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const term = search.trim();
  const { data } = useQuery({
    ...orpc.searchMembers.queryOptions({ input: { search: term, pageSize: 6 } }),
    enabled: term.length >= 2,
  });
  const memberIds = new Set(team.members.map((m) => m.userId));

  const add = useMutation({
    mutationFn: async ({ userId, reason }: { userId: string; reason: string }) => {
      const next = title.trim() || undefined;
      if (isAdmin) {
        await client.addMember({ teamId: team.id, userId, title: next, reason });
      } else {
        await client.proposeModerationEdit({
          action: "team_member_add",
          targetId: team.id,
          payload: { userId, ...(next ? { title: next } : {}) },
          reason,
        });
      }
    },
    onSuccess: () => {
      toast.success(isAdmin ? APPLIED : PROPOSAL_FILED);
      setSearch("");
      setTitle("");
      if (isAdmin) onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.team_member_add");
      toast.error(errorMessage(err));
    },
  });

  const candidates = (data?.results ?? []).filter((r) => !memberIds.has(r.id));

  return (
    <Field label="ADD MEMBER" hint="skips the invite — they're told staff placed them">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people…"
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Roster title (optional)"
        />
      </div>
      {term.length >= 2 ? (
        <div className="flex flex-col gap-1.5">
          {candidates.map((r) => (
            <Well key={r.id} variant="ghost" className="flex-row items-center gap-3 p-2">
              <UserAvatar avatarUrl={r.avatarUrl} username={r.handle} size={24} />
              <Text as="span" size="sm" ellipsis className="min-w-0 flex-1">
                {r.displayName}
              </Text>
              {r.isBanned ? (
                <MicroLabel>BANNED</MicroLabel>
              ) : (
                <ActionConfirm
                  title={`Add ${r.displayName} to ${team.name}?`}
                  message={
                    isAdmin
                      ? "They join immediately, without an invite, and are told staff placed them."
                      : "Files a proposal — an admin seats them, without an invite."
                  }
                  confirmText={isAdmin ? "ADD" : "FILE PROPOSAL"}
                  onConfirm={(reason) => add.mutateAsync({ userId: r.id, reason })}
                >
                  <Button variant="outline" size="xs" disabled={add.isPending}>
                    ADD
                  </Button>
                </ActionConfirm>
              )}
            </Well>
          ))}
          {data && candidates.length === 0 ? (
            <Text size="xs" variant="muted">
              Nobody matches.
            </Text>
          ) : null}
        </div>
      ) : null}
    </Field>
  );
}

type RowAction = "transfer" | "remove";

/**
 * One roster row: the person, then a single menu for everything staff can
 * do to them. The only blockers left are structural — the owner and the
 * sole member — and the row says which, since nothing on this panel
 * clears either.
 */
function MemberRow({
  team,
  member,
  isAdmin,
  onChanged,
}: {
  team: RpcTeam;
  member: TeamMember;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const isOwnerRow = member.role === "owner";
  const isSoleMember = team.members.length === 1;
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(member.title ?? "");
  const [confirming, setConfirming] = useState<RowAction | null>(null);
  const who = member.username ?? "this member";

  const removeBlocker = isOwnerRow
    ? isSoleMember
      ? isAdmin
        ? "The sole member can't be removed — delete the team instead."
        : "The sole member can't be removed."
      : "The owner can't be removed — transfer first."
    : null;
  const transferBlocker = isOwnerRow ? "Already the owner." : null;

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
    mutationFn: async (reason: string) => {
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
    mutationFn: async (reason: string) => {
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
    mutationFn: async (reason: string) => {
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
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <Text as="span" size="sm" ellipsis>
              {member.username ?? "Unknown"}
            </Text>
            {isOwnerRow ? <MicroLabel>OWNER</MicroLabel> : null}
            {member.title ? (
              <Text as="span" size="xs" variant="muted" ellipsis>
                {member.title}
              </Text>
            ) : null}
          </span>
          {removeBlocker ? (
            <Text as="span" size="xs" variant="muted" data-testid="roster-hint">
              {removeBlocker}
            </Text>
          ) : null}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="xs"
                disabled={pending}
                aria-label={`Actions for ${who}`}
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} size={12} />
            ACTIONS
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-[200px]">
            <DropdownMenuItem onClick={() => setEditingTitle((v) => !v)}>
              {editingTitle ? "CANCEL TITLE EDIT" : "EDIT TITLE"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={transferBlocker != null}
              title={transferBlocker ?? undefined}
              onClick={() => setConfirming("transfer")}
            >
              MAKE OWNER
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={removeBlocker != null}
              title={removeBlocker ?? undefined}
              onClick={() => setConfirming("remove")}
            >
              REMOVE
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editingTitle ? (
        <div className="flex items-center gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            placeholder="Roster title (blank to clear)"
          />
          <ActionConfirm
            title="Change this roster title?"
            message={isAdmin ? "Applies immediately." : "Files a proposal for an admin to apply."}
            confirmText={isAdmin ? "SET" : "FILE PROPOSAL"}
            onConfirm={(reason) => setMemberTitle.mutateAsync(reason)}
          >
            <Button variant="outline" size="sm" disabled={pending}>
              SET
            </Button>
          </ActionConfirm>
        </div>
      ) : null}

      {/* Raised from the menu, so controlled: the item that opened it is
          gone by the time the dialog renders. */}
      <ActionConfirm
        open={confirming === "transfer"}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={`Make ${who} the owner?`}
        message={
          isAdmin
            ? "Ownership transfers immediately; the current owner becomes a member."
            : "Files a proposal — an admin applies the transfer."
        }
        confirmText={isAdmin ? "TRANSFER" : "FILE PROPOSAL"}
        onConfirm={(reason) => transfer.mutateAsync(reason)}
      />
      <ActionConfirm
        open={confirming === "remove"}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        variant="destructive"
        title={`Remove ${who} from the team?`}
        message={
          isAdmin
            ? "They are removed immediately and notified with your reason."
            : "Files a proposal — an admin applies the removal."
        }
        confirmText={isAdmin ? "REMOVE" : "FILE PROPOSAL"}
        onConfirm={(reason) => remove.mutateAsync(reason)}
      />
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
