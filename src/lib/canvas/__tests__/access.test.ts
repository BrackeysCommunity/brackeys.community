import { describe, expect, it } from "vite-plus/test";

import {
  canSetVisibility,
  canvasAccess,
  type CanvasAccess,
  type CanvasAccessSubject,
  type CanvasAccessViewer,
} from "../access";

const personal: CanvasAccessSubject = {
  ownerId: "owner",
  teamId: null,
  visibility: "private",
  hiddenAt: null,
  deletedAt: null,
};
const team: CanvasAccessSubject = { ...personal, teamId: "t1", visibility: "team" };
const when = new Date("2026-09-01");

const guild = { isGuildMember: true };
const viewers = {
  anon: { userId: null },
  stranger: { userId: "x", ...guild },
  owner: { userId: "owner", ...guild },
  editor: { userId: "e", memberRole: "editor", ...guild },
  viewer: { userId: "v", memberRole: "viewer", ...guild },
  teamOwner: { userId: "to", teamRole: "owner", ...guild },
  teamMember: { userId: "tm", teamRole: "member", ...guild },
  staff: { userId: "s", isStaff: true, ...guild },
} satisfies Record<string, CanvasAccessViewer>;

type Row = [string, CanvasAccessSubject, CanvasAccessViewer, CanvasAccess];

const rows: Row[] = [
  // personal, private
  ["personal owner", personal, viewers.owner, "owner"],
  ["invited editor", personal, viewers.editor, "write"],
  ["invited viewer", personal, viewers.viewer, "read"],
  ["stranger on private", personal, viewers.stranger, null],
  ["anon on private", personal, viewers.anon, null],
  ["staff on private", personal, viewers.staff, "read"],
  // team
  ["team owner", team, viewers.teamOwner, "owner"],
  ["team member", team, viewers.teamMember, "write"],
  ["creator no longer on the team", team, viewers.owner, null],
  ["stranger on team canvas", team, viewers.stranger, null],
  // visibility
  ["anon on unlisted", { ...personal, visibility: "unlisted" }, viewers.anon, "read"],
  ["stranger on public", { ...personal, visibility: "public" }, viewers.stranger, "read"],
  ["owner of public keeps owner", { ...personal, visibility: "public" }, viewers.owner, "owner"],
  ["anon on personal public", { ...personal, visibility: "public" }, viewers.anon, "read"],
  [
    "stranger on personal unlisted",
    { ...personal, visibility: "unlisted" },
    viewers.stranger,
    "read",
  ],
  ["anon on team public", { ...team, visibility: "public" }, viewers.anon, "read"],
  ["non-roster member on team public", { ...team, visibility: "public" }, viewers.stranger, "read"],
  [
    "team member on team public keeps write",
    { ...team, visibility: "public" },
    viewers.teamMember,
    "write",
  ],
  [
    "viewer member on public stays read",
    { ...personal, visibility: "public" },
    viewers.viewer,
    "read",
  ],
  [
    "editor member on unlisted writes",
    { ...personal, visibility: "unlisted" },
    viewers.editor,
    "write",
  ],
  ["the team value grants strangers nothing", team, viewers.anon, null],
  [
    "hidden public, stranger",
    { ...personal, visibility: "public", hiddenAt: when },
    viewers.stranger,
    null,
  ],
  [
    "hidden public, editor member",
    { ...personal, visibility: "public", hiddenAt: when },
    viewers.editor,
    null,
  ],
  [
    "hidden public, viewer member",
    { ...personal, visibility: "public", hiddenAt: when },
    viewers.viewer,
    null,
  ],
  [
    "hidden public, owner reads",
    { ...personal, visibility: "public", hiddenAt: when },
    viewers.owner,
    "read",
  ],
  [
    "hidden public, staff reads",
    { ...personal, visibility: "public", hiddenAt: when },
    viewers.staff,
    "read",
  ],
  [
    "hidden team's public canvas, anon",
    { ...team, visibility: "public" },
    { ...viewers.anon, team: { status: "active", hiddenAt: when } },
    null,
  ],
  [
    "owner outside the guild on public reads",
    { ...personal, visibility: "public" },
    { ...viewers.owner, isGuildMember: false },
    "read",
  ],
  [
    "stranger outside the guild on public reads",
    { ...personal, visibility: "public" },
    { ...viewers.stranger, isGuildMember: false },
    "read",
  ],
  // not in the guild
  ["owner outside the guild", personal, { ...viewers.owner, isGuildMember: false }, "read"],
  ["team member outside the guild", team, { ...viewers.teamMember, isGuildMember: false }, "read"],
  ["viewer outside the guild", personal, { ...viewers.viewer, isGuildMember: false }, "read"],
  // deleted
  ["deleted, personal owner", { ...personal, deletedAt: when }, viewers.owner, "owner"],
  ["deleted, personal editor", { ...personal, deletedAt: when }, viewers.editor, null],
  ["deleted, team member can restore", { ...team, deletedAt: when }, viewers.teamMember, "write"],
  ["deleted, team owner", { ...team, deletedAt: when }, viewers.teamOwner, "owner"],
  ["deleted, staff", { ...personal, deletedAt: when }, viewers.staff, null],
  [
    "deleted public, anon",
    { ...personal, visibility: "public", deletedAt: when },
    viewers.anon,
    null,
  ],
  // hidden
  ["hidden, personal owner", { ...personal, hiddenAt: when }, viewers.owner, "read"],
  ["hidden, editor", { ...personal, hiddenAt: when }, viewers.editor, null],
  ["hidden, team owner", { ...team, hiddenAt: when }, viewers.teamOwner, "read"],
  ["hidden, team member", { ...team, hiddenAt: when }, viewers.teamMember, null],
  ["hidden, staff", { ...personal, hiddenAt: when }, viewers.staff, "read"],
  [
    "hidden public, anon",
    { ...personal, visibility: "public", hiddenAt: when },
    viewers.anon,
    null,
  ],
  // the team's own state
  [
    "hidden team, member",
    team,
    { ...viewers.teamMember, team: { status: "active", hiddenAt: when } },
    null,
  ],
  [
    "hidden team, owner",
    team,
    { ...viewers.teamOwner, team: { status: "active", hiddenAt: when } },
    "read",
  ],
  [
    "archived team, owner",
    team,
    { ...viewers.teamOwner, team: { status: "archived", hiddenAt: null } },
    "read",
  ],
  [
    "archived team, member",
    team,
    { ...viewers.teamMember, team: { status: "archived", hiddenAt: null } },
    "read",
  ],
];

