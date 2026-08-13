import { PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AdminEmpty,
  AdminPager,
  AdminRow,
  AdminSection,
  CategoryCombobox,
  Field,
  ReasonField,
  errText,
} from "@/components/admin/AdminUI";
import { VocabularyManager } from "@/components/admin/AdminVocabulary";
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
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { timeAgo } from "@/lib/format-time";
import { client, orpc } from "@/orpc/client";

type SkillRequest = Awaited<ReturnType<typeof client.listSkillRequests>>["items"][number];
type Skill = Awaited<ReturnType<typeof client.listSkills>>[number];

const PAGE_SIZE = 10;

/**
 * The skills tab: the approved catalogue on the left, the queue that feeds
 * it on the right. Side by side because triage is a comparison — "is this
 * already in there under another casing?" is the question almost every
 * request asks.
 */
export function AdminSkills({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
      <VocabularyManager
        kind="skills"
        isAdmin={isAdmin}
        title="Approved skills"
        hint="What members can pick from on their profile."
        stacked
      />
      <AdminSkillRequests />
    </div>
  );
}

/**
 * The approval path `requestSkill` never had. Approve grants the skill to
 * the requester — either as typed, under a name staff corrected, or against
 * a catalogue entry that already exists (the "c#" vs "C#" case). Reject just
 * marks it so it stops queueing.
 */
