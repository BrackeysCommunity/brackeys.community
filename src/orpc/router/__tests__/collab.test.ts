import { describe, expect, it } from "vite-plus/test";

import {
  getPreflightChecks,
  getStepValidationError,
  projectLengthForJam,
  projectPrefillValues,
  type PickableProject,
  type WizardFormValues,
} from "@/components/collab/CollabCreateFlyout/shared";
import {
  collabFilterInput,
  countActiveCollabFilters,
  draftFromPost,
  isEditablePostType,
} from "@/lib/collab-store";
import router from "@/orpc/router";
import { assertTeamRequired, postContentSchema } from "@/orpc/router/collab";

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

  it("rejects a post with no platforms", () => {
    expect(postContentSchema.safeParse(validPost({ platforms: [] })).success).toBe(false);
  });

  it("rejects a post with no roles", () => {
    expect(postContentSchema.safeParse(validPost({ roleIds: [] })).success).toBe(false);
  });

  it.each(["projectLength", "experienceLevel", "projectName"])(
    "rejects a post missing %s",
    (field) => {
      const input = validPost();
      delete (input as Record<string, unknown>)[field];
      expect(postContentSchema.safeParse(input).success).toBe(false);
    },
  );

  it("requires contact details on a team post", () => {
    const input = validPost();
    delete (input as Record<string, unknown>).contactType;
    delete (input as Record<string, unknown>).contactMethod;
    expect(postContentSchema.safeParse(input).success).toBe(false);
  });

  it("lets a solo post omit contact details, since a DM is the fallback", () => {
    const input = validPost({ isIndividual: true });
    delete (input as Record<string, unknown>).contactType;
    delete (input as Record<string, unknown>).contactMethod;
    expect(postContentSchema.safeParse(input).success).toBe(true);
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

// ── Required linkage (v2): solo/team × linked/legacy × create/edit ────

describe("assertTeamRequired", () => {
  const linked = { isIndividual: false, teamId: "t1" };
  const legacyUnlinked = { isIndividual: false, teamId: null };
  const solo = { isIndividual: true, teamId: null };

  it("lets solo posts and linked team posts through", () => {
    expect(() => assertTeamRequired({ isIndividual: true })).not.toThrow();
    expect(() => assertTeamRequired({ teamId: "t1" })).not.toThrow();
  });

  it("rejects creating an unlinked team post", () => {
    expect(() => assertTeamRequired({})).toThrow(/team page/i);
    expect(() => assertTeamRequired({ isIndividual: false, teamId: null })).toThrow(/team page/i);
  });

  it("exempts editing a legacy unlinked team post", () => {
    expect(() => assertTeamRequired({ teamId: null }, legacyUnlinked)).not.toThrow();
  });

  it("won't let an edit unlink a linked post or flip solo→team without a link", () => {
    expect(() => assertTeamRequired({ teamId: null }, linked)).toThrow(/team page/i);
    expect(() => assertTeamRequired({ isIndividual: false, teamId: null }, solo)).toThrow(
      /team page/i,
    );
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

  it("requires a team post to pick or name a team", () => {
    expect(getStepValidationError("team", validWizardValues({ newTeamName: "" }))).not.toBeNull();
    expect(getStepValidationError("team", validWizardValues({ newTeamName: "x" }))).not.toBeNull();
  });

  it("profanity-checks the new-team name and description", () => {
    expect(getStepValidationError("team", validWizardValues({ newTeamName: "shit" }))).toMatch(
      /inappropriate/,
    );
    expect(
      getStepValidationError("team", validWizardValues({ newTeamDescription: "shit" })),
    ).toMatch(/inappropriate/);
  });

  it("exempts a legacy unlinked edit — but still validates a typed name", () => {
    const legacy = { legacyUnlinkedEdit: true };
    expect(
      getStepValidationError("team", validWizardValues({ newTeamName: "" }), legacy),
    ).toBeNull();
    expect(
      getStepValidationError("team", validWizardValues({ newTeamName: "x" }), legacy),
    ).not.toBeNull();
  });

  it("re-checks the team step at review", () => {
    expect(getStepValidationError("review", validWizardValues({ newTeamName: "" }))).not.toBeNull();
    expect(
      getStepValidationError("review", validWizardValues({ newTeamName: "" }), {
        legacyUnlinkedEdit: true,
      }),
    ).toBeNull();
  });

  it("requires at least one role — the step used to be silently optional", () => {
    expect(getStepValidationError("roles", validWizardValues({ roleIds: [] }))).not.toBeNull();
  });

  it("re-checks earlier steps at review, so submit can't be reached around them", () => {
    expect(getStepValidationError("review", validWizardValues({ roleIds: [] }))).not.toBeNull();
    expect(getStepValidationError("review", validWizardValues({ platforms: [] }))).not.toBeNull();
    expect(
      getStepValidationError("review", validWizardValues({ contactMethod: "" })),
    ).not.toBeNull();
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

  // The PROJECT step describes the project entity and nothing else, so
  // the post's own terms have to gate on BASICS or they gate nowhere.
  it("gates the post's terms on basics, not on the project step", () => {
    for (const partial of [
      { platforms: [] },
      { projectLength: undefined },
      { experienceLevel: undefined },
      { contactMethod: "" },
    ] satisfies Partial<WizardFormValues>[]) {
      const v = validWizardValues(partial);
      expect(getStepValidationError("basics", v)).not.toBeNull();
      expect(getStepValidationError("details", v)).toBeNull();
    }
  });

  it("still gates a free-text project name on the project step", () => {
    expect(
      getStepValidationError("details", validWizardValues({ projectName: "" })),
    ).not.toBeNull();
    // A linked project owns the name, so the readout can't be a gate.
    expect(
      getStepValidationError("details", validWizardValues({ projectName: "", projectId: "p1" })),
    ).toBeNull();
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
      { platforms: [] },
      { projectName: "" },
      { title: "short" },
      { contactMethod: "" },
      { newTeamName: "" },
    ] satisfies Partial<WizardFormValues>[]) {
      const v = validWizardValues(partial);
      expect(getPreflightChecks(v).every((c) => c.ok)).toBe(false);
      expect(getStepValidationError("review", v)).not.toBeNull();
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
  const base = {
    type: undefined,
    roleIds: [],
    skillIds: [],
    jamId: undefined,
    teamId: undefined,
    projectId: undefined,
    status: undefined,
    search: "",
    sortBy: "createdAt" as const,
    sortOrder: "desc" as const,
    experienceLevel: undefined,
    compensationType: undefined,
    isIndividual: undefined,
  };

  it("passes jam and stack constraints through to listPosts", () => {
    const input = collabFilterInput({ ...base, jamId: 42, skillIds: [1, 2] });
    expect(input.jamId).toBe(42);
    expect(input.skillIds).toEqual([1, 2]);
  });

  it("omits empty stack selections rather than sending an empty array", () => {
    expect(collabFilterInput(base).skillIds).toBeUndefined();
  });

  it("passes the project constraint through and counts it as active", () => {
    expect(collabFilterInput({ ...base, projectId: "proj-1" }).projectId).toBe("proj-1");
    expect(countActiveCollabFilters({ ...base, projectId: "proj-1" })).toBe(1);
  });

  it("counts jam and stack as active constraints", () => {
    expect(countActiveCollabFilters(base)).toBe(0);
    expect(countActiveCollabFilters({ ...base, jamId: 42 })).toBe(1);
    expect(countActiveCollabFilters({ ...base, jamId: 42, skillIds: [1] })).toBe(2);
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

describe("a linked project owns the post's project name", () => {
  it("stops gating on the name the user cannot edit", () => {
    // Without a link, a too-short name is a real block…
    const typed = validWizardValues({ projectName: "ab" });
    expect(getStepValidationError("details", typed)).toMatch(/at least 3/);
    // …with one, the field is a readout fed by the canonical row, so it
    // must never be what stands between the user and SUBMIT.
    const linked = validWizardValues({ projectName: "ab", projectId: "proj-1" });
    expect(getStepValidationError("details", linked)).toBeNull();
    expect(getStepValidationError("review", linked)).toBeNull();
  });

  it("keeps the pre-flight row satisfied and relabels it", () => {
    const linked = validWizardValues({ projectName: "", projectId: "proj-1" });
    const row = getPreflightChecks(linked).find((c) => c.tabId === "project" && c.ok);
    expect(row?.label).toBe("Project linked");
    const unlinked = getPreflightChecks(validWizardValues({ projectName: "" }));
    expect(unlinked.find((c) => c.label === "Project named")?.ok).toBe(false);
  });
});
