import { describe, expect, it } from "vite-plus/test";

import { channelTokensToNames, publicChannels, publicThread } from "@/lib/discord-channels";
import { discordMentionsToNames, roleColor } from "@/lib/discord-mentions";

const GUILD = "243005537342586880";
const VIEW = String(1 << 10);
const everyoneOverwrite = (allow: string, deny: string) => ({ id: GUILD, type: 0, allow, deny });

describe("publicChannels", () => {
  const raw = [
    { id: "1", name: "general", type: 0 },
    { id: "2", name: "staff", type: 0, permission_overwrites: [everyoneOverwrite("0", VIEW)] },
    { id: "3", name: "Info", type: 4 },
    { id: "4", name: "rules", type: 0, permission_overwrites: [everyoneOverwrite(VIEW, "0")] },
    {
      id: "5",
      name: "mods-only-member-ow",
      type: 0,
      permission_overwrites: [{ id: "999", type: 1, allow: VIEW, deny: "0" }],
    },
  ];

  it("tags voice channels apart from text ones", () => {
    const kinds = publicChannels(GUILD, VIEW, [
      { id: "6", name: "forum", type: 15 },
      { id: "7", name: "+ Create Channel", type: 2 },
    ]).map((c) => c.kind);
    expect(kinds).toEqual(["text", "voice"]);
  });

  it("drops channels @everyone is denied, and categories", () => {
    expect(publicChannels(GUILD, VIEW, raw).map((c) => c.name)).toEqual([
      "general",
      "rules",
      "mods-only-member-ow",
    ]);
  });

  it("only keeps explicit allows when @everyone can't view by default", () => {
    expect(publicChannels(GUILD, "0", raw).map((c) => c.name)).toEqual(["rules"]);
  });

  it("keeps everything when @everyone is an administrator", () => {
    expect(publicChannels(GUILD, String(1 << 3), raw)).toHaveLength(4);
  });
});

describe("channelTokensToNames", () => {
  it("replaces tokens with a generic word", () => {
    expect(channelTokensToNames("see <#552209553886806046>!")).toBe("see #channel!");
  });
});

describe("publicThread", () => {
  const visible = new Set(["1"]);

  it("keeps public threads under a visible channel", () => {
    expect(publicThread({ id: "9", name: "help", type: 11, parent_id: "1" }, visible)).toEqual({
      id: "9",
      name: "help",
      kind: "thread",
    });
  });

  it("drops private threads and threads under hidden channels", () => {
    expect(publicThread({ id: "9", name: "x", type: 12, parent_id: "1" }, visible)).toBeNull();
    expect(publicThread({ id: "9", name: "x", type: 11, parent_id: "2" }, visible)).toBeNull();
    expect(publicThread({ id: "9", name: "x", type: 0, parent_id: "1" }, visible)).toBeNull();
  });
});

describe("Discord mentions", () => {
  it("reduce to plain words", () => {
    expect(
      discordMentionsToNames("<@200000000000000001> <@!200000000000000001> <@&900000000000000001>"),
    ).toBe("@user @user @role");
  });

  it("formats role colors", () => {
    expect(roleColor(0xe91e63)).toBe("#e91e63");
    expect(roleColor(0x00ff)).toBe("#0000ff");
    expect(roleColor(0)).toBeNull();
  });
});
