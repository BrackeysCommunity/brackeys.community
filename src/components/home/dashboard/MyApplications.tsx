import { Link as RouterLink } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Section, SectionAction } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { timeAgo } from "@/lib/format-time";

import type { HomeDashboardData } from "./use-home-dashboard";

const STATUS_VARIANT: Record<string, "success" | "destructive" | "warning"> = {
  accepted: "success",
  declined: "destructive",
  pending: "warning",
};

/**
 * What the viewer has applied to, and where each one stands.
 *
 * The status chip is the whole section: before this, a responder could only
 * learn they'd been accepted by reopening the post they applied to, one post
 * at a time. Rows for closed and expired posts stay for the same reason — the
 * decision is what's being read, not the post's availability.
 */
export function MyApplications({
  applications,
}: {
  applications: HomeDashboardData["applications"];
}) {
  if (applications.length === 0) return null;

  return (
    <Section
      title="YOUR APPLICATIONS"
      size="sm"
      blurb="Where each one stands."
      action={<SectionAction to="/collab">OPEN BOARD</SectionAction>}
    >
      <Well className="overflow-hidden">
        <ul className="divide-y divide-muted/20">
          {applications.map((application) => (
            <li key={application.id}>
              <RouterLink
                to="/collab/$postId"
                params={{ postId: String(application.postId) }}
                className="group flex items-center gap-3 px-3 py-2.5 text-inherit transition-colors hover:bg-muted/40"
              >
                <Badge
                  variant={STATUS_VARIANT[application.status] ?? "outline"}
                  size="label"
                  className="shrink-0 uppercase"
                >
                  {application.status}
                </Badge>
                <div className="min-w-0 flex-1">
                  <Text as="div" bold ellipsis size="md" className="group-hover:text-primary">
                    {application.postTitle}
                  </Text>
                  {/* The invite is where an accepted application actually
                      lands — an ACCEPTED chip on its own leaves the responder
                      waiting for a step that already happened. */}
                  {application.invite ? (
                    <MicroLabel as="div" ellipsis variant={inviteLine(application.invite).variant}>
                      {inviteLine(application.invite).text}
                    </MicroLabel>
                  ) : application.jam ? (
                    <MicroLabel as="div" ellipsis>
                      {application.jam.title}
                    </MicroLabel>
                  ) : null}
                </div>
                <MicroLabel as="div" className="w-16 shrink-0 text-right tabular-nums">
                  {timeAgo(application.createdAt)}
                </MicroLabel>
              </RouterLink>
            </li>
          ))}
        </ul>
      </Well>
    </Section>
  );
}

type ApplicationInvite = NonNullable<HomeDashboardData["applications"][number]["invite"]>;

function inviteLine(invite: ApplicationInvite): { text: string; variant: "success" | "muted" } {
  const team = (invite.team?.name ?? "the team").toUpperCase();
  switch (invite.status) {
    case "pending":
      return { text: `INVITED TO ${team}`, variant: "success" };
    case "accepted":
      return { text: `JOINED ${team}`, variant: "success" };
    case "declined":
      return { text: `YOU DECLINED ${team}`, variant: "muted" };
    default:
      return { text: `INVITE TO ${team} WITHDRAWN`, variant: "muted" };
  }
}
