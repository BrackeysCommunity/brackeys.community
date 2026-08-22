import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { AdminPager, AdminRow, AdminSection, Field } from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { timeAgo } from "@/lib/format-time";
import { profileLinkParams } from "@/lib/profile-links";
import { client, orpc } from "@/orpc/client";

type LoggedProfile = NonNullable<
  Awaited<ReturnType<typeof client.listModerationActions>>["actions"][number]["actor"]
>;

const PAGE_SIZE = 25;

/** Governs the dropdown only; the server filters on a plain string. */
const ACTIONS: { value: string; label: string }[] = [
  { value: "", label: "Every action" },
  { value: "user_banned", label: "Bans" },
  { value: "user_unbanned", label: "Unbans" },
  { value: "comment_removed", label: "Comments removed" },
  { value: "post_closed", label: "Posts closed" },
  { value: "comment_report_dismissed", label: "Comment reports dismissed" },
  { value: "post_report_dismissed", label: "Post reports dismissed" },
  { value: "post_report_deleted", label: "Post reports deleted" },
  { value: "report_reopened", label: "Reports reopened" },
  { value: "skill_request_approved", label: "Skills approved" },
  { value: "skill_request_rejected", label: "Skills rejected" },
  { value: "jam_hero_pinned", label: "Hero jams pinned" },
  { value: "jam_hero_unpinned", label: "Hero jams unpinned" },
  { value: "vocabulary_created", label: "Vocabulary created" },
  { value: "vocabulary_renamed", label: "Vocabulary renamed" },
  { value: "vocabulary_deleted", label: "Vocabulary deleted" },
];

const ACTION_LABEL = new Map(ACTIONS.map((a) => [a.value, a.label]));

/** `listBans` shows the current ban record; this shows every decision behind it. */
export function AdminLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [subjectUserId, setSubjectUserId] = useState("");

  const subject = subjectUserId.trim();
  const log = useQuery(
    orpc.listModerationActions.queryOptions({
      input: {
        page,
        pageSize: PAGE_SIZE,
        ...(action ? { action } : {}),
        ...(subject ? { subjectUserId: subject } : {}),
      },
    }),
  );

  const rows = log.data?.actions ?? [];

  return (
    <AdminSection
      title="Moderation log"
      count={log.isPending ? undefined : log.data?.total}
      hint="Every staff action, with the reason typed at the time. Rows outlive the things they were taken against."
      actions={
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Action" htmlFor="log-action">
            <NativeSelect
              id="log-action"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            >
              {ACTIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Subject id" htmlFor="log-subject">
            <SearchField
              id="log-subject"
              value={subjectUserId}
              onChange={(next) => {
                setSubjectUserId(next);
                setPage(1);
              }}
              placeholder="Member id…"
            />
          </Field>
        </div>
      }
    >
      <AdminPager
        page={page}
        pageCount={log.data?.pageCount ?? 1}
        total={log.data?.total ?? 0}
        pageSize={PAGE_SIZE}
        unit="actions"
        onPage={setPage}
      />

      {log.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <Empty>Nothing matches that filter.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <AdminRow key={row.id} className="gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge size="label" variant="outline">
                  {ACTION_LABEL.get(row.action) ?? row.action}
                </Badge>
                <MicroLabel>{timeAgo(row.createdAt)}</MicroLabel>
                {row.targetType ? (
                  <MicroLabel>
                    {row.targetType.toUpperCase()}
                    {row.targetId ? ` ${row.targetId}` : ""}
                  </MicroLabel>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <MicroLabel>BY</MicroLabel>
                  {row.actor ? (
                    <ProfileChip profile={row.actor} />
                  ) : (
                    // A null actor is the app itself — today, the guild-ban gate.
                    <Text size="sm" variant="muted">
                      {row.actorName ?? "Brackeys"}
                    </Text>
                  )}
                </div>

                {row.subject ? (
                  <div className="flex items-center gap-2">
                    <MicroLabel>ON</MicroLabel>
                    <ProfileChip profile={row.subject} />
                  </div>
                ) : null}
              </div>

              {row.reason ? (
                <Text size="sm" variant="muted" textWrap="pretty">
                  “{row.reason}”
                </Text>
              ) : null}
            </AdminRow>
          ))}
        </div>
      )}
    </AdminSection>
  );
}

function ProfileChip({ profile }: { profile: LoggedProfile }) {
  return (
    <Link
      className="flex items-center gap-1.5 hover:text-primary"
      to="/profile/$userId"
      params={profileLinkParams(profile)}
    >
      <UserAvatar avatarUrl={profile.avatarUrl} username={profile.displayName} size={20} />
      <Text size="sm">{profile.displayName}</Text>
    </Link>
  );
}
