import { describe, expect, it } from "vite-plus/test";

import {
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