describe("canvasAccess", () => {
  it.each(rows)("%s", (_, canvas, viewer, expected) => {
    expect(canvasAccess(canvas, viewer)).toBe(expected);
  });

  it("never gives staff write by virtue of being staff", () => {
    for (const canvas of [personal, team, { ...personal, visibility: "public" }]) {
      expect(canvasAccess(canvas, viewers.staff)).toBe("read");
    }
  });
});

type VisibilityRow = [string, CanvasAccessSubject, CanvasAccessViewer, string, boolean];

/** Who may move a canvas from its current visibility to `to`, through the same access check. */
const visibilityRows: VisibilityRow[] = [
  ["team owner widens to public", team, viewers.teamOwner, "public", true],
  ["team owner widens to unlisted", team, viewers.teamOwner, "unlisted", true],
  ["team owner narrows public", { ...team, visibility: "public" }, viewers.teamOwner, "team", true],
  ["team member can't widen to public", team, viewers.teamMember, "public", false],
  [
    "team member can't widen unlisted to public",
    { ...team, visibility: "unlisted" },
    viewers.teamMember,
    "public",
    false,
  ],
  ["team member can't widen to unlisted", team, viewers.teamMember, "unlisted", false],
  [
    "team member narrows public to team",
    { ...team, visibility: "public" },
    viewers.teamMember,
    "team",
    true,
  ],
  [
    "team member narrows public to unlisted",
    { ...team, visibility: "public" },
    viewers.teamMember,
    "unlisted",
    true,
  ],
  [
    "team member narrows unlisted to team",
    { ...team, visibility: "unlisted" },
    viewers.teamMember,
    "team",
    true,
  ],
  [
    "team member outside the guild can't narrow",
    { ...team, visibility: "public" },
    { ...viewers.teamMember, isGuildMember: false },
    "team",
    false,
  ],
  [
    "archived team member can't narrow",
    { ...team, visibility: "public" },
    { ...viewers.teamMember, team: { status: "archived", hiddenAt: null } },
    "team",
    false,
  ],
  [
    "non-roster stranger can't narrow a public team canvas",
    { ...team, visibility: "public" },
    viewers.stranger,
    "team",
    false,
  ],
  [
    "staff can't change a team canvas",
    { ...team, visibility: "public" },
    viewers.staff,
    "team",
    false,
  ],
  ["personal owner widens", personal, viewers.owner, "public", true],
  ["personal owner narrows", { ...personal, visibility: "public" }, viewers.owner, "private", true],
  [
    "invited editor can't narrow a personal canvas",
    { ...personal, visibility: "public" },
    viewers.editor,
    "private",
    false,
  ],
  ["invited editor can't widen a personal canvas", personal, viewers.editor, "unlisted", false],
  [
    "invited viewer can't narrow",
    { ...personal, visibility: "unlisted" },
    viewers.viewer,
    "private",
    false,
  ],
];

describe("canSetVisibility", () => {
  it.each(visibilityRows)("%s", (_, canvas, viewer, to, expected) => {
    const access = canvasAccess(canvas, viewer);
    expect(canSetVisibility(canvas, access, canvas.visibility, to)).toBe(expected);
  });
});
