import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import { client, orpc } from "@/orpc/client";

export const Route = createFileRoute("/teams/")({
  component: TeamsIndex,
});

/**
 * Landing for /teams — the viewer's own teams plus a create affordance.
 * Deliberately not a public directory: that's a later phase, once there
 * are enough teams that a browsable lane doesn't look dead on arrival.
 */
function TeamsIndex() {
  const { session, isPending } = useStore(authStore);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const queryOptions = orpc.listMyTeams.queryOptions({ input: {} });
  const { data: myTeams, isLoading } = useQuery({ ...queryOptions, enabled: !!session?.user });

  const [name, setName] = useState("");
  const createMutation = useMutation({
    mutationFn: () => client.createTeam({ name: name.trim() }),
    onSuccess: (team) => {
      void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
      void navigate({ to: "/teams/$teamId", params: { teamId: team.slug } });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Heading as="h1" className="text-xl tracking-widest uppercase">
          Teams
        </Heading>
        <Text size="sm" variant="muted">
          A home page for your crew — showcase shipped work, keep a roster, and recruit from one
          place.
        </Text>
      </div>

      {!session?.user ? (
        <Well variant="ghost" className="items-start gap-3 p-5">
          <Text size="sm" variant="muted">
            Sign in to see your teams or start one.
          </Text>
          <Button size="sm" disabled={isPending} onClick={() => signInWithDiscord()}>
            SIGN IN WITH DISCORD
          </Button>
        </Well>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="border-b border-dashed border-muted-foreground/25 pb-1.5">
              <MicroLabel>YOUR TEAMS</MicroLabel>
            </div>
            {isLoading ? (
              <Text size="xs" variant="muted" className="animate-pulse tracking-widest uppercase">
                Loading…
              </Text>
            ) : (myTeams?.length ?? 0) === 0 ? (
              <Text size="sm" variant="muted">
                You're not on any team yet. Create one below, or get invited to one.
              </Text>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {myTeams!.map((team) => (
                  <Link
                    key={team.id}
                    to="/teams/$teamId"
                    params={{ teamId: team.slug || team.id }}
                    className="flex items-center gap-3 border border-muted/40 bg-card/40 p-3 transition-colors hover:border-primary/50 hover:bg-muted/10"
                  >
                    <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={36} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <Text as="span" size="sm" bold ellipsis>
                        {team.name}
                      </Text>
                      <Text as="span" size="xs" variant="muted" className="tracking-widest">
                        /{team.slug}
                      </Text>
                    </span>
                    {team.role === "owner" ? <MicroLabel>OWNER</MicroLabel> : null}
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="border-b border-dashed border-muted-foreground/25 pb-1.5">
              <MicroLabel>START A TEAM</MicroLabel>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Team name"
                maxLength={100}
                className="min-w-56 flex-1 sm:max-w-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim().length >= 2) createMutation.mutate();
                }}
              />
              <Button
                size="sm"
                disabled={name.trim().length < 2 || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? "CREATING…" : "CREATE"}
              </Button>
            </div>
            {createMutation.isError ? (
              <Text size="xs" className="text-destructive">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : "Could not create the team."}
              </Text>
            ) : null}
            <Text size="xs" variant="muted">
              A name is all it takes — everything else can be filled in from the team page.
            </Text>
          </section>
        </>
      )}
    </div>
  );
}
