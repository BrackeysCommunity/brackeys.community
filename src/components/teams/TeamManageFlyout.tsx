import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { uploadTeamAvatarImage } from "@/components/collab/CollabCreateFlyout/shared";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { errorMessage } from "@/lib/error-message";
import { itchImageUrl } from "@/lib/itch-image";
import { reportMutationError } from "@/lib/posthog";
import { client, orpc } from "@/orpc/client";

import type { RpcTeam } from "./TeamPage";

/**
 * Member-facing management surface for a team page — a bottom drawer
 * with identity, roster, showcase, and danger sections. Owner-only
 * controls simply don't render for plain members. Every mutation
 * invalidates the page's `getTeam` query so the page re-renders with
 * persisted values.
 */
export function TeamManageFlyout({
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
  const invalidate = onInvalidate;
  const isOwner = team.isOwner;

  return (
    <Drawer open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DrawerContent className="max-h-[88vh] p-0">
        <DrawerDescription className="sr-only">
          Manage the team's identity, roster, and showcase.
        </DrawerDescription>
        <div className="flex min-h-0 flex-1 flex-col pt-3 pb-[env(safe-area-inset-bottom)]">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-muted/40 py-3 pr-3 pl-5">
            <DrawerTitle className="text-base tracking-widest text-foreground uppercase">
              Manage {team.name}
            </DrawerTitle>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
            {isOwner ? <IdentitySection team={team} onSaved={invalidate} /> : null}
            <RosterSection team={team} onChanged={invalidate} />
            {team.status === "active" ? (
              <ShowcaseSection team={team} onChanged={invalidate} />
            ) : null}
            <DangerSection team={team} onChanged={invalidate} onGone={onClose} />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-dashed border-muted-foreground/25 pb-1.5">
      <MicroLabel>{children}</MicroLabel>
    </div>
  );
}

// ── Identity (owner) ─────────────────────────────────────────────────────────

function IdentitySection({ team, onSaved }: { team: RpcTeam; onSaved: () => void }) {
  const [name, setName] = useState(team.name);
  const [tagline, setTagline] = useState(team.tagline ?? "");
  const [bio, setBio] = useState(team.bio ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(team.websiteUrl ?? "");
  const [itchUrl, setItchUrl] = useState(team.itchUrl ?? "");
  const [slug, setSlug] = useState(team.slug);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await client.updateTeam({
        teamId: team.id,
        name: name.trim(),
        tagline: tagline.trim() || null,
        bio: bio.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        itchUrl: itchUrl.trim() || null,
      });
      if (slug.trim() !== team.slug) {
        await client.setTeamSlug({ teamId: team.id, slug: slug.trim() });
      }
    },
    onSuccess: onSaved,
    onError: (err) => reportMutationError(err, "team.update"),
  });

  const recruitingMutation = useMutation({
    mutationFn: (recruiting: boolean) => client.updateTeam({ teamId: team.id, recruiting }),
    onSuccess: onSaved,
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>IDENTITY</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="AVATAR">
          <TeamImageUpload team={team} kind="avatar" onUploaded={onSaved} />
        </Field>
        <Field label="BANNER" hint="wide image behind the masthead">
          <TeamImageUpload team={team} kind="banner" onUploaded={onSaved} />
        </Field>
        <Field label="NAME">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        <Field label="HANDLE" hint={`/teams/${slug || "…"}`}>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            maxLength={32}
          />
        </Field>
        <Field label="TAGLINE" className="sm:col-span-2">
          <Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={200} />
        </Field>
        <Field label="BIO" className="sm:col-span-2">
          <Textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            maxLength={5000}
          />
        </Field>
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
          id="team-recruiting"
          checked={team.recruiting}
          disabled={recruitingMutation.isPending}
          onCheckedChange={(checked) => recruitingMutation.mutate(!!checked)}
        />
        <Label htmlFor="team-recruiting" className="text-sm text-muted-foreground">
          We're recruiting — show the badge even between posts.
        </Label>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={name.trim().length < 2 || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "SAVING…" : "SAVE IDENTITY"}
        </Button>
        {saveMutation.isError ? (
          <Text size="xs" className="text-destructive">
            {errorMessage(saveMutation.error)}
          </Text>
        ) : null}
        {saveMutation.isSuccess ? (
          <Text size="xs" variant="success" className="tracking-widest uppercase">
            Saved
          </Text>
        ) : null}
      </div>
    </section>
  );
}

