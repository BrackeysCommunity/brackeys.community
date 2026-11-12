import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { frameBase, frameCsp, playOrigin } from "../frame-csp";

const RELEASE = "c".repeat(64);
const BASE = `https://play.example.test/frames/${RELEASE}/`;
const SITE = "https://site.example.test";

afterEach(() => vi.unstubAllEnvs());

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name!, values];
    }),
  );
}

describe("frameCsp", () => {
  const csp = frameCsp({ base: BASE, siteOrigin: SITE, connect: [], syncOrigin: null });
  const d = directives(csp);

  it("confines every source to the release's own directory", () => {
    expect(d.get("default-src")).toEqual(["'none'"]);
    expect(d.get("script-src")).toEqual([BASE, "'wasm-unsafe-eval'"]);
    expect(d.get("style-src")).toEqual([BASE, "'unsafe-inline'"]);
    expect(d.get("img-src")).toEqual([BASE, "blob:", "data:"]);
    expect(d.get("media-src")).toEqual([BASE, "blob:"]);
    expect(d.get("font-src")).toEqual([BASE, "data:"]);
    expect(d.get("connect-src")).toEqual([BASE, "blob:", "data:"]);
    expect(d.get("worker-src")).toEqual(["blob:"]);
    expect(d.get("manifest-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'none'"]);
    expect(d.get("form-action")).toEqual(["'none'"]);
    expect(d.get("frame-ancestors")).toEqual([SITE]);
    expect(csp).not.toContain("'self'");
  });

  it("carries the iframe's sandbox", () => {
    expect(d.get("sandbox")).toEqual([
      "allow-scripts",
      "allow-pointer-lock",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
    ]);
  });

  it("never allows inline or eval'd scripts", () => {
    for (const opts of [
      { connect: [], syncOrigin: null },
      { connect: ["https://api.example.test"], syncOrigin: "wss://sync.example.test" },
    ]) {
      const script = directives(frameCsp({ base: BASE, siteOrigin: SITE, ...opts })).get(
        "script-src",
      )!;
      expect(script).not.toContain("'unsafe-inline'");
      expect(script).not.toContain("'unsafe-eval'");
      expect(script).not.toContain("blob:");
      expect(script).not.toContain("data:");
    }
  });

  it("adds the declared connect origins", () => {
    const connect = directives(
      frameCsp({
        base: BASE,
        siteOrigin: SITE,
        connect: ["https://api.example.test", "wss://socket.example.test:8443"],
        syncOrigin: null,
      }),
    ).get("connect-src");
    expect(connect).toEqual([
      BASE,
      "blob:",
      "data:",
      "https://api.example.test",
      "wss://socket.example.test:8443",
    ]);
  });

  it("adds the sync origin only when online", () => {
    const offline = frameCsp({ base: BASE, siteOrigin: SITE, connect: [], syncOrigin: null });
    expect(offline).not.toContain("sync.example.test");
    const online = directives(
      frameCsp({
        base: BASE,
        siteOrigin: SITE,
        connect: [],
        syncOrigin: "wss://sync.example.test/ws",
      }),
    );
    expect(online.get("connect-src")).toEqual([BASE, "blob:", "data:", "wss://sync.example.test"]);
  });

  it("drops a connect value that isn't a plain https or wss origin", () => {
    const csp = frameCsp({
      base: BASE,
      siteOrigin: SITE,
      connect: [
        "http://plain.example.test",
        "https://ok.example.test; script-src *",
        "javascript:alert(1)",
        "https://user:pass@creds.example.test",
        "not a url",
      ],
      syncOrigin: null,
    });
    expect(directives(csp).get("connect-src")).toEqual([BASE, "blob:", "data:"]);
    expect(csp.split(";")).toHaveLength(13);
  });

  it("scopes a private release to its token's directory", () => {
    const base = frameBase(RELEASE, "tok.en", "https://play.example.test");
    expect(base).toBe(`https://play.example.test/frames-private/${RELEASE}/tok.en/`);
    const d = directives(frameCsp({ base, siteOrigin: SITE, connect: [], syncOrigin: null }));
    expect(d.get("script-src")).toEqual([base, "'wasm-unsafe-eval'"]);
  });

  it("refuses a base that isn't a directory URL", () => {
    for (const base of [
      `https://play.example.test/frames/${RELEASE}`,
      "https://play.example.test/frames/x/; script-src * /",
      "frames/x/",
    ]) {
      expect(() => frameCsp({ base, siteOrigin: SITE, connect: [], syncOrigin: null })).toThrow();
    }
  });
});

describe("playOrigin", () => {
  it("is ENGINE_PLAY_ORIGIN when set, without a trailing slash", () => {
    vi.stubEnv("ENGINE_PLAY_ORIGIN", "https://play.example.test/");
    expect(playOrigin()).toBe("https://play.example.test");
    expect(frameBase(RELEASE)).toBe(`https://play.example.test/frames/${RELEASE}/`);
  });

  it("falls back to the site's own origin", async () => {
    vi.stubEnv("ENGINE_PLAY_ORIGIN", "");
    const { siteOrigin } = await import("@/env");
    expect(playOrigin()).toBe(siteOrigin());
  });
});
