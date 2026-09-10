import { describe, expect, it } from "vite-plus/test";

import { projectCtaLabel } from "../project-links";

describe("projectCtaLabel", () => {
  it("names itch.io only when the link actually goes there", () => {
    expect(projectCtaLabel({ type: "game", url: "https://cookie.itch.io/thing" })).toBe(
      "PLAY ON ITCH.IO",
    );
    // The type is owner-editable and so is the URL — this was the phishing
    // primitive: a big trusted button reading ITCH.IO, pointing anywhere.
    expect(projectCtaLabel({ type: "game", url: "https://example.com" })).toBe("PLAY");
    expect(projectCtaLabel({ type: "game", url: null })).toBe("PLAY");
  });

  it("keeps the browser-playable promise, which names no host", () => {
    expect(projectCtaLabel({ type: "game", embedType: "html", url: "https://example.com" })).toBe(
      "PLAY IN BROWSER",
    );
  });

  it("leaves the host-neutral labels alone", () => {
    expect(projectCtaLabel({ type: "tool", url: "https://example.com" })).toBe("DOWNLOAD");
    expect(projectCtaLabel({ type: "assets", url: "https://itch.io/x" })).toBe("GET THE PACK");
    expect(projectCtaLabel({ type: "nonsense", url: "https://example.com" })).toBe("VIEW PROJECT");
  });
});
