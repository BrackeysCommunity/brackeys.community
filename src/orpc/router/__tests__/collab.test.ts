import { describe, expect, it } from "vite-plus/test";

import {
  collabFacetInput,
  countActiveCollabFilters,
  sortPreset,
} from "@/components/collab/collab-filters";
import {
  getPreflightChecks,
  getQuickFieldErrors,
  getStepValidationError,
  projectLengthForJam,
  projectPrefillValues,
  type PickableProject,
  type QuickFieldErrors,
  type WizardFormValues,
} from "@/components/collab/CollabCreateFlyout/shared";
import { draftFromPost, isEditablePostType } from "@/lib/collab-store";
import router from "@/orpc/router";
import { postContentSchema, stripContact } from "@/orpc/router/collab";

/** A payload that satisfies every requirement, for tests to break one at a time. */
function validPost(overrides: Record<string, unknown> = {}) {
  return {
    type: "hobby",
    title: "Pixel artist for a PSX horror RPG",
    description: "A short atmospheric horror RPG in the PSX style. Looking for a pixel artist.",
    projectName: "Cathedral of Wires",
    projectLength: "1-3 months",
    platforms: ["PC"],
    experienceLevel: "any",
    contactType: "discord_dm",
    contactMethod: "someone",
    roleIds: [1],
    ...overrides,
  };
}

describe("collab router surface", () => {
  it("registers the jam post count alongside the existing procedures", () => {
    expect(router.countPostsForJam).toBeDefined();
    expect(router.createPost).toBeDefined();
    expect(router.updatePost).toBeDefined();
  });

  it("registers the responder's own edit and withdraw procedures", () => {
    expect(router.updateMyResponse).toBeDefined();
    expect(router.withdrawResponse).toBeDefined();
  });

  it("registers the dashboard's viewer-scoped summaries", () => {
    expect(router.listMyResponses).toBeDefined();
    expect(router.listMyPostsSummary).toBeDefined();
  });

  it("registers the publish-first strengthen and accept procedures", () => {
    expect(router.updatePostLinks).toBeDefined();
    expect(router.acceptAndInvite).toBeDefined();
  });
});

