import { describe, expect, it } from "vite-plus/test";

import { channelTokensToNames, publicChannels } from "@/lib/discord-channels";

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
