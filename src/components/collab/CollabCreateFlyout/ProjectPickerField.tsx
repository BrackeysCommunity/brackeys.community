import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chonk } from "@/components/ui/chonk";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { itchImageUrl } from "@/lib/itch-image";
import { projectTypeLabel } from "@/lib/project-links";
import { orpc } from "@/orpc/client";

import { FieldRow } from "./fields";
import type { PickableProject } from "./shared";

interface ProjectPickerFieldProps {
  value: string | undefined;
  onChange: (project: PickableProject | null) => void;
  /** The TEAM step's pick, so that team's projects can lead the list. */
  selectedTeamId: string | undefined;
  /** Fired once when a pre-seeded `value` (deep link, edit restore)
   *  resolves to its row — the parent's chance to fill blank fields the
   *  way an explicit pick would have. */
  onSelectedResolved?: (project: PickableProject) => void;
}

const VISIBLE_RESULTS = 6;

/**
 * Optional "this post recruits for a project" link, backed by
 * `listEditableProjects` — the §1.3 editor union, so the pickable set
 * needs no new permission concept. The selected team's projects lead the
 * list; a post for something that doesn't exist yet simply skips this
 * and keeps the free-text name below.
 *
 * Picking is what turns the post card's art, name, and link into the
 * canonical row's — and what lets the project page advertise the post.
 */
export function ProjectPickerField({
  value,
  onChange,
  selectedTeamId,
  onSelectedResolved,
}: ProjectPickerFieldProps) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery({
    ...orpc.listEditableProjects.queryOptions({ input: {} }),
    staleTime: 60 * 1000,
  });

  const projectList = useMemo(() => (data?.projects ?? []) as PickableProject[], [data]);
  const selected = useMemo(
    () => projectList.find((p) => p.id === value) ?? null,
    [projectList, value],
  );

  // A deep link or an edit seeds `value` before the list exists; report
  // the resolved row upward exactly once per pick.
  const resolvedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selected || !onSelectedResolved) return;
    if (resolvedIdRef.current === selected.id) return;
    resolvedIdRef.current = selected.id;
    onSelectedResolved(selected);
  }, [selected, onSelectedResolved]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = q ? projectList.filter((p) => p.title.toLowerCase().includes(q)) : projectList;
    if (!selectedTeamId) return matches.slice(0, VISIBLE_RESULTS);
    // The selected team's projects first — the wizard's TEAM → PROJECT
    // step order is what makes this scoping natural.
    const ofTeam = matches.filter((p) => p.teamIds.includes(selectedTeamId));
    const rest = matches.filter((p) => !p.teamIds.includes(selectedTeamId));
    return [...ofTeam, ...rest].slice(0, VISIBLE_RESULTS);
  }, [projectList, search, selectedTeamId]);

  if (value !== undefined) {
    return (
      <FieldRow label="PROJECT PAGE" hint="optional">
        <Well variant="ghost" className="flex-row items-center gap-3 border-primary/30 p-2.5">
          <ProjectThumb project={selected} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Text size="sm" bold ellipsis>
              {selected?.title ?? "Your project"}
            </Text>
            <Text size="xs" variant="muted" className="tracking-widest uppercase">
              Post appears on the project page
            </Text>
          </div>
          {selected ? (
            <Badge variant="outline" size="label">
              {projectTypeLabel(selected)}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Unlink project"
            onClick={() => onChange(null)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </Button>
        </Well>
      </FieldRow>
    );
  }

  // Nothing to pick: the free-text fields below are the whole flow, and
  // an empty shelf saying so would only add noise.
  if (!isLoading && projectList.length === 0) return null;

  return (
    <FieldRow label="PROJECT PAGE" hint="optional · links the post to one of your projects">
      {projectList.length > VISIBLE_RESULTS ? (
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your projects…"
            className="pl-8"
          />
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : results.length === 0 ? (
        <Text size="xs" variant="muted">
          No projects match that search.
        </Text>
      ) : (
        <div className="flex flex-col gap-1.5">
          {results.map((project) => (
            <Chonk
              key={project.id}
              variant="surface"
              size="sm"
              render={<button type="button" onClick={() => onChange(project)} />}
              className="w-full items-center gap-3 p-2"
            >
              <ProjectThumb project={project} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Text as="span" size="sm" ellipsis>
                  {project.title}
                </Text>
                <Text as="span" size="xs" variant="muted" className="tracking-widest uppercase">
                  {projectTypeLabel(project)}
                </Text>
              </span>
            </Chonk>
          ))}
        </div>
      )}
    </FieldRow>
  );
}

function ProjectThumb({ project }: { project: PickableProject | null }) {
  return (
    <span className="block h-10 w-16 shrink-0 overflow-hidden border border-muted/40 bg-muted/30">
      {project?.imageUrl ? (
        <img
          src={itchImageUrl(project.imageUrl, { width: 192 })}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