function AdminSkillRequests() {
  const [status, setStatus] = useState<"pending" | "handled">("pending");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const requests = useQuery(
    orpc.listSkillRequests.queryOptions({ input: { status, page, pageSize: PAGE_SIZE } }),
  );
  const skills = useQuery(orpc.listSkills.queryOptions({ input: {} }));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.listSkillRequests.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listSkills.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listVocabulary.key() });
  };
  const onError = (err: unknown) => toast.error(errText(err));

  const approve = useMutation({
    mutationFn: (input: {
      requestId: number;
      name?: string;
      category?: string | null;
      skillId?: number;
    }) => client.approveSkillRequest(input),
    onSuccess: (result) => {
      setEditing(null);
      toast.success(`Granted “${result.skill.name}”.`);
      invalidate();
    },
    onError,
  });
  const reject = useMutation({
    mutationFn: (input: { requestId: number; reason?: string }) => client.rejectSkillRequest(input),
    onSuccess: invalidate,
    onError,
  });
  const busy = approve.isPending || reject.isPending;

  const items = requests.data?.items ?? [];
  const total = requests.data?.total ?? 0;

  const setStatusFilter = (next: "pending" | "handled") => {
    setStatus(next);
    setPage(1);
    setEditing(null);
  };

  return (
    <AdminSection
      title="Skill requests"
      count={requests.isPending ? undefined : total}
      hint={
        status === "pending"
          ? "Approving adds the skill to the catalogue and to the requester’s profile."
          : "Requests already approved or rejected."
      }
      actions={
        <SegmentedControl
          size="sm"
          value={status}
          onChange={(next) => setStatusFilter(next as "pending" | "handled")}
        >
          <SegmentedControl.Item value="pending">Pending</SegmentedControl.Item>
          <SegmentedControl.Item value="handled">Handled</SegmentedControl.Item>
        </SegmentedControl>
      }
    >
      <AdminPager
        page={page}
        pageCount={requests.data?.pageCount ?? 1}
        total={total}
        pageSize={PAGE_SIZE}
        unit="requests"
        onPage={setPage}
      />

      {requests.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <AdminEmpty>
          {status === "pending"
            ? "No skill requests waiting. Nothing needs you here."
            : "Nothing has been handled yet."}
        </AdminEmpty>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              skills={skills.data ?? []}
              busy={busy}
              editing={editing === request.id}
              onEdit={(open) => setEditing(open ? request.id : null)}
              onApprove={(input) => approve.mutateAsync({ requestId: request.id, ...input })}
              onReject={(reason) =>
                reject.mutateAsync({ requestId: request.id, ...(reason ? { reason } : {}) })
              }
            />
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function RequestRow({
  request,
  skills,
  busy,
  editing,
  onEdit,
  onApprove,
  onReject,
}: {
  request: SkillRequest;
  skills: Skill[];
  busy: boolean;
  editing: boolean;
  onEdit: (open: boolean) => void;
  onApprove: (input: {
    name?: string;
    category?: string | null;
    skillId?: number;
  }) => Promise<unknown>;
  onReject: (reason?: string) => Promise<unknown>;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const pending = request.status === "pending";

  return (
    <AdminRow muted={!pending}>
      <div className="flex flex-wrap items-center gap-3">
        <UserAvatar
          avatarUrl={request.requester?.avatarUrl}
          username={request.requester?.displayName}
          size={28}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Text size="sm" className="font-medium">
              {request.name}
            </Text>
            {request.category ? (
              <Badge size="label" variant="outline">
                {request.category}
              </Badge>
            ) : null}
            {!pending ? (
              <Badge size="label" variant={request.status === "approved" ? "success" : "secondary"}>
                {request.status.toUpperCase()}
              </Badge>
            ) : null}
          </div>
          <Text size="xs" variant="muted">
            {request.requester?.displayName ?? "Unknown"} · {timeAgo(request.createdAt)}
          </Text>
        </div>

        {pending && !editing && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => onEdit(true)}
              aria-label={`Edit ${request.name} before approving`}
            >
              <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} data-icon="inline-start" />
              Edit
            </Button>
            <Confirm
              title={`Reject “${request.name}”?`}
              message={
                <>
                  The request leaves the queue and nothing is added to the catalogue.{" "}
                  {request.requester?.displayName ?? "The requester"} is notified.
                  <ReasonField
                    id={`reject-reason-${request.id}`}
                    value={rejectReason}
                    onChange={setRejectReason}
                    placeholder="e.g. Too niche — try Gameplay Programmer"
                  />
                </>
              }
              confirmText="Reject request"
              variant="destructive"
              onConfirm={async () => {
                await onReject(rejectReason.trim() || undefined);
              }}
            >
              <Button variant="outline" size="xs" disabled={busy}>
                Reject
              </Button>
            </Confirm>
            <Confirm
              title={`Approve “${request.existingSkill?.name ?? request.name}”?`}
              message={
                request.existingSkill
                  ? `“${request.existingSkill.name}” already exists — the requester gets that entry rather than a duplicate.`
                  : `“${request.name}” joins the skills catalogue for everyone and lands on ${request.requester?.displayName ?? "the requester"}’s profile.`
              }
              confirmText="Approve"
              onConfirm={async () => {
                await onApprove({});
              }}
            >
              <Button size="xs" disabled={busy}>
                Approve
              </Button>
            </Confirm>
          </div>
        )}
      </div>

      {pending && request.existingSkill && !editing ? (
        <Text size="xs" variant="warning">
          Already in the catalogue as “{request.existingSkill.name}” — approving grants that entry.
        </Text>
      ) : null}

      {editing ? (
        <ResolvePanel
          request={request}
          skills={skills}
          busy={busy}
          onCancel={() => onEdit(false)}
          onApprove={onApprove}
        />
      ) : null}
    </AdminRow>
  );
}

/**
 * Correct-then-approve. Either arm resolves to a single skill id server-side,
 * so both paths land on the requester's profile identically — the choice is
 * only about which catalogue entry they end up holding.
 */
