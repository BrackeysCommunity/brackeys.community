import { Add01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time-ago";
import { MicroLabel, Text } from "@/components/ui/typography";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { cn } from "@/lib/utils";

import {
  canvasScopesQueryOptions,
  PERSONAL_SCOPE,
  recentCanvasesQueryOptions,
  type CanvasScope,
} from "./canvas-queries";
import { NewCanvasDialog } from "./NewCanvasDialog";
import {
  closeWorkspace,
  setCreatingCanvas,
  setWorkspaceScope,
  workspaceStore,
} from "./workspace-store";

function toCanvasScope(scope: string): CanvasScope | undefined {
  if (scope === "all") return undefined;
  return scope === "personal" ? PERSONAL_SCOPE : { kind: "team", teamId: scope };
}

/**
 * The way between canvases from anywhere on the site: scope chips, the
 * member's recent canvases, and "New canvas". `/canvases` is the "browse
 * all" behind it.
 */
export function WorkspacePanel() {
  const { open, scope, creating } = useStore(workspaceStore);
  const isMobile = useIsMobile();
  const current = scope ?? "all";

  const scopes = useQuery({ ...canvasScopesQueryOptions(), enabled: open });
  const recent = useQuery({ ...recentCanvasesQueryOptions(toCanvasScope(current)), enabled: open });
  const teams = (scopes.data?.teams ?? []).filter((t) => !t.hidden);
  const teamName = (id: string) => teams.find((t) => t.teamId === id)?.name ?? "Team";

  const chips: { value: string; label: string }[] = [
    { value: "all", label: "Everything" },
    { value: "personal", label: "Personal" },
    ...teams.map((t) => ({ value: t.teamId, label: t.name })),
  ];

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(next) => (next ? undefined : closeWorkspace())}
        direction={isMobile ? "bottom" : "right"}
      >
        <DrawerContent className="p-0 sm:max-w-[24rem]">
          <DrawerTitle className="sr-only">Workspace</DrawerTitle>
          <DrawerDescription className="sr-only">
            Your recent canvases, across your personal space and your teams.
          </DrawerDescription>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <MicroLabel>WORKSPACE</MicroLabel>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Scope">
              {chips.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  aria-pressed={current === chip.value}
                  onClick={() => setWorkspaceScope(chip.value)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs",
                    current === chip.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <MicroLabel>RECENT</MicroLabel>
              {recent.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : recent.data?.length ? (
                <ul className="flex flex-col">
                  {recent.data.map((canvas) => (
                    <li key={canvas.id}>
                      <Link
                        to="/canvases/$canvasId"
                        params={{ canvasId: canvas.id }}
                        onClick={closeWorkspace}
                        className="flex flex-col rounded-md px-2 py-1.5 hover:bg-muted"
                      >
                        <Text as="span" size="sm" bold ellipsis>
                          {canvas.title}
                        </Text>
                        <Text as="span" size="xs" variant="muted" ellipsis>
                          {canvas.scope.kind === "team"
                            ? teamName(canvas.scope.teamId)
                            : "Personal"}{" "}
                          · <TimeAgo date={canvas.openedAt} />
                        </Text>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text as="p" size="xs" variant="muted" className="px-2 py-1.5">
                  Canvases you open show up here.
                </Text>
              )}
            </div>

            <Link
              to="/canvases"
              search={{ scope: current === "all" ? undefined : current }}
              onClick={closeWorkspace}
              className="flex items-center gap-1 self-start text-xs text-primary hover:underline"
            >
              Browse all
              <HugeiconsIcon icon={ArrowRight01Icon} size={12} />
            </Link>
          </div>
          <div className="border-t border-border p-4">
            <Button className="w-full" onClick={() => setCreatingCanvas(true)}>
              <HugeiconsIcon icon={Add01Icon} size={14} />
              New canvas
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
      {creating ? (
        <NewCanvasDialog
          open
          onClose={() => {
            setCreatingCanvas(false);
            closeWorkspace();
          }}
          scope={toCanvasScope(current)}
        />
      ) : null}
    </>
  );
}