describe("createPost / updatePost input schema", () => {
  it("accepts a fully-specified post", () => {
    expect(postContentSchema.safeParse(validPost()).success).toBe(true);
  });

  // ── Enum narrowing (v1 = paid + hobby) ──────────────────────────────

  it.each(["paid", "hobby"])("accepts the %s type", (type) => {
    const input =
      type === "paid"
        ? validPost({ type, compensationType: "hourly", compensationMin: 25, compensationMax: 75 })
        : validPost({ type });
    expect(postContentSchema.safeParse(input).success).toBe(true);
  });

  it.each(["playtest", "mentor", "availability", ""])("rejects the deferred %s type", (type) => {
    expect(postContentSchema.safeParse(validPost({ type })).success).toBe(false);
  });

  // ── Validation parity: the server rejects what the wizard forbids ────

  it("rejects a title shorter than the wizard's 10-character minimum", () => {
    expect(postContentSchema.safeParse(validPost({ title: "too short" })).success).toBe(false);
  });

  it("rejects a description shorter than the wizard's 30-character minimum", () => {
    expect(postContentSchema.safeParse(validPost({ description: "short" })).success).toBe(false);
  });

  it("accepts a post with no platforms — the board reads that as any", () => {
    expect(postContentSchema.safeParse(validPost({ platforms: [] })).success).toBe(true);
    const input = validPost();
    delete (input as Record<string, unknown>).platforms;
    expect(postContentSchema.safeParse(input).success).toBe(true);
  });

  it("rejects a post with no roles", () => {
    expect(postContentSchema.safeParse(validPost({ roleIds: [] })).success).toBe(false);
  });

  it.each(["projectLength", "experienceLevel", "projectName"])(
    "accepts a post missing %s — a post-publish upgrade, not a gate",
    (field) => {
      const input = validPost();
      delete (input as Record<string, unknown>)[field];
      expect(postContentSchema.safeParse(input).success).toBe(true);
    },
  );

  it("still bounds a project name when one is given", () => {
    expect(postContentSchema.safeParse(validPost({ projectName: "ab" })).success).toBe(false);
  });

  it.each([false, true])(
    "lets a post omit contact details (isIndividual=%s) — an accepted responder gets the Discord handoff",
    (isIndividual) => {
      const input = validPost({ isIndividual });
      delete (input as Record<string, unknown>).contactType;
      delete (input as Record<string, unknown>).contactMethod;
      expect(postContentSchema.safeParse(input).success).toBe(true);
    },
  );

  it("accepts the five-field quick post", () => {
    expect(
      postContentSchema.safeParse({
        type: "hobby",
        title: "Pixel artist for a PSX horror RPG",
        description: "A short atmospheric horror RPG in the PSX style. Looking for a pixel artist.",
        roleIds: [1],
      }).success,
    ).toBe(true);
  });

  // ── Compensation ────────────────────────────────────────────────────

  it("requires a compensation type on paid posts", () => {
    expect(postContentSchema.safeParse(validPost({ type: "paid" })).success).toBe(false);
  });

  it("requires a range on paid posts unless the rate is negotiable", () => {
    expect(
      postContentSchema.safeParse(validPost({ type: "paid", compensationType: "hourly" })).success,
    ).toBe(false);
    expect(
      postContentSchema.safeParse(validPost({ type: "paid", compensationType: "negotiable" }))
        .success,
    ).toBe(true);
  });

  it("rejects an inverted compensation range", () => {
    expect(
      postContentSchema.safeParse(
        validPost({
          type: "paid",
          compensationType: "hourly",
          compensationMin: 90,
          compensationMax: 20,
        }),
      ).success,
    ).toBe(false);
  });

  it("caps the stack at ten entries", () => {
    expect(postContentSchema.safeParse(validPost({ skillIds: [1, 2, 3] })).success).toBe(true);
    expect(
      postContentSchema.safeParse({
        ...validPost(),
        skillIds: Array.from({ length: 11 }, (_, i) => i + 1),
      }).success,
    ).toBe(false);
  });

  it("accepts a jam link and accepts null to unlink one", () => {
    expect(postContentSchema.safeParse(validPost({ jamId: 42 })).success).toBe(true);
    expect(postContentSchema.safeParse(validPost({ jamId: null })).success).toBe(true);
    expect(postContentSchema.safeParse(validPost({ jamId: 0 })).success).toBe(false);
  });
});

// ── Team linkage: unlinked is normal, solo + team is contradictory ────

describe("team linkage in the post payload", () => {
  it("accepts an unlinked team post — the crew is attached at accept time", () => {
    expect(postContentSchema.safeParse(validPost({ isIndividual: false })).success).toBe(true);
    expect(
      postContentSchema.safeParse(validPost({ isIndividual: false, teamId: null })).success,
    ).toBe(true);
  });

  it("accepts solo posts and linked team posts", () => {
    expect(postContentSchema.safeParse(validPost({ isIndividual: true })).success).toBe(true);
    expect(postContentSchema.safeParse(validPost({ teamId: "t1" })).success).toBe(true);
  });

  it("still refuses a solo post that also names a team", () => {
    const parsed = postContentSchema.safeParse(validPost({ isIndividual: true, teamId: "t1" }));
    expect(parsed.success).toBe(false);
  });
});

// ── Client-side gate agrees with the server's ─────────────────────────

/** The wizard values matching `validPost()`. */
function validWizardValues(overrides: Partial<WizardFormValues> = {}): WizardFormValues {
  return {
    type: "hobby",
    jamId: undefined,
    teamId: undefined,
    projectId: undefined,
    // The TEAM step's default path: quick-create at submit.
    newTeamName: "Night Shift Crew",
    newTeamDescription: "",
    newTeamImage: null,
    title: "Pixel artist for a PSX horror RPG",
    description: "A short atmospheric horror RPG in the PSX style. Looking for a pixel artist.",
    isIndividual: false,
    projectName: "Cathedral of Wires",
    platforms: ["PC"],
    projectLength: "1-3 months",
    experienceLevel: "any",
    compensationType: undefined,
    compensationMin: undefined,
    compensationMax: undefined,
    contactType: "discord_dm",
    contactMethod: "someone",
    portfolioUrl: "",
    roleIds: [1],
    skillIds: [],
    images: [],
    ...overrides,
  };
}

