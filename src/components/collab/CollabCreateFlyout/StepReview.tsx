import { ArrowRight01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { collabStore, setWizardStep } from "@/lib/collab-store";
import { formatRate } from "@/lib/format-rate";
import { formatJamShortDates } from "@/lib/jam-countdown";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { FieldRow } from "./fields";
import { useWizardForm } from "./form-context";
import {
  type AnyFormStore,
  CONTACT_TYPE_LABELS,
  getPreflightChecks,
  POST_TYPES,
  WIZARD_TABS,
} from "./shared";

/**
 * Step 04 — pre-flight checklist + compact post preview. The checklist
 * mirrors the submit requirements exactly, so 100% and "SUBMIT works"
 * are the same statement — and every unmet row routes to the step that
 * fixes it.
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
  const { data: myProjects } = useQuery({
    ...orpc.listEditableProjects.queryOptions({ input: {} }),
    enabled: v.projectId !== undefined,
    staleTime: 60 * 1000,
  });

  const editingLegacyUnlinked = useStore(collabStore, (s) => s.wizard.editingLegacyUnlinked);

  const selectedRoles = roles?.filter((r) => v.roleIds.includes(r.id)) ?? [];
  const selectedSkills = allSkills?.filter((s) => v.skillIds.includes(s.id)) ?? [];
  const jam = jamData?.jams.find((j) => j.jamId === v.jamId) ?? null;
  const team = myTeams?.find((t) => t.id === v.teamId) ?? null;
  const project = myProjects?.projects.find((p) => p.id === v.projectId) ?? null;
  // The TEAM step's quick-create — the team doesn't exist yet, so the
  // review renders the name the submit will mint.
  const pendingTeamName = !v.isIndividual && v.teamId === undefined ? v.newTeamName.trim() : "";
  const teamName = team?.name ?? pendingTeamName;

  const compDisplay = formatRate(v.compensationType, v.compensationMin, v.compensationMax);
  const postTypeIcon = POST_TYPES.find((t) => t.value === v.type)?.icon;

  const checks = getPreflightChecks(v, { legacyUnlinkedEdit: editingLegacyUnlinked });
  const completed = checks.filter((c) => c.ok).length;
  const percent = Math.round((completed / checks.length) * 100);

  const contactDisplay = v.contactMethod
    ? `${v.contactType ? (CONTACT_TYPE_LABELS[v.contactType] ?? v.contactType) + ": " : ""}${v.contactMethod}`
    : v.isIndividual
      ? "Discord DM (via your profile)"
      : null;

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
              {v.title ? (
                <Text size="sm" bold>
                  {v.title}
                </Text>
              ) : (
                <Absence>no title yet</Absence>
              )}
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
                {teamName ? (
                  <Badge variant="outline" size="label" className="uppercase">
                    {teamName}
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
            <Absence>no pitch yet</Absence>
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
            {checks.map((c) => {
              const stepIndex = WIZARD_TABS.findIndex((t) => t.id === c.tabId);
              const stepLabel = WIZARD_TABS[stepIndex]?.label ?? c.tabId.toUpperCase();
              return (
                <li key={c.label}>
                  {c.ok ? (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <CheckSquare ok />
                      <Text size="xs" className="text-foreground">
                        {c.label}
                      </Text>
                    </div>
                  ) : (
                    // An unmet requirement is a task, so the row routes to
                    // the step that clears it rather than sitting inert.
                    <button
                      type="button"
                      onClick={() => setWizardStep(stepIndex)}
                      className={cn(
                        "group flex w-full items-center gap-2 px-3 py-2 text-left",
                        "transition-colors outline-none hover:bg-muted/20 focus-visible:bg-muted/20",
                      )}
                    >
                      <CheckSquare />
                      <Text size="xs" className="min-w-0 flex-1 text-muted-foreground">
                        {c.label}
                      </Text>
                      <Text
                        as="span"
                        size="xs"
                        className="flex shrink-0 items-center gap-1 tracking-widest text-primary/70 group-hover:text-primary"
                      >
                        {stepLabel}
                        <HugeiconsIcon icon={ArrowRight01Icon} size={10} />
                      </Text>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Well>
      </FieldRow>

      {/* The summary reads the way the post does — who's posting, what
          they need, how to reach them — and absences render dimmed
          instead of as headings over "None selected." */}
      <FieldRow label="WHO'S POSTING">
        {teamName || v.isIndividual ? (
          <>
            <Text size="sm">{v.isIndividual ? "Just you — solo post" : teamName}</Text>
            <Text size="xs" variant="muted" className="tracking-widest uppercase">
              {v.isIndividual
                ? "Responses come straight to you"
                : team
                  ? "Post appears on the team page"
                  : "Team page created with this post"}
            </Text>
          </>
        ) : (
          <Absence>no team picked yet</Absence>
        )}
        {jam ? (
          <Text size="xs" variant="muted" className="tracking-widest">
            FOR {jam.title.toUpperCase()} ·{" "}
            {formatJamShortDates(jam.startsAt, jam.endsAt) ?? "DATES TBA"}
          </Text>
        ) : null}
        {project ? (
          <Text size="xs" variant="muted" className="tracking-widest">
            RECRUITING FOR {project.title.toUpperCase()} · POST APPEARS ON ITS PAGE
          </Text>
        ) : null}
      </FieldRow>

      <FieldRow label="LOOKING FOR">
        {selectedRoles.length === 0 ? (
          <Absence>no roles yet</Absence>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selectedRoles.map((r) => (
              <Badge key={r.id} variant="secondary" size="label" className="uppercase">
                {r.name}
              </Badge>
            ))}
          </div>
        )}
        {selectedSkills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selectedSkills.map((s) => (
              <Badge key={s.id} variant="outline" size="label" className="uppercase">
                {s.name}
              </Badge>
            ))}
          </div>
        ) : null}
      </FieldRow>

      <FieldRow label="CONTACT">
        {contactDisplay ? (
          <Text size="xs">{contactDisplay}</Text>
        ) : (
          <Absence>no contact method yet</Absence>
        )}
      </FieldRow>
    </div>
  );
}

/** A dimmed "nothing here yet" — an absence, not placeholder copy that
 *  could be mistaken for content that will ship. */
function Absence({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" className="tracking-widest text-muted-foreground/50 uppercase">
      — {children}
    </Text>
  );
}

function CheckSquare({ ok = false }: { ok?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center border font-mono",
        ok
          ? "border-success/50 bg-success/15 text-success"
          : "border-muted/40 bg-muted/20 text-muted-foreground/60",
      )}
    >
      {ok ? (
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={10} />
      ) : (
        <span className="text-[10px]">·</span>
      )}
    </span>
  );
}
