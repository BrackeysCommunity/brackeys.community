import type { PublicApi } from "./api.ts";

/**
 * What autocomplete answers from. An autocomplete interaction has the same
 * 3 s window as a command but cannot defer, so it never touches the API
 * on the request path: these lists are warmed at boot and refreshed in the
 * background, and a cold memo answers with nothing rather than risking
 * the deadline.
 */

type Jams = Awaited<ReturnType<PublicApi["listJams"]>>["jams"];
type Skills = Awaited<ReturnType<PublicApi["listSkills"]>>;
type Roles = Awaited<ReturnType<PublicApi["listCollabRoles"]>>;
type Teams = Awaited<ReturnType<PublicApi["listTeams"]>>["teams"];

export interface Choice {
  name: string;
  value: string | number;
}

/** Discord returns at most this many autocomplete choices. */
export const CHOICES_MAX = 25;
const CHOICE_NAME_MAX = 100;

export interface MemoOptions {
  /** Whose jams lead an empty jam query. */
  hostName: string;
  jamsIntervalMs?: number;
  taxonomyIntervalMs?: number;
  teamsIntervalMs?: number;
  /** `listTeams` pages at 50; this bounds how many pages the memo walks. */
  teamPagesMax?: number;
  log?: (line: string) => void;
}

export interface Memo {
  /** Warm every list once (failures logged, not thrown), then keep refreshing. */
  start(): Promise<void>;
  stop(): void;
  refreshJams(): Promise<void>;
  refreshTaxonomy(): Promise<void>;
  refreshTeams(): Promise<void>;
  jamChoices(query: string): Choice[];
  skillChoices(query: string): Choice[];
  roleChoices(query: string): Choice[];
  teamChoices(query: string): Choice[];
  skillName(id: number): string | undefined;
  roleName(id: number): string | undefined;
  /** For tests and the boot log. */
  sizes(): { jams: number; skills: number; roles: number; teams: number };
}

export function createMemo(api: PublicApi, options: MemoOptions): Memo {
  const {
    hostName,
    jamsIntervalMs = 60_000,
    taxonomyIntervalMs = 5 * 60_000,
    teamsIntervalMs = 60_000,
    teamPagesMax = 10,
    log = () => {},
  } = options;

  let jams: Jams = [];
  let skills: Skills = [];
  let roles: Roles = [];
  let teams: Teams = [];
  const timers: ReturnType<typeof setInterval>[] = [];

  async function guarded(label: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      log(`[memo] ${label} refresh failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  const refreshJams = () =>
    guarded("jams", async () => {
      const result = await api.listJams({ filter: "board", limit: 1000 });
      jams = result.jams;
    });

  const refreshTaxonomy = () =>
    guarded("taxonomy", async () => {
      const [s, r] = await Promise.all([api.listSkills({}), api.listCollabRoles({})]);
      skills = s;
      roles = r;
    });

  const refreshTeams = () =>
    guarded("teams", async () => {
      const collected: Teams = [];
      for (let page = 0; page < teamPagesMax; page++) {
        const result = await api.listTeams({ limit: 50, offset: page * 50 });
        collected.push(...result.teams);
        if (collected.length >= result.total || result.teams.length === 0) break;
      }
      teams = collected;
    });

  function schedule(fn: () => Promise<void>, everyMs: number) {
    const timer = setInterval(() => void fn(), everyMs);
    // Bun and Node both let a timer stop holding the event loop open.
    (timer as { unref?: () => void }).unref?.();
    timers.push(timer);
  }

  return {
    async start() {
      await Promise.all([refreshJams(), refreshTaxonomy(), refreshTeams()]);
      schedule(refreshJams, jamsIntervalMs);
      schedule(refreshTaxonomy, taxonomyIntervalMs);
      schedule(refreshTeams, teamsIntervalMs);
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers.length = 0;
    },
    refreshJams,
    refreshTaxonomy,
    refreshTeams,
    jamChoices(query) {
      const q = norm(query);
      const isHost = (jam: Jams[number]) =>
        (jam.hosts as { name: string }[] | null)?.some((h) => h.name === hostName) ?? false;
      const ranked = rank(jams, q, (jam) => jam.title).sort(
        (a, b) =>
          a.score - b.score ||
          Number(isHost(b.item)) - Number(isHost(a.item)) ||
          (b.item.joinedCount ?? 0) - (a.item.joinedCount ?? 0),
      );
      return ranked
        .slice(0, CHOICES_MAX)
        .map(({ item }) => ({ name: choiceName(item.title), value: item.slug }));
    },
    skillChoices: (query) => nameChoices(skills, query),
    roleChoices: (query) => nameChoices(roles, query),
    teamChoices(query) {
      return rank(teams, norm(query), (team) => team.name)
        .sort((a, b) => a.score - b.score || Number(b.item.recruiting) - Number(a.item.recruiting))
        .slice(0, CHOICES_MAX)
        .map(({ item }) => ({ name: choiceName(item.name), value: item.slug }));
    },
    skillName: (id) => skills.find((s) => s.id === id)?.name,
    roleName: (id) => roles.find((r) => r.id === id)?.name,
    sizes: () => ({
      jams: jams.length,
      skills: skills.length,
      roles: roles.length,
      teams: teams.length,
    }),
  };
}

const norm = (s: string) => s.trim().toLowerCase();

/** 0 = exact, 1 = prefix, 2 = substring, dropped otherwise (an empty query keeps all). */
function rank<T>(items: T[], q: string, name: (item: T) => string) {
  const out: { item: T; score: number }[] = [];
  for (const item of items) {
    const n = norm(name(item));
    if (q === "") out.push({ item, score: 2 });
    else if (n === q) out.push({ item, score: 0 });
    else if (n.startsWith(q)) out.push({ item, score: 1 });
    else if (n.includes(q)) out.push({ item, score: 2 });
  }
  return out;
}

function nameChoices(items: { id: number; name: string }[], query: string): Choice[] {
  return rank(items, norm(query), (i) => i.name)
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, CHOICES_MAX)
    .map(({ item }) => ({ name: choiceName(item.name), value: item.id }));
}

function choiceName(name: string): string {
  const trimmed = name.trim() || "(untitled)";
  return trimmed.length > CHOICE_NAME_MAX ? `${trimmed.slice(0, CHOICE_NAME_MAX - 1)}…` : trimmed;
}
