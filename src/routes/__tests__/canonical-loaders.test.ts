import { isRedirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

/**
 * Notifications link a team or a project by its id, because the slug they
 * would otherwise have frozen into the row dies the moment the thing is
 * renamed. That only reads well because each page hops from the id to the
 * current slug — without it the address bar would sit on a raw id, and
 * shares and crawlers would see two URLs for one page.
 */

const TEAM = { id: "t-abc", slug: "pixel-pushers", name: "Pixel Pushers" };
const PROJECT = { project: { id: "p-xyz", slug: "orbit", title: "Orbit" } };

vi.mock("@/orpc/client", () => ({
  client: {
    getProject: vi.fn(() => Promise.resolve(PROJECT)),
    getProjectViewerState: vi.fn(() => Promise.resolve(null)),
  },
  orpc: {
    getTeam: { queryOptions: (input: unknown) => input },
    getTeamForInsider: { queryOptions: (input: unknown) => input },
  },
}));

const { Route: TeamRoute } = await import("../teams.$teamId");
const { Route: ProjectRoute } = await import("../projects.$projectSlug");

function loaderOf(route: { options: { loader?: unknown } }) {
  return route.options.loader as (ctx: unknown) => Promise<unknown>;
}

describe("/teams/$teamId canonical hop", () => {
  const run = (teamId: string, hash = "") =>
    loaderOf(TeamRoute)({
      context: { queryClient: { ensureQueryData: vi.fn(() => Promise.resolve(TEAM)) } },
      params: { teamId },
      location: { hash },
    });

  it("sends an id to the slug, and keeps the fragment", async () => {
    const thrown = await run(TEAM.id, "roster").catch((e: unknown) => e);
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      options: {
        to: "/teams/$teamId",
        params: { teamId: "pixel-pushers" },
        hash: "roster",
        statusCode: 301,
      },
    });
  });

  it("leaves a request already on the slug alone", async () => {
    await expect(run(TEAM.slug)).resolves.toBe(TEAM);
  });
});

describe("/projects/$projectSlug canonical hop", () => {
  const run = (projectSlug: string, search: Record<string, unknown> = {}) =>
    loaderOf(ProjectRoute)({ params: { projectSlug }, location: { hash: "", search } });

  it("sends an id to the slug, and keeps the jam the visitor came from", async () => {
    const thrown = await run(PROJECT.project.id, { jam: 42 }).catch((e: unknown) => e);
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      options: {
        to: "/projects/$projectSlug",
        params: { projectSlug: "orbit" },
        search: { jam: 42 },
        statusCode: 301,
      },
    });
  });

  it("leaves a request already on the slug alone", async () => {
    await expect(run(PROJECT.project.slug)).resolves.toMatchObject({
      project: { slug: "orbit" },
    });
  });
});
