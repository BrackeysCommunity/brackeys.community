import { describe, expect, it } from "vite-plus/test";

import { signRelay, verifyRelay } from "@/lib/bot-relay-signature";

const body = JSON.stringify({ discordId: "100000000000000003" });

describe("bot relay signature", () => {
  it("accepts what it signed", async () => {
    expect(await verifyRelay("secret", body, await signRelay("secret", body))).toBe(true);
  });

  it("refuses another key, another body, or no header", async () => {
    const header = await signRelay("secret", body);
    expect(await verifyRelay("other", body, header)).toBe(false);
    expect(await verifyRelay("secret", body.replace("3", "4"), header)).toBe(false);
    expect(await verifyRelay("secret", body, null)).toBe(false);
  });

  it("refuses a signature outside the skew window", async () => {
    const now = Date.now();
    const header = await signRelay("secret", body, now - 10 * 60_000);
    expect(await verifyRelay("secret", body, header, now)).toBe(false);
  });
});