describe("wizard step validation", () => {
  it("passes a complete draft at every step", () => {
    const v = validWizardValues();
    expect(getStepValidationError("basics", v)).toBeNull();
    expect(getStepValidationError("team", v)).toBeNull();
    expect(getStepValidationError("details", v)).toBeNull();
    expect(getStepValidationError("roles", v)).toBeNull();
    expect(getStepValidationError("review", v)).toBeNull();
  });

  // ── TEAM step (solo / existing pick / new-team form) ────────────────

  it("passes the team step for solo posts with nothing picked", () => {
    expect(
      getStepValidationError("team", validWizardValues({ isIndividual: true, newTeamName: "" })),
    ).toBeNull();
  });

  it("passes the team step when an existing team is linked", () => {
    expect(
      getStepValidationError("team", validWizardValues({ teamId: "t1", newTeamName: "" })),
    ).toBeNull();
  });

  it("lets a team post leave the team for later — but still validates a typed name", () => {
    expect(getStepValidationError("team", validWizardValues({ newTeamName: "" }))).toBeNull();
    expect(getStepValidationError("team", validWizardValues({ newTeamName: "x" }))).not.toBeNull();
  });

  it("profanity-checks the new-team name but not its description", () => {
    // The name is the team's identity and titles every invite notification,
    // so it still hard-rejects. The description is prose — stored as
    // written, censored at render for viewers who asked for that.
    expect(getStepValidationError("team", validWizardValues({ newTeamName: "shit" }))).toMatch(
      /inappropriate/,
    );
    expect(
      getStepValidationError("team", validWizardValues({ newTeamDescription: "shit" })),
    ).toBeNull();
  });

  it("re-checks the team step at review", () => {
    expect(
      getStepValidationError("review", validWizardValues({ newTeamName: "x" })),
    ).not.toBeNull();
    expect(getStepValidationError("review", validWizardValues({ newTeamName: "" }))).toBeNull();
  });

  it("requires at least one role — the step used to be silently optional", () => {
    expect(getStepValidationError("roles", validWizardValues({ roleIds: [] }))).not.toBeNull();
  });

  it("re-checks earlier steps at review, so submit can't be reached around them", () => {
    expect(getStepValidationError("review", validWizardValues({ roleIds: [] }))).not.toBeNull();
    expect(getStepValidationError("review", validWizardValues({ title: "short" }))).not.toBeNull();
  });

  // The terms and the project name are post-publish upgrades: the server
  // accepts a post without them, so no step may refuse one either.
  it("gates nothing on platforms, timeline, experience, contact, or project name", () => {
    for (const partial of [
      { platforms: [] },
      { projectLength: undefined },
      { experienceLevel: undefined },
      { contactMethod: "", contactType: undefined },
      { projectName: "" },
    ] satisfies Partial<WizardFormValues>[]) {
      expect(getStepValidationError("review", validWizardValues(partial))).toBeNull();
    }
  });

  it("requires a compensation range on paid posts, matching the server", () => {
    expect(getStepValidationError("basics", validWizardValues({ type: "paid" }))).not.toBeNull();
    expect(
      getStepValidationError(
        "basics",
        validWizardValues({ type: "paid", compensationType: "negotiable" }),
      ),
    ).toBeNull();
  });

  // ── The quick screen: one step, the same gates ─────────────────────

  it("passes the quick screen with the five fields alone", () => {
    const v = validWizardValues({
      newTeamName: "",
      projectName: "",
      platforms: [],
      projectLength: undefined,
      experienceLevel: undefined,
      contactType: undefined,
      contactMethod: "",
    });
    expect(getStepValidationError("quick", v)).toBeNull();
    expect(getQuickFieldErrors(v)).toEqual({});
  });

  it("blocks the quick screen on exactly what the server would refuse", () => {
    const cases: [Partial<WizardFormValues>, keyof QuickFieldErrors][] = [
      [{ roleIds: [] }, "roles"],
      [{ title: "short" }, "title"],
      [{ description: "short" }, "description"],
      [{ type: undefined }, "type"],
      [{ type: "paid" }, "compensation"],
      [{ title: "shit shit shit shit" }, "title"],
    ];
    for (const [partial, field] of cases) {
      const v = validWizardValues(partial);
      const errors = getQuickFieldErrors(v);
      expect(Object.keys(errors)).toEqual([field]);
      expect(getStepValidationError("quick", v)).toBe(errors[field]);
    }
  });

  it("reads the quick screen's errors in field order", () => {
    const v = validWizardValues({ roleIds: [], title: "" });
    expect(getStepValidationError("quick", v)).toMatch(/role/i);
  });
});

