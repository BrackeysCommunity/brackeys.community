import { useQuery } from "@tanstack/react-query";

import { Heading, Link, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { client } from "@/orpc/client";

const SIGNUP_LIMIT = 6;

function initialOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function NewestSignups() {
  const { data, isLoading } = useQuery({
    queryKey: ["newest-signups", SIGNUP_LIMIT],
    queryFn: () =>
      client.listAvailableUsers({
        sortBy: "createdAt",
        sortOrder: "desc",
        limit: SIGNUP_LIMIT,
        offset: 0,
      }),
    staleTime: 60 * 1000,
  });

  const users = data?.users ?? [];

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
              § 03
            </Text>
            <Heading as="h2" monospace className="text-2xl md:text-3xl">
              NEWEST SIGNUPS
            </Heading>
          </div>
          <Link
            as="router"
            to="/collab"
            monospace
            bold
            variant="muted"
            className="shrink-0 text-[11px] tracking-widest whitespace-nowrap"
          >
            BROWSE DEVS ▸
          </Link>
        </div>
        <Text as="p" size="md" variant="muted">
          Welcome the latest arrivals. Drop a DM, pair up, or pull them into your jam squad.
        </Text>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        {isLoading ? (
          Array.from({ length: SIGNUP_LIMIT }).map((_, i) => (
            <Well key={i} className="h-20 animate-pulse" aria-hidden>
              <span />
            </Well>
          ))
        ) : users.length === 0 ? (
          <Well variant="ghost" className="col-span-full">
            <Text
              as="div"
              monospace
              size="sm"
              variant="muted"
              align="center"
              className="p-6 tracking-widest uppercase"
            >
              No signups yet
            </Text>
          </Well>
        ) : (
          users.map((u) => {
            const handle = u.discordUsername ?? "anonymous";
            const topSkills = u.skills.slice(0, 3).map((s) => s.name);
            return (
              <Well key={u.id} className="flex flex-row items-start gap-3 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden bg-muted/60">
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Text monospace bold size="md">
                      {initialOf(handle)}
                    </Text>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <Text bold ellipsis size="md">
                      {u.guildNickname ?? handle}
                    </Text>
                    <Text size="xs" variant="accent" className="tracking-widest uppercase">
                      NEW
                    </Text>
                  </div>
                  <Text
                    as="div"
                    monospace
                    size="xs"
                    variant="muted"
                    ellipsis
                    className="tracking-widest"
                  >
                    @{handle}
                  </Text>
                  {u.tagline && (
                    <Text
                      as="p"
                      monospace
                      variant="muted"
                      className="mt-1 line-clamp-2 text-[11px]"
                    >
                      {u.tagline}
                    </Text>
                  )}
                  {topSkills.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {topSkills.map((s) => (
                        <Text
                          key={s}
                          monospace
                          variant="muted"
                          className="border border-muted/40 px-1.5 py-0.5 text-[9px] tracking-widest uppercase"
                        >
                          {s}
                        </Text>
                      ))}
                    </div>
                  )}
                </div>
              </Well>
            );
          })
        )}
      </div>
    </section>
  );
}
