// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { SITE_SAVE_EXPIRY_DAYS, SITE_SAVE_LIMITS } from "@/lib/engine/limits";
import { SIGNED_OUT_SAVES_DESCRIBE } from "@/lib/engine/local-saves";
import { SIGNED_IN_SAVES_DESCRIBE } from "@/lib/engine/save-api";
import { formatBytes } from "@/lib/format-bytes";
import { SITE } from "@/lib/legal-meta";

import { SaveNotice } from "../SaveNotice";

afterEach(cleanup);

const PREFS =
  "Key bindings, volume, language and caption settings stay in this browser and are never uploaded.";

function text(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("SaveNotice", () => {
  it("site: account saves with the site's numbers, browser saves signed out", () => {
    const { container } = render(<SaveNotice mode="site" connectOrigins={[]} />);
    const body = text(container);
    expect(body).toContain(
      `Saves. Signed in, this game saves to your ${SITE.name} account: up to ${SITE_SAVE_LIMITS.maxSlots} saves of ` +
        `${formatBytes(SITE_SAVE_LIMITS.maxBytes)}, deleted after ${SITE_SAVE_EXPIRY_DAYS} days you don't use them. ` +
        "Signed out, saves stay in this browser until you clear its site data.",
    );
    expect(body).toContain("up to 4 saves of 32 KB, deleted after 180 days");
    expect(body).toContain(PREFS);
    expect(body).not.toContain("connects to");
  });

  it("own: names the game's own servers", () => {
    const origins = ["https://saves.example.test", "https://api.example.test"];
    const { container } = render(<SaveNotice mode="own" connectOrigins={origins} />);
    const body = text(container);
    expect(body).toContain(
      `Saves. This game keeps its saves on its own servers (https://saves.example.test, https://api.example.test). ${SITE.name} doesn't store or control them.`,
    );
    expect(body).toContain(PREFS);
    expect(body).toContain(
      "This game connects to: https://saves.example.test, https://api.example.test. Those sites' own terms apply to what you send them.",
    );
  });

  it("none: says the game doesn't save", () => {
    const { container } = render(<SaveNotice mode="none" connectOrigins={[]} />);
    const body = text(container);
    expect(body).toContain("Saves. This game doesn't save progress.");
    expect(body).toContain(PREFS);
    expect(body).not.toContain(SITE.name);
  });

  it("lists connect origins for any mode", () => {
    const { container } = render(
      <SaveNotice mode="site" connectOrigins={["https://leaderboard.example.test"]} />,
    );
    expect(text(container)).toContain(
      "This game connects to: https://leaderboard.example.test. Those sites' own terms apply to what you send them.",
    );
  });

  it("is the one paragraph under the play page's Saves menu, never the save menu's sentence too", () => {
    const { container } = render(<SaveNotice mode="site" connectOrigins={[]} />);
    const body = text(container);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(body).not.toContain(SIGNED_IN_SAVES_DESCRIBE);
    expect(body).not.toContain(SIGNED_OUT_SAVES_DESCRIBE);
  });
});