describe("pre-flight checklist", () => {
  it("reads 100% exactly when the post would submit", () => {
    const checks = getPreflightChecks(validWizardValues());
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(getStepValidationError("review", validWizardValues())).toBeNull();
  });

  it("drops below 100% for anything that would block submit", () => {
    for (const partial of [
      { roleIds: [] },
      { title: "short" },
      { type: "paid" },
      { newTeamName: "x" },
    ] satisfies Partial<WizardFormValues>[]) {
      const v = validWizardValues(partial);
      expect(getPreflightChecks(v).every((c) => c.ok)).toBe(false);
      expect(getStepValidationError("review", v)).not.toBeNull();
    }
  });

  it("stays at 100% for the upgrades submit no longer needs", () => {
    for (const partial of [
      { platforms: [] },
      { projectName: "" },
      { contactMethod: "", contactType: undefined },
      { newTeamName: "" },
    ] satisfies Partial<WizardFormValues>[]) {
      const v = validWizardValues(partial);
      expect(getPreflightChecks(v).every((c) => c.ok)).toBe(true);
      expect(getStepValidationError("review", v)).toBeNull();
    }
  });
});

describe("projectLengthForJam", () => {
  const day = 86_400_000;
  const start = new Date("2026-03-01T00:00:00Z");
  const after = (days: number) => new Date(start.getTime() + days * day);

  it("maps a weekend jam to the shortest bucket", () => {
    expect(projectLengthForJam(start, after(2))).toBe("<1 week");
  });

  it("maps a two-week jam to 1-4 weeks", () => {
    expect(projectLengthForJam(start, after(14))).toBe("1-4 weeks");
  });

  it("maps a two-month jam to 1-3 months", () => {
    expect(projectLengthForJam(start, after(60))).toBe("1-3 months");
  });

  it("returns nothing when the dates are missing or nonsensical", () => {
    expect(projectLengthForJam(null, after(2))).toBeUndefined();
    expect(projectLengthForJam(start, null)).toBeUndefined();
    expect(projectLengthForJam(after(2), start)).toBeUndefined();
  });
});

describe("stripContact", () => {
  const row = {
    id: 7,
    title: "Composer wanted",
    contactType: "email" as string | null,
    contactMethod: "team@example.com" as string | null,
  };

  it("removes both contact columns and keeps everything else", () => {
    const out = stripContact(row);
    expect(out).not.toHaveProperty("contactType");
    expect(out).not.toHaveProperty("contactMethod");
    expect(out.id).toBe(7);
    expect(out.title).toBe("Composer wanted");
  });

  it("reports whether there was a contact block behind the gate", () => {
    expect(stripContact(row).hasContact).toBe(true);
    expect(stripContact({ ...row, contactMethod: null }).hasContact).toBe(true);
    expect(stripContact({ ...row, contactType: null }).hasContact).toBe(true);
    expect(stripContact({ ...row, contactType: null, contactMethod: null }).hasContact).toBe(false);
  });

  it("leaves no contact value anywhere in the serialized payload", () => {
    // The bug this guards against shipped twice: `getPost` was fixed while
    // `listPosts` kept leaking, because both build their response by
    // spreading a full-row `select()`. A substring check catches a leak
    // through any key, not just the two we remember to name.
    const json = JSON.stringify(stripContact(row));
    expect(json).not.toContain("team@example.com");
    expect(json).not.toContain("email");
  });
});