const MAX_TEAM_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Immediate-upload picker for the team's avatar or banner. Unlike the
 * text fields (which batch behind SAVE IDENTITY), an image upload is its
 * own POST — the file goes up on pick and the page query refreshes.
 */
function TeamImageUpload({
  team,
  kind,
  onUploaded,
}: {
  team: RpcTeam;
  kind: "avatar" | "banner";
  onUploaded: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const current = kind === "avatar" ? team.avatarUrl : team.bannerUrl;

  const upload = useMutation({
    mutationFn: (file: File) => uploadTeamAvatarImage(team.id, file, kind),
    onSuccess: () => {
      setError(null);
      onUploaded();
    },
    onError: (err) => {
      reportMutationError(err, "team.image_upload");
      setError(errorMessage(err));
    },
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        {kind === "avatar" ? (
          <UserAvatar avatarUrl={current} username={team.name} size={40} />
        ) : (
          <div
            className="h-10 w-24 shrink-0 border border-muted/40 bg-muted/20 bg-cover bg-center"
            style={
              current
                ? { backgroundImage: `url("${encodeURI(itchImageUrl(current, { width: 192 }))}")` }
                : undefined
            }
            aria-label={current ? "Current banner" : "No banner set"}
          />
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={upload.isPending}
          onClick={() => fileInputRef.current?.click()}
          className="tracking-widest"
        >
          {upload.isPending ? "UPLOADING…" : current ? "REPLACE" : "UPLOAD"}
        </Button>
      </div>
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
          upload.mutate(file);
        }}
      />
      {error ? (
        <Text size="xs" className="text-destructive">
          {error}
        </Text>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <MicroLabel>{label}</MicroLabel>
        {hint ? (
          <Text as="span" size="xs" variant="muted">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// ── Roster ───────────────────────────────────────────────────────────────────

function RosterSection({ team, onChanged }: { team: RpcTeam; onChanged: () => void }) {
  const isOwner = team.isOwner;
  const [search, setSearch] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const { data: results } = useQuery({
    ...orpc.searchProfiles.queryOptions({ input: { search: search.trim() } }),
    enabled: search.trim().length >= 2 && team.status === "active",
  });

  const inviteMutation = useMutation({
    mutationFn: (inviteeId: string) => client.inviteToTeam({ teamId: team.id, inviteeId }),
    onSuccess: () => {
      setSearch("");
      setInviteError(null);
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "team.invite");
      setInviteError(errorMessage(err));
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (inviteId: number) => client.revokeInvite({ inviteId }),
    onSuccess: onChanged,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => client.removeMember({ teamId: team.id, userId }),
    onSuccess: onChanged,
  });
  const transferMutation = useMutation({
    mutationFn: (userId: string) => client.transferOwnership({ teamId: team.id, userId }),
    onSuccess: onChanged,
  });
  const titleMutation = useMutation({
    mutationFn: (title: string) =>
      client.updateMemberTitle({ teamId: team.id, title: title || null }),
    onSuccess: onChanged,
  });

  const memberIds = new Set(team.members.map((m) => m.userId));
  const invitedIds = new Set(team.pendingInvites.map((i) => i.inviteeId));
  const self = team.members.find((m) => m.role === team.viewerRole && m.userId);
  const [myTitle, setMyTitle] = useState(
    team.members.find((m) => m.userId === self?.userId)?.title ?? "",
  );

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>ROSTER</SectionLabel>

      <div className="flex flex-col gap-2">
        {team.members.map((m) => (
          <Well key={m.id} variant="ghost" className="flex-row items-center gap-3 p-2.5">
            <UserAvatar avatarUrl={m.avatarUrl} username={m.username} size={28} />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <Text as="span" size="sm" ellipsis>
                {m.username ?? "Unknown"}
              </Text>
              {m.role === "owner" ? <MicroLabel>OWNER</MicroLabel> : null}
            </span>
            {isOwner && m.role !== "owner" ? (
              <>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={transferMutation.isPending}
                  onClick={() => transferMutation.mutate(m.userId)}
                >
                  MAKE OWNER
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(m.userId)}
                >
                  REMOVE
                </Button>
              </>
            ) : null}
          </Well>
        ))}
      </div>

      {/* The member's own craft label on the roster. */}
      <Field label="YOUR ROSTER TITLE" hint="e.g. Composer, Pixel art">
        <div className="flex items-center gap-2">
          <Input value={myTitle} onChange={(e) => setMyTitle(e.target.value)} maxLength={100} />
          <Button
            variant="outline"
            size="sm"
            disabled={titleMutation.isPending}
            onClick={() => titleMutation.mutate(myTitle.trim())}
          >
            SET
          </Button>
        </div>
      </Field>

      {team.status === "active" ? (
        <Field label="INVITE" hint="search by username">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
          />
          {inviteError ? (
            <Text size="xs" className="text-destructive">
              {inviteError}
            </Text>
          ) : null}
          {search.trim().length >= 2 ? (
            <div className="flex flex-col gap-1.5">
              {(results ?? [])
                .filter((r) => !memberIds.has(r.id))
                .map((r) => (
                  <Well key={r.id} variant="ghost" className="flex-row items-center gap-3 p-2">
                    <UserAvatar avatarUrl={r.avatarUrl} username={r.username} size={24} />
                    <Text as="span" size="sm" ellipsis className="min-w-0 flex-1">
                      {r.username ?? "Unknown"}
                    </Text>
                    {invitedIds.has(r.id) ? (
                      <MicroLabel>INVITED</MicroLabel>
                    ) : (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={inviteMutation.isPending}
                        onClick={() => inviteMutation.mutate(r.id)}
                      >
                        INVITE
                      </Button>
                    )}
                  </Well>
                ))}
            </div>
          ) : null}
        </Field>
      ) : null}

      {team.pendingInvites.length > 0 ? (
        <Field label="PENDING INVITES">
          <div className="flex flex-col gap-1.5">
            {team.pendingInvites.map((inv) => (
              <Well key={inv.id} variant="ghost" className="flex-row items-center gap-3 p-2">
                <UserAvatar
                  avatarUrl={inv.inviteeAvatar}
                  username={inv.inviteeUsername}
                  size={24}
                />
                <Text as="span" size="sm" ellipsis className="min-w-0 flex-1">
                  {inv.inviteeUsername ?? "Unknown"}
                </Text>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={revokeMutation.isPending}
                  onClick={() => revokeMutation.mutate(inv.id)}
                >
                  REVOKE
                </Button>
              </Well>
            ))}
          </div>
        </Field>
      ) : null}
    </section>
  );
}

// ── Showcase ─────────────────────────────────────────────────────────────────

function ShowcaseSection({ team, onChanged }: { team: RpcTeam; onChanged: () => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The member's own profile projects, for one-click import — the
  // common case is "our jam game is already on my profile".
  const { data: myProfile } = useQuery({
    ...orpc.getMyProfile.queryOptions({ input: {} }),
    staleTime: 60 * 1000,
  });
  const alreadyImported = new Set(
    team.projects
      .map((p) => (p as { sourceProfileProjectId?: string | null }).sourceProfileProjectId)
      .filter(Boolean),
  );
  const importable = (myProfile?.projects ?? []).filter((p) => !alreadyImported.has(p.id));

  const addMutation = useMutation({
    mutationFn: () =>
      client.addTeamProject({ teamId: team.id, title: title.trim(), url: url.trim() || undefined }),
    onSuccess: () => {
      setTitle("");
      setUrl("");
      setError(null);
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "team.project_add");
      setError(errorMessage(err));
    },
  });
  const importMutation = useMutation({
    mutationFn: (projectId: string) => client.importMemberProject({ teamId: team.id, projectId }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "team.project_import");
      setError(errorMessage(err));
    },
  });
  const removeMutation = useMutation({
    mutationFn: (projectId: string) => client.removeTeamProject({ teamId: team.id, projectId }),
    onSuccess: onChanged,
  });
  const pinMutation = useMutation({
    mutationFn: ({ projectId, pinned }: { projectId: string; pinned: boolean }) =>
      client.updateTeamProject({ teamId: team.id, projectId, pinned }),
    onSuccess: onChanged,
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>SHOWCASE</SectionLabel>

      {team.projects.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {team.projects.map((p) => (
            <Well key={p.id} variant="ghost" className="flex-row items-center gap-3 p-2">
              <Text as="span" size="sm" ellipsis className="min-w-0 flex-1">
                {p.title}
              </Text>
              <Button
                variant="outline"
                size="xs"
                disabled={pinMutation.isPending}
                onClick={() => pinMutation.mutate({ projectId: p.id, pinned: !p.pinned })}
              >
                {p.pinned ? "UNPIN" : "PIN"}
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={removeMutation.isPending}
                onClick={() => removeMutation.mutate(p.id)}
              >
                REMOVE
              </Button>
            </Well>
          ))}
        </div>
      ) : (
        <Text size="xs" variant="muted">
          Nothing on the showcase yet.
        </Text>
      )}

      {importable.length > 0 ? (
        <Field label="IMPORT FROM YOUR PROFILE" hint="copies onto the team page">
          <div className="flex flex-col gap-1.5">
            {importable.slice(0, 6).map((p) => (
              <Well key={p.id} variant="ghost" className="flex-row items-center gap-3 p-2">
                <Text as="span" size="sm" ellipsis className="min-w-0 flex-1">
                  {p.title}
                </Text>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={importMutation.isPending}
                  onClick={() => importMutation.mutate(p.id)}
                >
                  IMPORT
                </Button>
              </Well>
            ))}
          </div>
        </Field>
      ) : null}

      <Field label="ADD MANUALLY">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Project title"
            maxLength={200}
            className="min-w-40 flex-1"
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… (optional)"
            className="min-w-40 flex-1"
          />
          <Button
            size="sm"
            disabled={title.trim().length === 0 || addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            ADD
          </Button>
        </div>
        {error ? (
          <Text size="xs" className="text-destructive">
            {error}
          </Text>
        ) : null}
      </Field>
    </section>
  );
}

// ── Danger zone ──────────────────────────────────────────────────────────────

function DangerSection({
  team,
  onChanged,
  onGone,
}: {
  team: RpcTeam;
  onChanged: () => void;
  onGone: () => void;
}) {
  const navigate = useNavigate();
  const isOwner = team.isOwner;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archiveMutation = useMutation({
    mutationFn: () =>
      client.setTeamArchived({ teamId: team.id, archived: team.status === "active" }),
    onSuccess: onChanged,
    onError: (err) => {
      reportMutationError(err, "team.archive");
      setError(errorMessage(err));
    },
  });
  const leaveMutation = useMutation({
    mutationFn: () => client.leaveTeam({ teamId: team.id }),
    onSuccess: () => {
      onChanged();
      onGone();
    },
    onError: (err) => {
      reportMutationError(err, "team.leave");
      setError(errorMessage(err));
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => client.deleteTeam({ teamId: team.id }),
    onSuccess: () => {
      onGone();
      void navigate({ to: "/collab" });
    },
    onError: (err) => {
      reportMutationError(err, "team.delete");
      setError(errorMessage(err));
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>DANGER ZONE</SectionLabel>
      <div className="flex flex-wrap items-center gap-2">
        {isOwner ? (
          <Button
            variant="outline"
            size="sm"
            disabled={archiveMutation.isPending}
            onClick={() => archiveMutation.mutate()}
          >
            {team.status === "active" ? "ARCHIVE TEAM" : "RESTORE TEAM"}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={leaveMutation.isPending}
          onClick={() => leaveMutation.mutate()}
        >
          LEAVE TEAM
        </Button>
        {isOwner ? (
          confirmDelete ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
              >
                REALLY DELETE — POSTS UNLINK, PAGE GOES AWAY
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                CANCEL
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
              DELETE TEAM
            </Button>
          )
        ) : null}
      </div>
      {error ? (
        <Text size="xs" className="text-destructive">
          {error}
        </Text>
      ) : null}
      <Text size="xs" variant="muted">
        Archiving keeps the page up read-only and closes open posts. Deleting removes the page;
        posts stay on the board, unlinked.
      </Text>
    </section>
  );
}
