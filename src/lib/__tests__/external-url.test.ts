import { describe, expect, it } from "vite-plus/test";

import {
  externalUrlHost,
  externalUrlSchema,
  isHostOrSubdomainOf,
  optionalExternalUrlSchema,
} from "../external-url";

describe("externalUrlSchema", () => {
  // The five strings the bare `z.url()` these replaced accepted clean.
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "https://user:pw@evil.example/x",
  ])("rejects %s", (value) => {
    expect(externalUrlSchema.safeParse(value).success).toBe(false);
  });

  it("accepts http and https links", () => {
    expect(externalUrlSchema.parse("https://itch.io/jam/gmtk")).toBe("https://itch.io/jam/gmtk");
    expect(externalUrlSchema.parse("http://old-personal-site.example")).toBe(
      "http://old-personal-site.example",
    );
  });

  it("rejects a bare host with no scheme", () => {
    expect(externalUrlSchema.safeParse("example.com").success).toBe(false);
  });

  it("rejects a link past the column length", () => {
    expect(externalUrlSchema.safeParse(`https://e.example/${"a".repeat(500)}`).success).toBe(false);
  });

  it("allows the empty string only in the optional form", () => {
    expect(optionalExternalUrlSchema.parse("")).toBe("");
    expect(externalUrlSchema.safeParse("").success).toBe(false);
  });
});

describe("externalUrlHost", () => {
  it("returns the host a viewer would land on, without www.", () => {
    expect(externalUrlHost("https://www.example.com/a/b?c=d")).toBe("example.com");
    expect(externalUrlHost("https://cookie.itch.io/game")).toBe("cookie.itch.io");
  });

  it("returns null for anything it would not render", () => {
    expect(externalUrlHost("javascript:alert(1)")).toBe(null);
    expect(externalUrlHost(null)).toBe(null);
  });
});

describe("isHostOrSubdomainOf", () => {
  it("matches the host itself and its subdomains", () => {
    expect(isHostOrSubdomainOf("https://itch.io/jam/gmtk", "itch.io")).toBe(true);
    expect(isHostOrSubdomainOf("https://cookie.itch.io/game", "itch.io")).toBe(true);
  });

  it("does not match a host that merely ends with the name", () => {
    expect(isHostOrSubdomainOf("https://notitch.io/x", "itch.io")).toBe(false);
    expect(isHostOrSubdomainOf("https://evil.example/itch.io", "itch.io")).toBe(false);
  });
});
