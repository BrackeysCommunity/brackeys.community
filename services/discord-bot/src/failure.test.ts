import { describe, expect, test } from "bun:test";

import { ApiUnavailableError } from "./api.ts";
import { classifyFailure, failureEmbed } from "./failure.ts";
import { siteName } from "./reply.ts";

const opts = { appUrl: "https://brackeys.community", label: "member" };

describe("classifyFailure", () => {
  test("separates the reasons a command can fail", () => {
    expect(classifyFailure(new ApiUnavailableError("timeout", null)).kind).toBe("timeout");
    expect(classifyFailure(new ApiUnavailableError("error", null)).kind).toBe("unreachable");
    // A procedure the deployed site does not have — what /member by mention
    // hit while the prod web app lagged behind the bot.
    expect(classifyFailure({ status: 404 })).toEqual({ kind: "unsupported", code: "HTTP 404" });
    expect(classifyFailure({ status: 429 })).toEqual({ kind: "throttled", code: "HTTP 429" });
    expect(classifyFailure({ status: 400 })).toEqual({ kind: "rejected", code: "HTTP 400" });
    expect(classifyFailure(new Error("boom"))).toEqual({ kind: "bug", code: "internal" });
  });
});

describe("failureEmbed", () => {
  test("names the site and carries the code in the footer", () => {
    const embed = failureEmbed({ kind: "unsupported", code: "HTTP 404" }, opts);
    expect(embed.title).toBe("Not available yet");
    expect(embed.description).toContain("brackeys.community");
    expect(embed.footer).toBe("HTTP 404 · /member");
  });

  test("a hint is appended when there is something better to try", () => {
    const embed = failureEmbed(
      { kind: "unsupported", code: "HTTP 404" },
      {
        ...opts,
        hint: "`/member name:` works in the meantime.",
      },
    );
    expect(embed.description).toContain("`/member name:` works in the meantime.");
  });

  test("siteName strips the scheme so copy reads as a site, not a URL", () => {
    expect(siteName("https://brackeys.community")).toBe("brackeys.community");
    expect(siteName("https://staging.brackeys.dev")).toBe("staging.brackeys.dev");
  });
});
