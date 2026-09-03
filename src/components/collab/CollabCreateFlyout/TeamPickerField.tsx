import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { errorMessage } from "@/lib/error-message";
import { reportMutationError } from "@/lib/product-insights";
import { client, orpc } from "@/orpc/client";

import { CrewCreateInline } from "./CrewCreateInline";
import { FieldRow } from "./fields";

/**
 * Pick-or-quick-create a team, backed by `listMyTeams`. Renders in the
 * post page's STRENGTHEN panel (attach a crew to a live post) and in the
 * accept-time USE AN EXISTING TEAM choice.
 */
export function TeamPickerField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (teamId: string | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const queryOptions = orpc.listMyTeams.queryOptions({ input: {} });
  const { data: allMyTeams, isLoading } = useQuery(queryOptions);
  // Hidden (under-review) teams aren't linkable to posts.
  const myTeams = allMyTeams?.filter((t) => !t.hidden);

  const [creating, setCreating] = useState(false);

  const createMutation = useMutation({
    mutationFn: (name: string) => client.createTeam({ name }),
    onSuccess: (team) => {
      void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
      onChange(team.id);
      setCreating(false);
    },
    onError: (err) => reportMutationError(err, "team.create"),
  });

  const selected = myTeams?.find((t) => t.id === value) ?? null;

  // The picked team renders as the choice, not the list — same idiom as
  // the jam picker above it.
  if (value !== undefined) {
    return (
      <FieldRow label="TEAM PAGE">
        <Well variant="ghost" className="flex-row items-center gap-3 border-primary/30 p-2.5">
          <UserAvatar avatarUrl={selected?.avatarUrl ?? null} username={selected?.name} size={32} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Text size="sm" bold ellipsis>
              {selected?.name ?? "Your team"}
            </Text>
            <Text size="xs" variant="muted" className="tracking-widest uppercase">
              Post appears on the team page
            </Text>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Unlink team"
            title="Unlink team"
            onClick={() => onChange(undefined)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </Button>
        </Well>
      </FieldRow>
    );
  }

  return (
    <FieldRow label="TEAM PAGE" hint="pick or create the team behind this post">
      {isLoading ? null : (
        <div className="flex flex-col gap-1.5">
          {(myTeams ?? []).map((team) => (
            <Chonk
              key={team.id}
              variant="surface"
              size="sm"
              render={<button type="button" onClick={() => onChange(team.id)} />}
              className="w-full items-center gap-3 p-2"
            >
              <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={28} />
              <Text as="span" size="sm" ellipsis className="min-w-0 flex-1">
                {team.name}
              </Text>
            </Chonk>
          ))}

          {creating ? (
            <CrewCreateInline
              submitLabel="CREATE"
              pending={createMutation.isPending}
              error={
                createMutation.isError
                  ? errorMessage(createMutation.error, "Could not create the team.")
                  : null
              }
              onSubmit={(name) => createMutation.mutate(name)}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setCreating(true)}
            >
              {(myTeams?.length ?? 0) > 0 ? "+ NEW TEAM PAGE" : "+ CREATE A TEAM PAGE"}
            </Button>
          )}
        </div>
      )}
    </FieldRow>
  );
}
