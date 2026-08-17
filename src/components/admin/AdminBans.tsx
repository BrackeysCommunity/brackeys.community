import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AdminEmpty, AdminRow, AdminSection, errText } from "@/components/admin/AdminUI";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { timeAgo } from "@/lib/format-time";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

/**
 * Ban / unban. Staff can see the list; acting is admin-only (the endpoints
 * enforce this — the UI just doesn't offer buttons it knows will 403).
 * A banned account browses as anonymous and every write is refused.
 */
export function AdminBans({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<{ id: string; displayName: string } | null>(null);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const bans = useQuery(orpc.listBans.queryOptions({}));
  const results = useQuery({
    ...orpc.searchProfiles.queryOptions({ input: { search: search.trim() } }),
    enabled: isAdmin && search.trim().length >= 2,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orpc.listBans.key() });

  const ban = useMutation({
    mutationFn: (input: { userId: string; reason: string }) => client.banUser(input),
    onSuccess: () => {
      setTarget(null);
      setReason("");
      setSearch("");
      invalidate();
    },
    onError: (err) => toast.error(errText(err)),
  });
  const unban = useMutation({
    mutationFn: (userId: string) => client.unbanUser({ userId }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errText(err)),
  });

  const bannedIds = new Set((bans.data ?? []).map((b) => b.userId));

  return (
    <section className="flex flex-col gap-4">
      {isAdmin && (
        <div className="flex flex-col gap-2">
          <MicroLabel>BAN A MEMBER</MicroLabel>
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setTarget(null);
            }}
            placeholder="Search members by name…"
          />
          {search.trim().length >= 2 && !target && (
            <div className="flex flex-col gap-1">
              {(results.data ?? [])
                .filter((r) => !bannedIds.has(r.id))
                .map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => setTarget({ id: result.id, displayName: result.displayName })}
                    className="flex items-center gap-2 rounded-md p-2 text-left hover:bg-muted/50"
                  >
                    <UserAvatar
                      avatarUrl={result.avatarUrl}
                      username={result.displayName}
                      size={24}
                    />
                    <Text size="sm">{result.displayName}</Text>
                  </button>
                ))}
            </div>
          )}
          {target && (
            <Well className="gap-3 p-4">
              <Text size="sm">
                Banning <span className="font-medium">{target.displayName}</span>. Their sessions
                are revoked immediately; they browse as a visitor and every write is refused.
              </Text>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (kept on the record, shown to staff only)"
                maxLength={1000}
                rows={2}
              />
              <div className="flex items-center gap-2">
                <Confirm
                  title={`Ban ${target.displayName}?`}
                  message="The most consequential action in the system. It can be undone here."
                  confirmText="Ban member"
                  variant="destructive"
                  onConfirm={async () => {
                    await ban.mutateAsync({ userId: target.id, reason: reason.trim() });
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
                  Cancel
                </Button>
              </div>
            </Well>
          )}
        </div>
      )}

      <AdminSection title="Active bans" count={bans.isPending ? undefined : bans.data?.length}>
        {bans.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (bans.data?.length ?? 0) === 0 ? (
          <AdminEmpty>Nobody is banned.</AdminEmpty>
        ) : (
          <div className="flex flex-col gap-2">
            {bans.data?.map((entry) => (
              <AdminRow key={entry.userId} className="flex-row items-center gap-3">
                <UserAvatar
                  avatarUrl={entry.user.avatarUrl}
                  username={entry.user.displayName}
                  size={28}
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <Text size="sm" className="font-medium">
                    {entry.user.displayName}
                  </Text>
                  <Text size="xs" variant="muted">
                    banned {entry.bannedAt ? timeAgo(entry.bannedAt) : "—"}
                    {entry.bannedBy ? ` by ${entry.bannedBy.displayName}` : ""}
                    {entry.banReason ? ` — ${entry.banReason}` : ""}
                  </Text>
                </div>
                {isAdmin && (
                  <Confirm
                    title={`Unban ${entry.user.displayName}?`}
                    message="They can sign in and participate again."
                    confirmText="Unban"
                    onConfirm={async () => {
                      await unban.mutateAsync(entry.userId);
                    }}
                  >
                    <Button variant="outline" size="xs" disabled={unban.isPending}>
                      Unban
                    </Button>
                  </Confirm>
                )}
              </AdminRow>
            ))}
          </div>
        )}
      </AdminSection>
    </section>
  );
}
