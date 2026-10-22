import { Link01Icon, Share08Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { siteUrl } from "@/env";
import { visibilityOpenness } from "@/lib/canvas/access";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { toast } from "@/lib/toast";
import { orpc } from "@/orpc/client";

import {
  canvasMembersQueryOptions,
  canvasScopesQueryOptions,
  type CanvasDetail,
  type CanvasMemberRole,
  type CanvasVisibility,
  useAddCanvasMember,
  useLeaveCanvas,
  useMoveCanvasToTeam,
  useRemoveCanvasMember,
  useSetCanvasVisibility,
  useUpdateCanvasMember,
} from "../canvas-queries";

const ROLE_LABEL: Record<CanvasMemberRole, string> = { editor: "Can edit", viewer: "Can view" };

export const VISIBILITY_COPY: Record<CanvasVisibility, { label: string; hint: string }> = {
  private: { label: "Private", hint: "Only you and the people you add." },
  team: { label: "Team", hint: "Everyone on the team." },
  unlisted: {
    label: "Anyone with the link",
    hint: "Readable without signing in. Not listed or indexed.",
  },
  public: {
    label: "Public",
    hint: "Listed on the profile or team page, and open to search engines.",
  },
};

export function visibilityOptions(canvas: Pick<CanvasDetail, "scope">): CanvasVisibility[] {
  return canvas.scope.kind === "team"
    ? ["team", "unlisted", "public"]
    : ["private", "unlisted", "public"];
}

async function copyLink(canvasId: string) {
  try {
    await navigator.clipboard.writeText(siteUrl(`/canvases/${canvasId}`));
    toast.success("Link copied.");
  } catch {
    toast.error("Couldn't copy the link.");
  }
}

function RoleSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: CanvasMemberRole;
  onChange: (role: CanvasMemberRole) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === "editor" || next === "viewer") onChange(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-28 shrink-0">
        <SelectValue>{ROLE_LABEL[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="editor">{ROLE_LABEL.editor}</SelectItem>
        <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
      </SelectContent>
    </Select>
  );
}

const WIDEN_LOCKED = "Only the team's owners can make this canvas more visible.";

function VisibilityPicker({ canvas }: { canvas: CanvasDetail }) {
  const setVisibility = useSetCanvasVisibility(canvas.id);
  const id = useId();
  const locked = (value: CanvasVisibility) =>
    !canvas.canWidenVisibility && visibilityOpenness(value) > visibilityOpenness(canvas.visibility);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5">
        <MicroLabel as="span">WHO CAN SEE IT</MicroLabel>
      </legend>
      <RadioGroup
        aria-label="Who can see it"
        value={canvas.visibility}
        onValueChange={(next) => setVisibility.mutate(next as CanvasVisibility)}
        disabled={setVisibility.isPending}
        className="gap-2"
      >
        {visibilityOptions(canvas).map((value) => {
          const disabled = locked(value);
          return (
            <SimpleTooltip key={value} content={WIDEN_LOCKED} disabled={!disabled}>
              <label
                className="grid grid-cols-[auto_1fr] items-start gap-x-2 data-disabled:opacity-60"
                data-disabled={disabled || undefined}
              >
                <RadioGroupItem
                  value={value}
                  disabled={disabled}
                  aria-label={VISIBILITY_COPY[value].label}
                  aria-describedby={`${id}-${value}`}
                  className="row-span-2 mt-0.5"
                />
                <Text as="span" size="sm" bold>
                  {VISIBILITY_COPY[value].label}
                </Text>
                <Text as="span" size="xs" variant="muted" id={`${id}-${value}`}>
                  {VISIBILITY_COPY[value].hint}
                </Text>
              </label>
            </SimpleTooltip>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

function AddPerson({ canvas, memberIds }: { canvas: CanvasDetail; memberIds: Set<string> }) {
  const add = useAddCanvasMember(canvas.id);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<CanvasMemberRole>("viewer");
  const search = useDebouncedValue(query.trim(), 250);
  const { data: candidates } = useQuery({
    ...orpc.searchProfiles.queryOptions({ input: { search } }),
    enabled: search.length >= 2,
  });
  const found = (candidates ?? []).filter((c) => !memberIds.has(c.id));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <Input
          value={query}
          aria-label="Add people by name"
          placeholder="Add people by name"
          onChange={(e) => setQuery(e.target.value)}
          className="h-7 min-w-0 flex-1 text-xs"
        />
        <RoleSelect value={role} onChange={setRole} label="Role for new people" />
      </div>
      {found.length > 0 ? (
        <ul className="flex flex-col gap-0.5" aria-label="Matching members">
          {found.map((candidate) => (
            <li key={candidate.id}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                disabled={add.isPending}
                onClick={() =>
                  add.mutate(
                    { userId: candidate.id, role },
                    {
                      onSuccess: () => {
                        setQuery("");
                        toast.success(`Shared with ${candidate.displayName}.`);
                      },
                    },
                  )
                }
              >
                <UserAvatar
                  avatarUrl={candidate.avatarUrl}
                  username={candidate.displayName}
                  size={18}
                />
                <span className="truncate">{candidate.displayName}</span>
                {candidate.handle ? (
                  <Text as="span" size="xs" variant="muted" className="truncate">
                    @{candidate.handle}
                  </Text>
                ) : null}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type PendingConfirm = { kind: "remove"; userId: string; name: string } | { kind: "leave" } | null;

function People({
  canvas,
  onConfirm,
}: {
  canvas: CanvasDetail;
  onConfirm: (pending: PendingConfirm) => void;
}) {
  const { data: members = [] } = useQuery(canvasMembersQueryOptions(canvas.id));
  const update = useUpdateCanvasMember(canvas.id);
  const memberIds = new Set(members.map((m) => m.userId));

  return (
    <section className="flex flex-col gap-1.5" aria-label="People">
      <h3>
        <MicroLabel as="span">PEOPLE</MicroLabel>
      </h3>
      {members.length === 0 ? (
        <Text size="xs" variant="muted">
          Not shared with anyone yet.
        </Text>
      ) : (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-2">
              <UserAvatar avatarUrl={member.avatarUrl} username={member.displayName} size={20} />
              <Text as="span" size="sm" ellipsis className="min-w-0 flex-1">
                {member.displayName}
              </Text>
              {canvas.canShare ? (
                <>
                  <RoleSelect
                    value={member.role}
                    label={`Role for ${member.displayName}`}
                    disabled={update.isPending}
                    onChange={(role) => update.mutate({ userId: member.userId, role })}
                  />
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      onConfirm({ kind: "remove", userId: member.userId, name: member.displayName })
                    }
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <Text as="span" size="xs" variant="muted">
                  {ROLE_LABEL[member.role]}
                </Text>
              )}
            </li>
          ))}
        </ul>
      )}
      {canvas.canShare ? (
        members.length < CANVAS_LIMITS.maxCanvasMembers ? (
          <AddPerson canvas={canvas} memberIds={memberIds} />
        ) : (
          <Text size="xs" variant="muted">
            Shared with the most people a canvas can have.
          </Text>
        )
      ) : null}
    </section>
  );
}

function MoveToTeamDialog({ canvas, onClose }: { canvas: CanvasDetail; onClose: () => void }) {
  const { data: scopes } = useQuery(canvasScopesQueryOptions());
  const { data: members = [] } = useQuery(canvasMembersQueryOptions(canvas.id));
  const move = useMoveCanvasToTeam(canvas.id);
  const teams = (scopes?.teams ?? []).filter((t) => t.status !== "archived" && !t.hidden);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const chosen = teams.find((t) => t.teamId === teamId);

  const submit = () => {
    if (!teamId) return;
    if (members.length > 0) setConfirming(true);
    else move.mutate(teamId, { onSuccess: onClose });
  };

  return (
    <>
      <ResponsiveModal
        open
        onClose={onClose}
        title="Move to a team"
        description="The team's roster decides who can open it from then on. This can't be undone."
        className="sm:max-w-md"
        footer={
          <div className="flex justify-end gap-2 p-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!teamId || move.isPending} onClick={submit}>
              Move
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2 p-4">
          {teams.length === 0 ? (
            <Text size="sm" variant="muted">
              You aren't on a team that can take canvases.
            </Text>
          ) : (
            <RadioGroup
              aria-label="Team"
              value={teamId ?? ""}
              onValueChange={(next) => setTeamId(String(next))}
            >
              {teams.map((team) => (
                <label key={team.teamId} className="flex items-center gap-2">
                  <RadioGroupItem value={team.teamId} aria-label={team.name} />
                  <Text as="span" size="sm">
                    {team.name}
                  </Text>
                </label>
              ))}
            </RadioGroup>
          )}
        </div>
      </ResponsiveModal>
      <Confirm
        open={confirming}
        onOpenChange={setConfirming}
        title={`Move to ${chosen?.name ?? "the team"}?`}
        message={`${members.length} ${members.length === 1 ? "person loses" : "people lose"} access: a team canvas is shared with the team's roster instead.`}
        confirmText="MOVE"
        variant="destructive"
        onConfirm={async () => {
          if (teamId) await move.mutateAsync(teamId);
          onClose();
        }}
      />
    </>
  );
}

/**
 * Top right, beside History: copy the link, choose who can see the canvas,
 * and manage the people it's shared with. Members see who else is on it and
 * can leave.
 */
export function SharePopover({ canvas, teamName }: { canvas: CanvasDetail; teamName: string }) {
  const [pending, setPending] = useState<PendingConfirm>(null);
  const [moving, setMoving] = useState(false);
  const remove = useRemoveCanvasMember(canvas.id);
  const leave = useLeaveCanvas(canvas.id);
  const personal = canvas.scope.kind === "personal";

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={<Button variant="ghost" size="icon" tooltip="Share" aria-label="Share" />}
        >
          <HugeiconsIcon icon={Share08Icon} size={16} />
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-80 gap-3">
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>Share</PopoverTitle>
            <Button variant="outline" size="xs" onClick={() => void copyLink(canvas.id)}>
              <HugeiconsIcon icon={Link01Icon} size={12} />
              Copy link
            </Button>
          </div>
          {canvas.canChangeVisibility ? <VisibilityPicker canvas={canvas} /> : null}
          {personal ? (
            <People canvas={canvas} onConfirm={setPending} />
          ) : (
            <Text size="xs" variant="muted">
              Everyone on {teamName} can edit.
            </Text>
          )}
          {canvas.isMember && canvas.memberRole ? (
            <div className="flex items-center justify-between gap-2">
              <Text as="span" size="xs" variant="muted">
                You {canvas.memberRole === "editor" ? "can edit" : "can view"} this canvas.
              </Text>
              <Button variant="ghost" size="xs" onClick={() => setPending({ kind: "leave" })}>
                Leave
              </Button>
            </div>
          ) : null}
          {canvas.canShare && personal ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => setMoving(true)}
            >
              Move to a team…
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
      <Confirm
        open={pending != null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending?.kind === "leave"
            ? "Leave this canvas?"
            : `Remove ${pending?.kind === "remove" ? pending.name : ""}?`
        }
        message={
          pending?.kind === "leave"
            ? "You lose access unless the owner shares it with you again."
            : "They lose access to this canvas straight away."
        }
        confirmText={pending?.kind === "leave" ? "LEAVE" : "REMOVE"}
        variant="destructive"
        onConfirm={async () => {
          if (pending?.kind === "leave") await leave.mutateAsync();
          else if (pending?.kind === "remove") await remove.mutateAsync(pending.userId);
        }}
      />
      {moving ? <MoveToTeamDialog canvas={canvas} onClose={() => setMoving(false)} /> : null}
    </>
  );
}
