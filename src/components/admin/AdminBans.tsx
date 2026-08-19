import { UserBlock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  AdminEmpty,
  AdminPager,
  AdminPerson,
  AdminPersonLink,
  AdminRow,
  AdminSection,
  Field,
  errText,
} from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchField } from "@/components/ui/search-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { BAN_DURATIONS } from "@/lib/ban-state";
import { timeAgo } from "@/lib/format-time";
import { formatCountdown } from "@/lib/jam-countdown";
import { profileLinkParams } from "@/lib/profile-links";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

type BanEntry = Awaited<ReturnType<typeof client.listBans>>[number];
type Candidate = Awaited<ReturnType<typeof client.searchMembers>>["results"][number];

const PAGE_SIZE = 8;

/** A permanent ban has no day count; the select still needs a value for it. */
const PERMANENT = "permanent";
const durationValue = (days: number | null) => (days == null ? PERMANENT : String(days));

/** Ban / unban. Staff see the list; acting is admin-only, enforced server-side. */
export function AdminBans({ isAdmin }: { isAdmin: boolean }) {
  const [picking, setPicking] = useState(false);
  const queryClient = useQueryClient();

  const bans = useQuery(orpc.listBans.queryOptions({}));
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orpc.listBans.key() });

  const unban = useMutation({
    mutationFn: (userId: string) => client.unbanUser({ userId }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errText(err)),
  });

  const active = (bans.data ?? []).filter((entry) => entry.isActive);
  const lifted = (bans.data ?? []).filter((entry) => !entry.isActive);

  return (
    <section className="flex flex-col gap-8">
      <AdminSection
        title="Active bans"
        count={bans.isPending ? undefined : active.length}
        hint="A banned account browses as a visitor and every write is refused. They see a suspension notice explaining why."
        actions={
          isAdmin ? (
            <Button size="sm" variant="destructive" onClick={() => setPicking(true)}>
              <HugeiconsIcon icon={UserBlock01Icon} size={13} data-icon="inline-start" />
              Ban a member
            </Button>
          ) : null
        }
      >
        {bans.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : active.length === 0 ? (
          <AdminEmpty>Nobody is banned.</AdminEmpty>
        ) : (
          <div className="flex flex-col gap-2">
            {active.map((entry) => (
              <BanRow
                key={entry.userId}
                entry={entry}
                isAdmin={isAdmin}
                onUnban={() => unban.mutateAsync(entry.userId)}
                unbanPending={unban.isPending}
              />
            ))}
          </div>
        )}
      </AdminSection>

      <AdminSection
        title="Previous bans"
        count={bans.isPending ? undefined : lifted.length}
        hint="Lifted or expired. Kept because “has this person been banned before, and why” is the question a ban list exists to answer."
      >
        {bans.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : lifted.length === 0 ? (
          <AdminEmpty>Nobody has been unbanned yet.</AdminEmpty>
        ) : (
          <div className="flex flex-col gap-2">
            {lifted.map((entry) => (
              <BanRow key={entry.userId} entry={entry} isAdmin={false} />
            ))}
          </div>
        )}
      </AdminSection>

      {isAdmin && (
        <BanDialog
          open={picking}
          onOpenChange={setPicking}
          onBanned={() => {
            setPicking(false);
            invalidate();
          }}
        />
      )}
    </section>
  );
}

function BanRow({
  entry,
  isAdmin,
  onUnban,
  unbanPending,
}: {
  entry: BanEntry;
  isAdmin: boolean;
  onUnban?: () => Promise<unknown>;
  unbanPending?: boolean;
}) {
  const remaining = formatCountdown(entry.bannedUntil);

  return (
    <AdminRow className="flex-row items-center gap-3" muted={!entry.isActive}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <AdminPerson user={entry.user} name={entry.user.displayName} />
          {entry.isActive ? (
            <Badge size="label" variant="outline">
              {entry.bannedUntil == null
                ? "PERMANENT"
                : remaining?.past
                  ? "EXPIRED"
                  : `${remaining?.text ?? ""} LEFT`}
            </Badge>
          ) : (
            <Badge size="label" variant="outline">
              {entry.unbannedAt ? "LIFTED" : "EXPIRED"}
            </Badge>
          )}
        </div>
        <Text size="xs" variant="muted">
          banned {entry.bannedAt ? timeAgo(entry.bannedAt) : "—"}
          {entry.bannedBy ? " by " : " by the guild gate"}
          {entry.bannedBy ? (
            <AdminPersonLink user={entry.bannedBy}>{entry.bannedBy.displayName}</AdminPersonLink>
          ) : null}
          {entry.unbannedAt ? ` · lifted ${timeAgo(entry.unbannedAt)}` : ""}
          {entry.banReason ? ` — ${entry.banReason}` : ""}
        </Text>
      </div>
      {isAdmin && onUnban && (
        <Confirm
          title={`Unban ${entry.user.displayName}?`}
          message="They can sign in and participate again. The record of this ban stays."
          confirmText="Unban"
          onConfirm={async () => {
            await onUnban();
          }}
        >
          <Button variant="outline" size="xs" disabled={unbanPending}>
            Unban
          </Button>
        </Confirm>
      )}
    </AdminRow>
  );
}