describe("draftFromPost", () => {
  const post = {
    type: "paid",
    jamId: 7,
    teamId: null,
    projectId: null,
    title: "Composer for a roguelike",
    description: "Looking for a composer for a fast, punchy roguelike soundtrack.",
    projectName: "Nine Lives",
    compensationType: "hourly",
    compensationMin: 25,
    compensationMax: 75,
    projectLength: "1-3 months",
    platforms: ["PC", "Mac"],
    experienceLevel: "intermediate",
    portfolioUrl: "https://example.com",
    contactMethod: "team@example.com",
    contactType: "email",
    isIndividual: false,
    roles: [{ id: 3 }, { id: 9 }],
    skills: [{ id: 11 }, { id: 12 }],
  };

  it("round-trips the compensation numbers the sliders need", () => {
    const draft = draftFromPost(post);
    expect(draft.compensationType).toBe("hourly");
    expect(draft.compensationMin).toBe(25);
    expect(draft.compensationMax).toBe(75);
  });

  it("round-trips the jam link, roles, and stack", () => {
    const draft = draftFromPost(post);
    expect(draft.jamId).toBe(7);
    expect(draft.roleIds).toEqual([3, 9]);
    expect(draft.skillIds).toEqual([11, 12]);
  });

  it("treats an unlinked jam as no selection rather than null", () => {
    expect(draftFromPost({ ...post, jamId: null }).jamId).toBeUndefined();
  });

  it("round-trips the project link", () => {
    expect(draftFromPost({ ...post, projectId: "proj-1" }).projectId).toBe("proj-1");
    expect(draftFromPost(post).projectId).toBeUndefined();
  });

  it("seeds contact from the gated companion, not the post", () => {
    // The real shape now: `getPost` is anonymous and edge-cached, so it
    // carries no contact at all and the page passes it in separately.
    const { contactMethod: _m, contactType: _t, ...publicPost } = post;
    const draft = draftFromPost(publicPost, {
      contactType: "discord_server",
      contactMethod: "https://discord.gg/example",
    });
    expect(draft.contactType).toBe("discord_server");
    expect(draft.contactMethod).toBe("https://discord.gg/example");
  });

  it("falls back to an empty contact step when the gate withheld it", () => {
    // Only reachable for a viewer who is not the author — `getPostViewerState`
    // always serves the author their own contact precisely because
    // `updatePost` writes the post's complete state and a blank step here
    // would clear the field on save.
    const { contactMethod: _m, contactType: _t, ...publicPost } = post;
    const draft = draftFromPost(publicPost, null);
    expect(draft.contactMethod).toBe("");
    expect(draft.contactType).toBeUndefined();
  });

  it("produces a draft the server schema accepts", () => {
    const draft = draftFromPost(post);
    const parsed = postContentSchema.safeParse({
      type: draft.type,
      jamId: draft.jamId,
      title: draft.title,
      description: draft.description,
      projectName: draft.projectName,
      compensationType: draft.compensationType,
      compensationMin: draft.compensationMin,
      compensationMax: draft.compensationMax,
      projectLength: draft.projectLength,
      platforms: draft.platforms,
      experienceLevel: draft.experienceLevel,
      portfolioUrl: draft.portfolioUrl,
      contactType: draft.contactType,
      contactMethod: draft.contactMethod,
      isIndividual: draft.isIndividual,
      roleIds: draft.roleIds,
      skillIds: draft.skillIds,
    });
    expect(parsed.success).toBe(true);
  });

  it("offers no edit path for the deferred types", () => {
    expect(isEditablePostType("paid")).toBe(true);
    expect(isEditablePostType("hobby")).toBe(true);
    expect(isEditablePostType("playtest")).toBe(false);
    expect(isEditablePostType("mentor")).toBe(false);
  });
});

