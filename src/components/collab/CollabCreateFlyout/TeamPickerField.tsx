import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { client, orpc } from "@/orpc/client";

import { FieldRow } from "./fields";

/**
 * Pick-or-quick-create a team, backed by `listMyTeams`. Since the
 * wizard grew a dedicated TEAM step this renders only in the
 * accept-time link flow for legacy unlinked posts
 * (`CollabPostResponseList`) — new team posts link at create.
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
  const { data: myTeams, isLoading } = useQuery(queryOptions);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const createMutation = useMutation({
    mutationFn: (name: string) => client.createTeam({ name }),
    onSuccess: (team) => {
      void queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
      onChange(team.id);
      setCreating(false);
      setNewName("");
    },
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
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Team name"
                maxLength={100}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (newName.trim().length >= 2) createMutation.mutate(newName.trim());
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={newName.trim().length < 2 || createMutation.isPending}
                onClick={() => createMutation.mutate(newName.trim())}
              >
                {createMutation.isPending ? "…" : "CREATE"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
                CANCEL
              </Button>
            </div>
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
          {createMutation.isError ? (
            <Text size="xs" className="text-destructive">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : "Could not create the team."}
            </Text>
          ) : null}
        </div>
      )}
    </FieldRow>
  );
}