function ResolvePanel({
  request,
  skills,
  busy,
  onCancel,
  onApprove,
}: {
  request: SkillRequest;
  skills: Skill[];
  busy: boolean;
  onCancel: () => void;
  onApprove: (input: {
    name?: string;
    category?: string | null;
    skillId?: number;
  }) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<"rename" | "match">(request.existingSkill ? "match" : "rename");
  const [name, setName] = useState(request.name);
  const [category, setCategory] = useState(request.category ?? "");
  const [match, setMatch] = useState<Skill | null>(
    request.existingSkill ? (skills.find((s) => s.id === request.existingSkill?.id) ?? null) : null,
  );

  const categories = useMemo(
    () => [...new Set(skills.map((s) => s.category).filter((c): c is string => !!c))].sort(),
    [skills],
  );

  const trimmed = name.trim();
  // A rename onto an existing entry isn't an error — the server resolves to
  // that entry — but staff should see it's what will happen.
  const clash = useMemo(
    () => skills.find((s) => s.name.toLowerCase() === trimmed.toLowerCase()) ?? null,
    [skills, trimmed],
  );

  const canApply = mode === "match" ? match != null : trimmed.length > 0;
  const target = mode === "match" ? match?.name : (clash?.name ?? trimmed);

  return (
    <div className="flex flex-col gap-3 border-t border-border/60 pt-3">
      <SegmentedControl
        size="sm"
        value={mode}
        onChange={(next) => setMode(next as "rename" | "match")}
      >
        <SegmentedControl.Item value="rename">Create / rename</SegmentedControl.Item>
        <SegmentedControl.Item value="match">Match existing</SegmentedControl.Item>
      </SegmentedControl>

      {mode === "rename" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Name" htmlFor={`req-name-${request.id}`} className="flex-1">
            <Input
              id={`req-name-${request.id}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="e.g. C#"
            />
          </Field>
          <Field label="Category (optional)" htmlFor={`req-cat-${request.id}`} className="flex-1">
            <CategoryCombobox
              id={`req-cat-${request.id}`}
              value={category}
              onChange={setCategory}
              categories={categories}
            />
          </Field>
        </div>
      ) : (
        <Field label="Existing skill" htmlFor={`req-match-${request.id}`}>
          <SkillPicker
            id={`req-match-${request.id}`}
            skills={skills}
            value={match}
            onChange={setMatch}
          />
        </Field>
      )}

      {mode === "rename" && clash ? (
        <Text size="xs" variant="warning">
          “{clash.name}” already exists — approving grants that entry instead of creating a
          duplicate.
        </Text>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Confirm
          title={target ? `Approve as “${target}”?` : "Approve?"}
          message={
            mode === "match"
              ? `${request.requester?.displayName ?? "The requester"} gets “${match?.name}”. The request is recorded as approved under that name.`
              : clash
                ? `“${clash.name}” already exists, so the requester gets that entry — nothing is duplicated.`
                : `“${trimmed}” joins the skills catalogue for everyone and lands on ${request.requester?.displayName ?? "the requester"}’s profile.`
          }
          confirmText="Approve"
          disabled={!canApply}
          onConfirm={async () => {
            await onApprove(
              mode === "match"
                ? { skillId: match?.id }
                : { name: trimmed, category: category.trim() },
            );
          }}
        >
          <Button size="xs" disabled={!canApply || busy}>
            Apply &amp; approve
          </Button>
        </Confirm>
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function SkillPicker({
  skills,
  value,
  onChange,
  id,
}: {
  skills: Skill[];
  value: Skill | null;
  onChange: (skill: Skill | null) => void;
  id?: string;
}) {
  return (
    <Combobox
      items={skills}
      value={value}
      onValueChange={(next: Skill | null) => onChange(next)}
      itemToStringLabel={(skill: Skill) => skill.name}
      isItemEqualToValue={(a: Skill, b: Skill) => a.id === b.id}
    >
      <ComboboxInput id={id} placeholder="Search the catalogue…" className="w-full" />
      <ComboboxContent>
        <ComboboxList>
          {(skill: Skill) => (
            <ComboboxItem key={skill.id} value={skill}>
              <span className="flex-1">{skill.name}</span>
              {skill.category ? (
                <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                  {skill.category}
                </span>
              ) : null}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>No match</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}
