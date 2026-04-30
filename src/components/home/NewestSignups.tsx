import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

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
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground">§ 03</div>
            <h2 className="font-mono text-2xl font-bold tracking-tight md:text-3xl">
              NEWEST SIGNUPS
            </h2>
          </div>
          <Link
            to="/collab"
            className="shrink-0 font-mono text-[11px] font-bold tracking-widest whitespace-nowrap text-muted-foreground"
          >
            BROWSE DEVS ▸
          </Link>
        </div>
        <p className="font-sans text-sm text-muted-foreground">
          Welcome the latest arrivals. Drop a DM, pair up, or pull them into your jam squad.
        </p>
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
            <div className="p-6 text-center font-mono text-xs tracking-widest text-muted-foreground uppercase">
              No signups yet
            </div>
          </Well>
        ) : (
          users.map((u) => {
            const handle = u.discordUsername ?? "anonymous";
            const topSkills = u.skills.slice(0, 3).map((s) => s.name);
            return (
              <Well key={u.id} className="flex flex-row items-start gap-3 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden bg-muted/60 font-mono text-sm font-bold text-foreground">
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initialOf(handle)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-sans text-sm font-bold text-foreground">
                      {u.guildNickname ?? handle}
                    </span>
                    <span className="text-[10px] tracking-widest text-primary uppercase">NEW</span>
                  </div>
                  <div className="truncate font-mono text-[10px] tracking-widest text-muted-foreground">
                    @{handle}
                  </div>
                  {u.tagline && (
                    <p className="mt-1 line-clamp-2 font-mono text-[11px] text-muted-foreground">
                      {u.tagline}
                    </p>
                  )}
                  {topSkills.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {topSkills.map((s) => (
                        <span
                          key={s}
                          className="border border-muted/40 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground uppercase"
                        >
                          {s}
                        </span>
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
