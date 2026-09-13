import { describe, expect, it } from "vite-plus/test";

import { USER_AGENT } from "../../../services/discord-bot/src/api";
import { callerKind, procedureName } from "../api.public.rpc.$";

function request(headers: Record<string, string>): Request {
  return new Request("https://brackeys.community/api/public/rpc/getJam", { headers });
}

describe("callerKind", () => {
  it("reads any Sec-Fetch header as a browser", () => {
    expect(callerKind(request({ "sec-fetch-site": "same-origin" }))).toBe("browser");
    expect(callerKind(request({ "sec-fetch-mode": "cors" }))).toBe("browser");
  });

  it("still reads a browser as a browser when it claims to be the bot", () => {
    // Sec-Fetch-* is a forbidden header name, so page script cannot set or
    // clear it — which is the whole reason it, and not the user agent, is
    // what the browser check rests on.
    expect(callerKind(request({ "sec-fetch-site": "same-origin", "user-agent": USER_AGENT }))).toBe(
      "browser",
    );
  });

  it("names the bot by the agent its own client sends", () => {
    expect(callerKind(request({ "user-agent": USER_AGENT }))).toBe("bot");
  });

  it("calls every other headless caller unknown", () => {
    expect(callerKind(request({}))).toBe("unknown");
    expect(callerKind(request({ "user-agent": "curl/8.4.0" }))).toBe("unknown");
    // A near-miss must not be counted as ours.
    expect(callerKind(request({ "user-agent": "brackeys-discord-bot" }))).toBe("unknown");
  });
});

describe("procedureName", () => {
  it("spells a procedure with dots, matching the error reporter", () => {
    expect(procedureName("https://x.dev/api/public/rpc/getJam")).toBe("getJam");
    expect(procedureName("https://x.dev/api/public/rpc/jams/list")).toBe("jams.list");
  });

  it("drops the query string and survives a bare mount", () => {
    expect(procedureName("https://x.dev/api/public/rpc/getJam?input=%7B%7D")).toBe("getJam");
    expect(procedureName("https://x.dev/api/public/rpc")).toBe("");
    expect(procedureName("https://x.dev/api/public/rpc/")).toBe("");
  });

  it("answers empty rather than throwing on an unparseable url", () => {
    expect(procedureName("not a url")).toBe("");
  });
});
