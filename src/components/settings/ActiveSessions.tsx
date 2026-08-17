import { ComputerIcon, SmartPhone01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openConfirmModal } from "@/components/ui/confirm";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { authClient } from "@/lib/auth-client";
import { timeAgo } from "@/lib/format-time";
import { describeUserAgent } from "@/lib/user-agent";

/**
 * Every browser currently holding a session, straight off better-auth's
 * session table. Revoking one signs that browser out on its next request;
 * the row for *this* browser is marked and can't be revoked from here —
 * that's what the sign-out button is for.
 */
export function ActiveSessions() {
  const queryClient = useQueryClient();
  const queryKey = ["auth", "sessions"];
  const { data: current } = authClient.useSession();

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await authClient.listSessions();
      if (error) throw new Error(error.message ?? "Could not load sessions");
      return data;
    },
  });

  const { mutate: revoke, isPending: revoking } = useMutation({
    mutationFn: async (token: string) => {
      const { error } = await authClient.revokeSession({ token });
      if (error) throw new Error(error.message ?? "Could not sign that device out");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      toast.success("Signed that device out");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { mutate: revokeOthers, isPending: revokingOthers } = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.revokeOtherSessions();
      if (error) throw new Error(error.message ?? "Could not sign the other devices out");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      toast.success("Signed every other device out");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const sessions = [...(data ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const currentToken = current?.session.token;
  const others = sessions.filter((s) => s.token !== currentToken);

  return (
    <div className="flex flex-col gap-3">
      {sessions.map((session) => {
        const device = describeUserAgent(session.userAgent);
        const isCurrent = session.token === currentToken;

        return (
          <Well key={session.id} className="flex-row flex-wrap items-center gap-4 p-4">
            <HugeiconsIcon
              icon={device.kind === "mobile" ? SmartPhone01Icon : ComputerIcon}
              size={18}
              className="text-muted-foreground"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Text size="xs" className="tracking-widest uppercase">
                  {device.label}
                </Text>
                {isCurrent ? (
                  <Badge size="label" variant="outline">
                    THIS DEVICE
                  </Badge>
                ) : null}
              </div>
              <Text size="xs" variant="muted">
                {/* The IP is the one better-auth recorded at sign-in, not a
                    live one — say "from", not "at". */}
                Signed in {timeAgo(session.createdAt)}
                {session.ipAddress ? ` from ${session.ipAddress}` : ""} · expires{" "}
                {new Date(session.expiresAt).toLocaleDateString()}
              </Text>
            </div>

            {isCurrent ? null : (
              <Button
                variant="outline"
                size="sm"
                className="tracking-widest text-destructive"
                disabled={revoking || revokingOthers}
                onClick={() => revoke(session.token)}
              >
                SIGN OUT
              </Button>
            )}
          </Well>
        );
      })}

      {others.length > 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="self-start tracking-widest"
          disabled={revokingOthers}
          onClick={async () => {
            const ok = await openConfirmModal({
              title: "Sign out everywhere else?",
              message: `${others.length} other ${
                others.length === 1 ? "device stays" : "devices stay"
              } signed in. This one is unaffected.`,
              confirmText: "Sign them out",
              variant: "destructive",
            });
            if (ok) revokeOthers();
          }}
        >
          SIGN OUT OTHER DEVICES
        </Button>
      ) : null}
    </div>
  );
}
