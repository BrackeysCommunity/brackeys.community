import { DashboardSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { useFlag } from "@/lib/hooks/use-flag";

import { canvasScopesQueryOptions, PERSONAL_SCOPE, useOpenJamPlan } from "./canvas-queries";

/**
 * "Plan this jam": opens the chosen scope's plan canvas for the jam, making
 * it the first time with the jam's card and deadline on it.
 */
export function JamPlanButton({ jamId }: { jamId: number }) {
  const canvasesOn = useFlag("canvases-enabled");
  const { data: session } = authClient.useSession();
  const signedIn = canvasesOn && session?.user != null;
  const { data: scopes } = useQuery({ ...canvasScopesQueryOptions(), enabled: signedIn });
  const open = useOpenJamPlan();
  if (!signedIn) return null;

  const teams = (scopes?.teams ?? []).filter((t) => t.status === "active" && !t.hidden);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={open.isPending}
        render={
          <Button
            size="sm"
            variant="outline"
            className="tracking-widest"
            tooltip="A canvas to plan this jam on"
          />
        }
      >
        <HugeiconsIcon icon={DashboardSquare02Icon} size={13} />
        PLAN THIS JAM
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Put it in</DropdownMenuLabel>
          {teams.map((team) => (
            <DropdownMenuItem
              key={team.teamId}
              onClick={() => open.mutate({ jamId, scope: { kind: "team", teamId: team.teamId } })}
            >
              {team.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => open.mutate({ jamId, scope: PERSONAL_SCOPE })}>
            Personal
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
