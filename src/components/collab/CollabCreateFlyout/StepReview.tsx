import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { FieldRow } from "./fields";
import { useWizardForm } from "./form-context";
import { type AnyFormStore, CONTACT_TYPE_LABELS, POST_TYPES, formatCompensation } from "./shared";

/**
 * Step N — pre-flight checklist + compact post preview. Mirrors the
 * wireframe "29% complete · Pre-flight" panel.
 */
export function StepReview() {
  const form = useWizardForm();
  const v = useStore(form.store, (s: AnyFormStore) => s.values);
  const { data: roles } = useQuery({ ...orpc.listCollabRoles.queryOptions({ input: {} }) });
  const selectedRoles = roles?.filter((r) => v.roleIds.includes(r.id)) ?? [];

  let feedbackTypes: string[] = [];
  if (v.type === "playtest") {
    try {
      feedbackTypes = JSON.parse(v.experience || "[]");
      if (!Array.isArray(feedbackTypes)) feedbackTypes = [];
    } catch {
      feedbackTypes = [];
    }
  }

  const compDisplay = formatCompensation(v.compensationType, v.compensationMin, v.compensationMax);
  const postTypeIcon = POST_TYPES.find((t) => t.value === v.type)?.icon;

  const checks: { label: string; ok: boolean }[] = [
    { label: "Post type selected", ok: !!v.type },
    { label: "Title is descriptive", ok: v.title.trim().length >= 10 },
    { label: "Description ≥ 30 chars", ok: v.description.trim().length >= 30 },
    {
      label: "At least one role / topic",
      ok:
        v.type === "playtest"
          ? feedbackTypes.length > 0
          : v.roleIds.length > 0 || v.type === "mentor",
    },
    { label: "Compensation set", ok: v.type !== "paid" || !!v.compensationType },
    { label: "Platforms / timezone", ok: v.platforms.length > 0 },
    {
      label: "Contact method chosen",
      ok: v.isIndividual || (!!v.contactType && !!v.contactMethod.trim()),
    },
  ];
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
                  <Badge
                    variant="secondary"
                    className="font-mono text-[10px] tracking-widest uppercase"
                  >
                    {v.type}
                  </Badge>
                ) : null}
                {v.isIndividual ? (
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] tracking-widest uppercase"
                  >
                    Individual
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
              <Text monospace size="xs" variant="muted">
                {v.projectName}
              </Text>
            ) : null}
            {compDisplay ? (
              <Text monospace size="xs" variant="success">
                {compDisplay}
              </Text>
            ) : null}
            {v.platforms.length > 0 ? (
              <Text monospace size="xs" variant="muted">
                {v.platforms.join(" · ")}
              </Text>
            ) : null}
          </div>
        </Well>
      </FieldRow>

      <FieldRow label="// PRE-FLIGHT" hint={`${percent}% complete`}>
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
                <Text
                  monospace
                  size="xs"
                  className={c.ok ? "text-foreground" : "text-muted-foreground"}
                >
                  {c.label}
                </Text>
              </li>
            ))}
          </ul>
        </Well>
      </FieldRow>

      <FieldRow label="ROLES / TOPICS">
        <div className="flex flex-wrap gap-1.5">
          {selectedRoles.length === 0 ? (
            <Text monospace size="xs" variant="muted">
              None selected.
            </Text>
          ) : (
            selectedRoles.map((r) => (
              <Badge key={r.id} variant="secondary" className="font-mono tracking-widest uppercase">
                {r.name}
              </Badge>
            ))
          )}
        </div>
      </FieldRow>

      {feedbackTypes.length > 0 ? (
        <FieldRow label="FEEDBACK TYPES">
          <div className="flex flex-wrap gap-1.5">
            {feedbackTypes.map((ft) => (
              <Badge key={ft} variant="secondary" className="font-mono tracking-widest uppercase">
                {ft}
              </Badge>
            ))}
          </div>
        </FieldRow>
      ) : null}

      <FieldRow label="CONTACT">
        <Text monospace size="xs">
          {v.isIndividual
            ? "Discord DM (via your profile)"
            : v.contactMethod
              ? `${v.contactType ? (CONTACT_TYPE_LABELS[v.contactType] ?? v.contactType) + ": " : ""}${v.contactMethod}`
              : "—"}
        </Text>
      </FieldRow>
    </div>
  );
}
