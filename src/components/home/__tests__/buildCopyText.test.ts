import { describe, expect, it } from "vite-plus/test";

import type { BotCommand } from "@/data/commands";

import { buildCopyText } from "../CommandRow";

// ── Fixtures ────────────────────────────────────────────────────────────────

const noOptionsCmd: BotCommand = {
  id: "hammer-selfhistory",
  bot: "hammer",
  cmd: "/selfhistory",
  description: "Returns your own infraction history on the server.",
};

const ruleCmd: BotCommand = {
  id: "hammer-rule",
  bot: "hammer",
  cmd: "/rule",
  description: "Returns information about a specific server rule.",
  options: [{ name: "rule", description: "Rule number (1–11)", required: true, default: "1" }],
};

const colorCmd: BotCommand = {
  id: "pencil-color",
  bot: "pencil",
  cmd: "/color",
  description: "Displays detailed information about a color.",
  options: [
    { name: "color", description: "The color to display", required: true, default: "#fff" },
    { name: "mention", description: "User to mention with the result" },
  ],
};

const texCmd: BotCommand = {
  id: "pencil-tex",
  bot: "pencil",
  cmd: "/tex",
  description: "Nicely renders TeX formatted content inline in Discord.",
  options: [
    {
      name: "expression",
      description: "The TeX expression to render",
      required: true,
      default: "\\sqrt{b^2 - 4ac}",
    },
    { name: "spoiler", description: "Hide the result as a spoiler", default: "True" },
    { name: "mention", description: "User to mention with the result" },
  ],
};

const userinfoCmd: BotCommand = {
  id: "hammer-userinfo",
  bot: "hammer",
  cmd: "/userinfo",
  description: "Returns base level information about a Discord member.",
  options: [{ name: "user", description: "The user to look up", required: true }],
};

const multiMentionCmd: BotCommand = {
  id: "test-multi",
  bot: "pencil",
  cmd: "/multi",
  description: "A command with both user and mention options.",
  options: [
    { name: "color", description: "Color", required: true, default: "red" },
    { name: "user", description: "The user", required: true },
    { name: "mention", description: "Mention someone" },
  ],
};

// ── No username (logged out) ────────────────────────────────────────────────

describe("buildCopyText (logged out — no username)", () => {
  it("returns just the command for a command with no options", () => {
    expect(buildCopyText(noOptionsCmd)).toBe("/selfhistory");
  });

  it("returns just the command for a command with undefined options", () => {
    const cmd: BotCommand = { ...noOptionsCmd, options: undefined };
    expect(buildCopyText(cmd)).toBe("/selfhistory");
  });

  it("returns just the command for a command with empty options array", () => {
    const cmd: BotCommand = { ...noOptionsCmd, options: [] };
    expect(buildCopyText(cmd)).toBe("/selfhistory");
  });

  it("includes non-mention options with their defaults", () => {
    expect(buildCopyText(ruleCmd)).toBe("/rule rule:1");
  });

  it("filters out the mention option", () => {
    expect(buildCopyText(colorCmd)).toBe("/color color:#fff");
  });

  it("filters out mention but keeps all other options", () => {
    expect(buildCopyText(texCmd)).toBe("/tex expression:\\sqrt{b^2 - 4ac} spoiler:True");
  });

  it("filters out the user option", () => {
    expect(buildCopyText(userinfoCmd)).toBe("/userinfo");
  });

  it("filters out both user and mention options", () => {
    expect(buildCopyText(multiMentionCmd)).toBe("/multi color:red");
  });
});

// ── With username (logged in) ───────────────────────────────────────────────

describe("buildCopyText (logged in — with username)", () => {
  const username = "joshcomplex";

  it("returns just the command for a command with no options", () => {
    expect(buildCopyText(noOptionsCmd, username)).toBe("/selfhistory");
  });

  it("includes non-mention options with their defaults", () => {
    expect(buildCopyText(ruleCmd, username)).toBe("/rule rule:1");
  });

  it("includes mention option with the logged-in username", () => {
    expect(buildCopyText(colorCmd, username)).toBe("/color color:#fff mention:@joshcomplex");
  });

  it("includes mention among multiple options with username", () => {
    expect(buildCopyText(texCmd, username)).toBe(
      "/tex expression:\\sqrt{b^2 - 4ac} spoiler:True mention:@joshcomplex",
    );
  });

  it("replaces user option with the logged-in username", () => {
    expect(buildCopyText(userinfoCmd, username)).toBe("/userinfo user:@joshcomplex");
  });

  it("replaces both user and mention options with the username", () => {
    expect(buildCopyText(multiMentionCmd, username)).toBe(
      "/multi color:red user:@joshcomplex mention:@joshcomplex",
    );
  });

  it("works with different usernames", () => {
    expect(buildCopyText(colorCmd, "mellobacon")).toBe("/color color:#fff mention:@mellobacon");
  });

  it("works with usernames containing special characters", () => {
    expect(buildCopyText(colorCmd, "user.name_123")).toBe(
      "/color color:#fff mention:@user.name_123",
    );
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("buildCopyText (edge cases)", () => {
  it("treats empty string username as logged out (falsy)", () => {
    expect(buildCopyText(colorCmd, "")).toBe("/color color:#fff");
  });

  it("handles option with undefined default gracefully", () => {
    const cmd: BotCommand = {
      id: "test",
      bot: "hammer",
      cmd: "/test",
      description: "test",
      options: [{ name: "rule", description: "rule", required: true }],
    };
    expect(buildCopyText(cmd)).toBe("/test rule:undefined");
  });

  it("preserves option ordering from the command definition", () => {
    const cmd: BotCommand = {
      id: "test-order",
      bot: "pencil",
      cmd: "/ordered",
      description: "test ordering",
      options: [
        { name: "mention", description: "mention" },
        { name: "color", description: "color", default: "blue" },
        { name: "spoiler", description: "spoiler", default: "False" },
      ],
    };
    expect(buildCopyText(cmd, "testuser")).toBe(
      "/ordered mention:@testuser color:blue spoiler:False",
    );
  });

  it("handles a command where mention is the only option (logged out)", () => {
    const cmd: BotCommand = {
      id: "test-mention-only",
      bot: "pencil",
      cmd: "/ping",
      description: "Just mentions someone",
      options: [{ name: "mention", description: "User to ping" }],
    };
    expect(buildCopyText(cmd)).toBe("/ping");
  });

  it("handles a command where mention is the only option (logged in)", () => {
    const cmd: BotCommand = {
      id: "test-mention-only",
      bot: "pencil",
      cmd: "/ping",
      description: "Just mentions someone",
      options: [{ name: "mention", description: "User to ping" }],
    };
    expect(buildCopyText(cmd, "someone")).toBe("/ping mention:@someone");
  });
});
