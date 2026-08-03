import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { collabStore } from "@/lib/collab-store";
import { formatRate } from "@/lib/format-rate";
import { formatJamShortDates } from "@/lib/jam-countdown";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { FieldRow } from "./fields";
import { useWizardForm } from "./form-context";
import { type AnyFormStore, CONTACT_TYPE_LABELS, getPreflightChecks, POST_TYPES } from "./shared";

/**
 * Step 04 — pre-flight checklist + compact post preview. The checklist
 * mirrors the submit requirements exactly, so 100% and "NEXT works" are
 * the same statement.
 */
export function StepReview() {
  const form = useWizardForm();
  const v = useStore(form.store, (s: AnyFormStore) => s.values);
  const { data: roles } = useQuery({ ...orpc.listCollabRoles.queryOptions({ input: {} }) });
  const { data: allSkills } = useQuery({ ...orpc.listSkills.queryOptions({ input: {} }) });
  const { data: jamData } = useQuery({
    ...orpc.listJams.queryOptions({ input: { filter: "board", limit: 500 } }),
    enabled: v.jamId !== undefined,
    staleTime: 5 * 60 * 1000,
  });
  const { data: myTeams } = useQuery({
    ...orpc.listMyTeams.queryOptions({ input: {} }),
    enabled: v.teamId !== undefined,
  });

  const editingLegacyUnlinked = useStore(collabStore, (s) => s.wizard.editingLegacyUnlinked);

  const selectedRoles = roles?.filter((r) => v.roleIds.includes(r.id)) ?? [];
  const selectedSkills = allSkills?.filter((s) => v.skillIds.includes(s.id)) ?? [];
  const jam = jamData?.jams.find((j) => j.jamId === v.jamId) ?? null;
  const team = myTeams?.find((t) => t.id === v.teamId) ?? null;
  // The TEAM step's quick-create — the team doesn't exist yet, so the
  // review renders the name the submit will mint.
  const pendingTeamName = !v.isIndividual && v.teamId === undefined ? v.newTeamName.trim() : "";

  const compDisplay = formatRate(v.compensationType, v.compensationMin, v.compensationMax);
  const postTypeIcon = POST_TYPES.find((t) => t.value === v.type)?.icon;

  const checks = getPreflightChecks(v, { legacyUnlinkedEdit: editingLegacyUnlinked });
  const completed = checks.filter((c) => c.ok).length;
  const percent = Math.round((completed / checks.length) * 100);

  return (
    <div className="flex flex-col gap-5">
      <FieldRow label="LIVE PREVIEW" hint="how it appears on the board">
        <Well variant="ghost" className="gap-3 border-primary/30 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            {postTypeIcon ? (
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border border-primary/40 bg-primary/10">
                <HugeiconsIcon icon={postTypeIcon} size={14} className="text-primary/70" />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Text size="sm" bold>
                {v.title || (
                  <Text as="span" variant="muted" className="italic">
                    Your post title appears here
                  </Text>
                )}
              </Text>
              <div className="flex flex-wrap gap-1.5">
                {v.type ? (
                  <Badge variant="secondary" size="label" className="uppercase">
                    {v.type}
                  </Badge>
                ) : null}
                {v.isIndividual ? (
                  <Badge variant="outline" size="label" className="uppercase">
                    Solo dev
                  </Badge>
                ) : null}
                {team ? (
                  <Badge variant="outline" size="label" className="uppercase">
                    {team.name}
                  </Badge>
                ) : pendingTeamName ? (
                  <Badge variant="outline" size="label" className="uppercase">
                    {pendingTeamName}
                  </Badge>
                ) : null}
                {jam ? (
                  <Badge variant="warning" size="label" className="uppercase">
                    {jam.title}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
          {v.description ? (
            <Text size="sm" variant="muted" className="line-clamp-3 whitespace-pre-wrap">
              {v.description}
            </Text>
          ) : (
            <Text size="sm" variant="muted" className="italic">
              Your one-line pitch will appear here.
            </Text>
          )}
          <div className="flex flex-col gap-0.5">
            {v.projectName ? (
              <Text size="xs" variant="muted">
                {v.projectName}
              </Text>
            ) : null}
            {compDisplay ? (
              <Text size="xs" variant="success">
                {compDisplay}
              </Text>
            ) : null}
            {v.platforms.length > 0 ? (
              <Text size="xs" variant="muted">
                {v.platforms.join(" · ")}
              </Text>
            ) : null}
          </div>
        </Well>
      </FieldRow>

      <FieldRow label="PRE-FLIGHT" hint={`${percent}% complete`}>
        <Progress value={percent} className="h-1" />
        <Well variant="ghost" className="gap-0 p-0">
          <ul className="divide-y divide-dashed divide-muted/40">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 px-3 py-2">
                <span
                  className={cn(
                    "inline-flex h-4 w-4 shrink-0 items-center justify-center border font-mono",
                    c.ok
                      ? "border-success/50 bg-success/15 text-success"
                      : "border-muted/40 bg-muted/20 text-muted-foreground/60",
                  )}
                >
                  {c.ok ? (
                    <HugeiconsIcon icon={CheckmarkCircle02Icon} size={10} />
                  ) : (
                    <span className="text-[10px]">·</span>
                  )}
                </span>
                <Text size="xs" className={c.ok ? "text-foreground" : "text-muted-foreground"}>
                  {c.label}
                </Text>
              </li>
            ))}
          </ul>
        </Well>
      </FieldRow>

      {jam ? (
        <FieldRow label="JAM">
          <Text size="sm">{jam.title}</Text>
          <Text size="xs" variant="muted" className="tracking-widest">
            {formatJamShortDates(jam.startsAt, jam.endsAt) ?? "DATES TBA"}
          </Text>
        </FieldRow>
      ) : null}

      {team ? (
        <FieldRow label="TEAM PAGE">
          <Text size="sm">{team.name}</Text>
          <Text size="xs" variant="muted" className="tracking-widest uppercase">
            Post will appear on the team's page
          </Text>
        </FieldRow>
      ) : pendingTeamName ? (
        <FieldRow label="TEAM PAGE" hint="new">
          <Text size="sm">{pendingTeamName}</Text>
          <Text size="xs" variant="muted" className="tracking-widest uppercase">
            Created with this post
          </Text>
        </FieldRow>
      ) : null}

      <FieldRow label="ROLES NEEDED">
        <div className="flex flex-wrap gap-1.5">
          {selectedRoles.length === 0 ? (
            <Text size="xs" variant="muted">
              None selected.
            </Text>
          ) : (
            selectedRoles.map((r) => (
              <Badge key={r.id} variant="secondary" size="label" className="uppercase">
                {r.name}
              </Badge>
            ))
          )}
        </div>
      </FieldRow>

      {selectedSkills.length > 0 ? (
        <FieldRow label="TECH STACK">
          <div className="flex flex-wrap gap-1.5">
            {selectedSkills.map((s) => (
              <Badge key={s.id} variant="outline" size="label" className="uppercase">
                {s.name}
              </Badge>
            ))}
          </div>
        </FieldRow>
      ) : null}

      <FieldRow label="CONTACT">
        <Text size="xs">
          {v.contactMethod
            ? `${v.contactType ? (CONTACT_TYPE_LABELS[v.contactType] ?? v.contactType) + ": " : ""}${v.contactMethod}`
            : v.isIndividual
              ? "Discord DM (via your profile)"
              : "—"}
        </Text>
      </FieldRow>
    </div>
  );
}
