import { Delete02Icon, Edit02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { profileLinkParams } from "@/lib/profile-links";
import { client, orpc } from "@/orpc/client";

import type { ProjectContributor } from "./types";

/**
 * CREDITS — the section this whole entity exists for, and the first one an
 * editor can change.
 *
 * Two things shape the editing model. A credit's **display name is the
 * promise**: it outlives the account, the roster, and every re-sync, so
 * removing a credit deletes a row rather than unlinking a person. And **any
 * editor may edit** (§1.3) — a project is shared by the people who made it,
 * so there's no owner-only affordance here.
 *
 * The page is loader-driven (it has to be indexable), so every mutation ends
 * in `router.invalidate()` rather than a query-cache poke.
 */
export function ProjectCredits({
  projectId,
  contributors,
  canEdit,
}: {
  projectId: string;
  contributors: ProjectContributor[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // A team member can be in the editor set without being credited — the
  // claim grants edit rights, not authorship. The add form offers them a
  // one-click way to close that gap.
  const { session } = useStore(authStore);
  const viewer = session?.user ?? null;
  const self =
    viewer != null && !contributors.some((c) => c.profileId === viewer.id)
      ? { id: viewer.id, name: viewer.name, image: viewer.image ?? null }
      : null;

  const refresh = () => void router.invalidate();

  const removeCredit = useMutation({
    mutationFn: (contributorId: number) => client.removeProjectContributor({ contributorId }),
    onSuccess: () => {
      refresh();
      toast.success("Credit removed");
    },
    onError: (error) => toast.error(errorMessage(error, "Failed to remove credit")),
  });

  // An empty credits list is normally nothing to render — but an editor
  // looking at one needs the way in.
  if (contributors.length === 0 && !canEdit) return null;

  return (
    <Section
      id="credits"
      title="CREDITS"
      blurb={
        contributors.length === 0
          ? "Nobody is credited yet."
          : contributors.length === 1
            ? "One contributor."
            : `${contributors.length} contributors.`
      }
      action={
        canEdit ? (
          <Button
            variant="outline"
            className="tracking-widest"
            onClick={() => {
              setAdding((open) => !open);
              setEditingId(null);
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={12} />
            ADD CREDIT
          </Button>
        ) : null
      }
    >
      {adding ? (
        <AddCreditForm
          projectId={projectId}
          self={self}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {contributors.length === 0 ? (
        <Well className="items-center gap-1 p-6 backdrop-blur-none">
          <MicroLabel>NO CREDITS YET</MicroLabel>
          <Text size="xs" variant="muted">
            Add the people who made this — teammates here, and everyone who isn't.
          </Text>
        </Well>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {contributors.map((contributor) =>
            editingId === contributor.id ? (
              <EditCreditForm
                key={contributor.id}
                contributor={contributor}
                onDone={() => {
                  setEditingId(null);
                  refresh();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <ContributorCard
                key={contributor.id}
                contributor={contributor}
                canEdit={canEdit}
                onEdit={() => {
                  setEditingId(contributor.id);
                  setAdding(false);
                }}
                onRemove={() => removeCredit.mutate(contributor.id)}
              />
            ),
          )}
        </div>
      )}
    </Section>
  );
}

/**
 * One credit. A linked row navigates to the profile; a free-text row renders
 * flat — that's the whole point of `display_name` outliving `profile_id`.
 *
 * Editors get controls layered on top, which is why the linked variant stops
 * being a whole-card link when they're present: a delete button inside an
 * anchor is a trap.
 */
function ContributorCard({
  contributor,
  canEdit,
  onEdit,
  onRemove,
}: {
  contributor: ProjectContributor;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const body = (
    <>
      <UserAvatar
        avatarUrl={contributor.avatarUrl}
        username={contributor.displayName}
        shape="round"
        size={36}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Text as="span" size="sm" bold ellipsis className="min-w-0 tracking-wider">
          {contributor.displayName}
        </Text>
        <Text as="span" size="xs" variant="muted" ellipsis>
          {contributor.role ?? "Contributor"}
        </Text>
      </span>
    </>
  );

  if (canEdit) {
    return (
      <Well className="flex-row items-center gap-3 p-3 backdrop-blur-none">
        {contributor.profileId ? (
          <Link
            to="/profile/$userId"
            params={profileLinkParams({
              id: contributor.profileId,
              urlStub: contributor.urlStub,
            })}
            className="flex min-w-0 flex-1 items-center gap-3 hover:text-primary"
            aria-label={contributor.displayName}
          >
            {body}
          </Link>
        ) : (
          body
        )}
        <span className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Edit ${contributor.displayName}'s credit`}
            onClick={onEdit}
          >
            <HugeiconsIcon icon={Edit02Icon} size={12} />
          </Button>
          <Confirm
            variant="destructive"
            title="Remove this credit?"
            message={`${contributor.displayName} will no longer be listed on this project. Their profile and any other credits are untouched.`}
            confirmText="REMOVE"
            onConfirm={onRemove}
          >
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${contributor.displayName}'s credit`}
            >
              <HugeiconsIcon icon={Delete02Icon} size={12} />
            </Button>
          </Confirm>
        </span>
      </Well>
    );
  }

  if (contributor.profileId) {
    return (
      <Chonk
        variant="surface"
        size="lg"
        className="items-center gap-3 bg-card p-3 backdrop-blur-none"
        render={
          <Link
            to="/profile/$userId"
            params={profileLinkParams({
              id: contributor.profileId,
              urlStub: contributor.urlStub,
            })}
            aria-label={contributor.displayName}
          />
        }
      >
        {body}
      </Chonk>
    );
  }

  // Deboss for a readout, emboss for a destination — the house rule the
  // teams directory established.
  return <Well className="flex-row items-center gap-3 p-3 backdrop-blur-none">{body}</Well>;
}

/**
 * The add form. The name field doubles as a member search: type a name, and
 * anyone on the platform who matches can be picked to *link* the credit.
 * Skipping the pick is the common case — most collaborators were never here,
 * and a free-text credit is a first-class one.
 */
function AddCreditForm({
  projectId,
  self,
  onDone,
  onCancel,
}: {
  projectId: string;
  /** The viewer, when they're an editor who isn't credited yet — drives the
   * one-click "credit myself" shortcut. */
  self: { id: string; name: string; image: string | null } | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");
  const [linked, setLinked] = useState<{ id: string; displayName: string } | null>(null);

  const search = useDebouncedValue(displayName.trim(), 250);
  const { data: candidates } = useQuery({
    // The invite picker's search, reused: same question, and it matches the
    // names people actually see rather than only Discord handles.
    ...orpc.searchProfiles.queryOptions({ input: { search } }),
    // Below two characters the endpoint rejects the input anyway, and a
    // linked credit has already found its person.
    enabled: search.length >= 2 && linked == null,
  });

  const addCredit = useMutation({
    mutationFn: () =>
      client.addProjectContributor({
        projectId,
        displayName: displayName.trim(),
        role: role.trim() || undefined,
        profileId: linked?.id,
      }),
    onSuccess: () => {
      toast.success("Credit added");
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error, "Failed to add credit")),
  });

  const creditSelf = useMutation({
    mutationFn: () =>
      client.addProjectContributor({
        projectId,
        displayName: self?.name ?? "",
        profileId: self?.id,
      }),
    onSuccess: () => {
      toast.success("You're credited");
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error, "Failed to add credit")),
  });

  const canSubmit = displayName.trim().length > 0 && !addCredit.isPending;

  return (
    <Well className="gap-3 p-4 backdrop-blur-none">
      {self ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            className="gap-2 tracking-widest"
            disabled={creditSelf.isPending}
            onClick={() => creditSelf.mutate()}
          >
            <UserAvatar avatarUrl={self.image} username={self.name} shape="round" size={16} />
            CREDIT MYSELF
          </Button>
          <Text size="xs" variant="muted">
            You can edit this project but you're not in the credits yet.
          </Text>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <MicroLabel>NAME</MicroLabel>
          <Input
            autoFocus
            value={displayName}
            placeholder="Who worked on this?"
            onChange={(event) => {
              setDisplayName(event.target.value);
              setLinked(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit) addCredit.mutate();
            }}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <MicroLabel>ROLE</MicroLabel>
          <Input
            value={role}
            placeholder="Composer, pixel art, design…"
            onChange={(event) => setRole(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canSubmit) addCredit.mutate();
            }}
          />
        </div>
      </div>

      {linked ? (
        <div className="flex items-center gap-2">
          <MicroLabel>LINKED TO</MicroLabel>
          <Text size="xs" bold>
            {linked.displayName}
          </Text>
          <Button size="xs" variant="ghost" onClick={() => setLinked(null)}>
            UNLINK
          </Button>
        </div>
      ) : candidates && candidates.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <MicroLabel>LINK A MEMBER (OPTIONAL)</MicroLabel>
          <div className="flex flex-wrap gap-2">
            {candidates.map((candidate) => (
              <Button
                key={candidate.id}
                size="xs"
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setLinked({ id: candidate.id, displayName: candidate.displayName });
                  setDisplayName(candidate.displayName);
                }}
              >
                <UserAvatar
                  avatarUrl={candidate.avatarUrl}
                  username={candidate.displayName}
                  shape="round"
                  size={16}
                />
                {candidate.displayName}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="tracking-widest"
          disabled={!canSubmit}
          onClick={() => addCredit.mutate()}
        >
          ADD CREDIT
        </Button>
        <Button size="sm" variant="ghost" className="tracking-widest" onClick={onCancel}>
          CANCEL
        </Button>
      </div>
    </Well>
  );
}

/**
 * Editing one credit, in place of its card.
 *
 * Only the name and role are editable — never the profile link. Re-pointing a
 * credit at a different account is a different act (and a way to put words in
 * someone's mouth); removing and adding says it out loud.
 */
function EditCreditForm({
  contributor,
  onDone,
  onCancel,
}: {
  contributor: ProjectContributor;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(contributor.displayName);
  const [role, setRole] = useState(contributor.role ?? "");

  const save = useMutation({
    mutationFn: () =>
      client.updateProjectContributor({
        contributorId: contributor.id,
        displayName: displayName.trim(),
        role: role.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Credit updated");
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error, "Failed to update credit")),
  });

  const canSubmit = displayName.trim().length > 0 && !save.isPending;

  return (
    <Well className="gap-2 p-3 backdrop-blur-none">
      <Input
        value={displayName}
        aria-label="Name"
        onChange={(event) => setDisplayName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && canSubmit) save.mutate();
        }}
      />
      <Input
        value={role}
        aria-label="Role"
        placeholder="Role"
        onChange={(event) => setRole(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && canSubmit) save.mutate();
        }}
      />
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          className="tracking-widest"
          disabled={!canSubmit}
          onClick={() => save.mutate()}
        >
          SAVE
        </Button>
        <Button size="xs" variant="ghost" className="tracking-widest" onClick={onCancel}>
          CANCEL
        </Button>
      </div>
    </Well>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