/** Search, then confirm against a card. */
function BanDialog({
  open,
  onOpenChange,
  onBanned,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onBanned: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<Candidate | null>(null);
  const [reason, setReason] = useState("");
  const [durationDays, setDurationDays] = useState<number | null>(null);

  const term = search.trim();
  const results = useQuery({
    ...orpc.searchMembers.queryOptions({ input: { search: term, page, pageSize: PAGE_SIZE } }),
    enabled: open && term.length >= 2,
  });

  const reset = () => {
    setSearch("");
    setPage(1);
    setTarget(null);
    setReason("");
    setDurationDays(null);
  };

  const ban = useMutation({
    mutationFn: (input: { userId: string; reason: string; durationDays: number | null }) =>
      client.banUser(input),
    onSuccess: () => {
      reset();
      onBanned();
    },
    onError: (err) => toast.error(errText(err)),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="tracking-widest uppercase">Ban a member</DialogTitle>
          <DialogDescription>
            Find the person, check the card, then say why and for how long.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <SearchField
            value={search}
            onChange={(next) => {
              setSearch(next);
              setPage(1);
              setTarget(null);
            }}
            placeholder="Name, handle, or member id…"
          />

          {target ? (
            <TargetCard target={target} onClear={() => setTarget(null)} />
          ) : term.length < 2 ? (
            <Text size="xs" variant="muted">
              Two characters to search. Ids and Discord ids match exactly.
            </Text>
          ) : results.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (results.data?.results.length ?? 0) === 0 ? (
            <AdminEmpty>Nobody matches that.</AdminEmpty>
          ) : (
            <div className="flex flex-col gap-1">
              {results.data?.results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => setTarget(result)}
                  disabled={result.isBanned}
                  className="flex items-center gap-2 rounded-md p-2 text-left hover:bg-muted/50 disabled:opacity-50"
                >
                  <UserAvatar
                    avatarUrl={result.avatarUrl}
                    username={result.displayName}
                    size={24}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Text size="sm" ellipsis>
                      {result.displayName}
                    </Text>
                    <MicroLabel as="span" ellipsis>
                      {result.handle ?? result.id}
                    </MicroLabel>
                  </span>
                  {result.isBanned ? (
                    <Badge size="label" variant="outline">
                      BANNED
                    </Badge>
                  ) : result.wasBanned ? (
                    <Badge size="label" variant="outline">
                      PRIOR BAN
                    </Badge>
                  ) : null}
                </button>
              ))}
              <AdminPager
                page={page}
                pageCount={results.data?.pageCount ?? 1}
                total={results.data?.total ?? 0}
                pageSize={results.data?.pageSize ?? PAGE_SIZE}
                unit="members"
                onPage={setPage}
              />
            </div>
          )}

          {target && (
            <>
              <Field label="How long" htmlFor="ban-duration">
                <Select
                  value={durationValue(durationDays)}
                  onValueChange={(next) =>
                    setDurationDays(next === PERMANENT ? null : Number(next))
                  }
                >
                  <SelectTrigger id="ban-duration" className="w-full">
                    {/* Base UI reads labels off mounted items, so resolve it here. */}
                    <SelectValue>
                      {BAN_DURATIONS.find((entry) => entry.days === durationDays)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {BAN_DURATIONS.map((entry) => (
                      <SelectItem key={entry.label} value={durationValue(entry.days)}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Reason" htmlFor="ban-reason">
                <Textarea
                  id="ban-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Kept on the record — and shown to them on the suspension screen."
                  maxLength={1000}
                  rows={3}
                />
              </Field>

              <div className="flex items-center gap-2">
                <Confirm
                  title={`Ban ${target.displayName}?`}
                  message={`${target.handle ?? target.id} — ${
                    durationDays == null ? "permanently" : `for ${durationDays} days`
                  }. The most consequential action in the system. It can be undone here.`}
                  confirmText="Ban member"
                  variant="destructive"
                  onConfirm={async () => {
                    await ban.mutateAsync({
                      userId: target.id,
                      reason: reason.trim(),
                      durationDays,
                    });
                  }}
                >
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={reason.trim().length === 0 || ban.isPending}
                  >
                    Ban member
                  </Button>
                </Confirm>
                <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
                  Pick someone else
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Members with similar nicknames share a default avatar; the handle, id and
 * join date are what tell them apart. */
function TargetCard({ target, onClear }: { target: Candidate; onClear: () => void }) {
  return (
    <Well className="flex-row items-start gap-3 p-4">
      <UserAvatar avatarUrl={target.avatarUrl} username={target.displayName} size={48} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Text size="sm" className="font-medium">
          {target.displayName}
        </Text>
        <MicroLabel ellipsis>{target.handle ?? "NO HANDLE"}</MicroLabel>
        <MicroLabel ellipsis>ID {target.id}</MicroLabel>
        <Text size="xs" variant="muted">
          member since {target.memberSince ? timeAgo(target.memberSince) : "—"}
          {target.guildJoinedAt ? ` · in the guild since ${timeAgo(target.guildJoinedAt)}` : ""}
        </Text>
        {target.wasBanned ? (
          <Text size="xs" variant="danger">
            Banned before — {target.bannedAt ? timeAgo(target.bannedAt) : "—"}
            {target.banReason ? `: ${target.banReason}` : ""}
          </Text>
        ) : null}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="xs"
            nativeButton={false}
            render={
              <Link
                to="/profile/$userId"
                params={profileLinkParams(target)}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Open profile
          </Button>
          <Button variant="ghost" size="xs" onClick={onClear}>
            Not them
          </Button>
        </div>
      </div>
    </Well>
  );
}