describe("board filter input", () => {
  it("registers the role counter alongside the other facet counts", () => {
    expect(router.countPostsByRole).toBeDefined();
  });

  it("maps URL search params onto the shape listPosts takes", () => {
    const input = collabFacetInput({ jam: 42, skills: [1, 2], roles: [3] });
    expect(input.jamId).toBe(42);
    expect(input.skillIds).toEqual([1, 2]);
    expect(input.roleIds).toEqual([3]);
  });

  it("omits empty facet selections rather than sending empty arrays", () => {
    const input = collabFacetInput({});
    expect(input.skillIds).toBeUndefined();
    expect(input.roleIds).toBeUndefined();
  });

  it("passes the project constraint through and counts it as active", () => {
    expect(collabFacetInput({ project: "proj-1" }).projectId).toBe("proj-1");
    expect(countActiveCollabFilters({ project: "proj-1" })).toBe(1);
  });

  it("maps the solo flag to isIndividual and counts either value as active", () => {
    expect(collabFacetInput({ solo: true }).isIndividual).toBe(true);
    expect(collabFacetInput({ solo: false }).isIndividual).toBe(false);
    expect(collabFacetInput({}).isIndividual).toBeUndefined();
    expect(countActiveCollabFilters({ solo: false })).toBe(1);
  });

  it("trims the search string and drops it when blank", () => {
    expect(collabFacetInput({ q: "  godot " }).search).toBe("godot");
    expect(collabFacetInput({ q: "   " }).search).toBeUndefined();
  });

  it("counts jam and stack as active constraints", () => {
    expect(countActiveCollabFilters({})).toBe(0);
    expect(countActiveCollabFilters({ jam: 42 })).toBe(1);
    expect(countActiveCollabFilters({ jam: 42, skills: [1] })).toBe(2);
  });

  it("ignores sort — it narrows nothing", () => {
    expect(countActiveCollabFilters({ sort: "oldest" })).toBe(0);
  });

  it("sends matchAll only alongside two or more picked skills", () => {
    expect(collabFacetInput({ skills: [1, 2], matchAll: true }).matchAll).toBe(true);
    // On one skill the modes agree, and with none there's nothing to
    // modify — a stale flag in the URL must not fork the query cache.
    expect(collabFacetInput({ skills: [1], matchAll: true }).matchAll).toBeUndefined();
    expect(collabFacetInput({ matchAll: true }).matchAll).toBeUndefined();
    expect(collabFacetInput({ skills: [1, 2] }).matchAll).toBeUndefined();
  });

  it("counts matchAll as a modifier, not a constraint of its own", () => {
    expect(countActiveCollabFilters({ skills: [1, 2], matchAll: true })).toBe(
      countActiveCollabFilters({ skills: [1, 2] }),
    );
  });

  it("resolves sort presets, defaulting to newest", () => {
    expect(sortPreset(undefined)).toMatchObject({ by: "createdAt", order: "desc" });
    expect(sortPreset("oldest")).toMatchObject({ by: "createdAt", order: "asc" });
    expect(sortPreset("active")).toMatchObject({ by: "updatedAt", order: "desc" });
  });
});

describe("projectPrefillValues", () => {
  const project: PickableProject = {
    id: "proj-1",
    title: "Nine Lives",
    type: "game",
    classification: "game",
    embedType: "html",
    url: "https://cat.itch.io/nine-lives",
    imageUrl: null,
    teamIds: [],
  };

  it("takes the project's title as the post's project name", () => {
    const next = projectPrefillValues(project, { portfolioUrl: "", platforms: [] });
    expect(next.projectName).toBe("Nine Lives");
  });

  it("fills blanks only for the URL and platforms", () => {
    const blank = projectPrefillValues(project, { portfolioUrl: "", platforms: [] });
    expect(blank.portfolioUrl).toBe("https://cat.itch.io/nine-lives");
    expect(blank.platforms).toEqual(["Web"]);

    const typed = projectPrefillValues(project, {
      portfolioUrl: "https://my.site",
      platforms: ["PC"],
    });
    expect(typed.portfolioUrl).toBeUndefined();
    expect(typed.platforms).toBeUndefined();
  });

  it("only derives a platform from the browser-playable signal", () => {
    const next = projectPrefillValues(
      { ...project, embedType: "default" },
      { portfolioUrl: "", platforms: [] },
    );
    expect(next.platforms).toBeUndefined();
  });
});

describe("the project name is optional, and a linked project owns it", () => {
  it("gates only a typed name the server would refuse — never a blank or a linked one", () => {
    expect(getStepValidationError("details", validWizardValues({ projectName: "ab" }))).toMatch(
      /at least 3/,
    );
    expect(getStepValidationError("details", validWizardValues({ projectName: "" }))).toBeNull();
    // With a link the field is a readout fed by the canonical row, so it
    // must never be what stands between the user and SUBMIT.
    const linked = validWizardValues({ projectName: "ab", projectId: "proj-1" });
    expect(getStepValidationError("details", linked)).toBeNull();
    expect(getStepValidationError("review", linked)).toBeNull();
  });

  it("appears on the pre-flight only once a name is typed", () => {
    const blank = getPreflightChecks(validWizardValues({ projectName: "" }));
    expect(blank.some((c) => c.tabId === "project")).toBe(false);
    const typed = getPreflightChecks(validWizardValues({ projectName: "ab" }));
    expect(typed.find((c) => c.tabId === "project")?.ok).toBe(false);
    expect(
      getStepValidationError("review", validWizardValues({ projectName: "ab" })),
    ).not.toBeNull();
  });
});
