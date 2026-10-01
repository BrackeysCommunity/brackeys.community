import { Add01Icon, Delete02Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time-ago";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { authClient, signInWithDiscord } from "@/lib/auth-client";
import { folderTree, type FolderNode } from "@/lib/canvas/paths";
import { cn } from "@/lib/utils";

import {
  canvasListQueryOptions,
  canvasScopesQueryOptions,
  PERSONAL_SCOPE,
  useRestoreCanvas,
  type CanvasListItem,
  type CanvasScope,
} from "./canvas-queries";
import { CanvasCardLink } from "./CanvasCardLink";
import { NewCanvasDialog } from "./NewCanvasDialog";

function scopeFromParam(param: string | undefined): CanvasScope {
  return param && param !== "personal" ? { kind: "team", teamId: param } : PERSONAL_SCOPE;
}

function scopeParam(scope: CanvasScope): string {
  return scope.kind === "team" ? scope.teamId : "personal";
}

function FolderList({
  node,
  selected,
  onSelect,
  depth = 0,
}: {
  node: FolderNode<CanvasListItem>;
  selected: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return node.folders.map((folder) => (
    <li key={folder.path}>
      <button
        type="button"
        onClick={() => onSelect(folder.path)}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs",
          selected === folder.path
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <HugeiconsIcon icon={Folder01Icon} size={13} className="shrink-0" />
        <span className="truncate">{folder.name}</span>
      </button>
      {folder.folders.length ? (
        <ul>
          <FolderList node={folder} selected={selected} onSelect={onSelect} depth={depth + 1} />
        </ul>
      ) : null}
    </li>
  ));
}

/**
 * Every canvas in one scope, as its folders. Reached from the workspace
 * panel and the avatar menu; there's no header nav slot.
 */
export function CanvasesBrowsePage({
  scopeParam: param,
  view,
  onChange,
}: {
  scopeParam?: string;
  view: "canvases" | "deleted";
  onChange: (search: { scope?: string; view?: "canvases" | "deleted" }) => void;
}) {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const signedIn = session?.user != null;
  const scope = scopeFromParam(param);
  const [folder, setFolder] = useState("");
  const [creating, setCreating] = useState(false);
  const restore = useRestoreCanvas();

  const { data: scopes } = useQuery({ ...canvasScopesQueryOptions(), enabled: signedIn });
  const list = useQuery({
    ...canvasListQueryOptions(scope, {
      deleted: view === "deleted",
      thumbnails: view === "canvases",
    }),
    enabled: signedIn,
  });

  const tree = useMemo(() => folderTree(list.data ?? []), [list.data]);
  const shown = (list.data ?? []).filter((c) => !folder || c.path.startsWith(`${folder}/`));
  const team = scope.kind === "team" ? scopes?.teams.find((t) => t.teamId === scope.teamId) : null;
  const scopeName = scope.kind === "team" ? (team?.name ?? "Team") : "Personal";

  if (!sessionPending && !signedIn) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
        <Heading as="h1" size="xl">
          Canvases
        </Heading>
        <Text variant="muted">Sign in to plan your jams on canvases, alone or with your team.</Text>
        <Button onClick={() => void signInWithDiscord("canvases")}>Sign in with Discord</Button>
      </div>
    );
  }

  const scopeButton = (target: CanvasScope, label: string) => {
    const active = scopeParam(target) === scopeParam(scope) && view === "canvases";
    return (
      <li key={scopeParam(target)}>
        <button
          type="button"
          onClick={() => {
            setFolder("");
            onChange({ scope: scopeParam(target), view: "canvases" });
          }}
          className={cn(
            "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm",
            active
              ? "bg-muted font-bold text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="truncate">{label}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:grid lg:grid-cols-[14rem_1fr] lg:gap-10">
      <nav aria-label="Scopes" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <MicroLabel>SCOPES</MicroLabel>
          <ul className="flex flex-col">
            {scopeButton(PERSONAL_SCOPE, "Personal")}
            {(scopes?.teams ?? []).map((t) =>
              scopeButton({ kind: "team", teamId: t.teamId }, t.name),
            )}
          </ul>
        </div>
        {view === "canvases" && tree.folders.length ? (
          <div className="flex flex-col gap-1">
            <MicroLabel>FOLDERS</MicroLabel>
            <ul className="flex flex-col">
              <li>
                <button
                  type="button"
                  onClick={() => setFolder("")}
                  className={cn(
                    "w-full rounded-md px-2 py-1 text-left text-xs",
                    folder === ""
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Everything
                </button>
              </li>
              <FolderList node={tree} selected={folder} onSelect={setFolder} />
            </ul>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => onChange({ scope: scopeParam(scope), view: "deleted" })}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs",
            view === "deleted"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <HugeiconsIcon icon={Delete02Icon} size={13} />
          Recently deleted
        </button>
      </nav>

      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <MicroLabel>{view === "deleted" ? "RECENTLY DELETED" : "CANVASES"}</MicroLabel>
            <Heading as="h1" size="xl" ellipsis>
              {scopeName}
              {folder ? ` / ${folder}` : ""}
            </Heading>
          </div>
          {view === "canvases" ? (
            <Button onClick={() => setCreating(true)}>
              <HugeiconsIcon icon={Add01Icon} size={14} />
              New canvas
            </Button>
          ) : null}
        </div>

        {list.isPending ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-[16/12] w-full rounded-lg" />
            ))}
          </div>
        ) : list.isError ? (
          <Text variant="muted">This scope isn't available to you.</Text>
        ) : view === "deleted" ? (
          shown.length ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {shown.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Text as="span" size="sm" bold ellipsis>
                      {c.path}
                    </Text>
                    <Text as="span" size="xs" variant="muted">
                      Deleted <TimeAgo date={c.deletedAt} />
                    </Text>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate(c.id)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <Text variant="muted">Nothing deleted in the last 30 days.</Text>
          )
        ) : shown.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((c) => (
              <CanvasCardLink key={c.id} canvas={c} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-6">
            <Text variant="muted">No canvases here yet.</Text>
            <Button variant="outline" onClick={() => setCreating(true)}>
              Start one
            </Button>
          </div>
        )}
      </section>

      {creating ? (
        <NewCanvasDialog open onClose={() => setCreating(false)} scope={scope} folder={folder} />
      ) : null}
    </div>
  );
}
