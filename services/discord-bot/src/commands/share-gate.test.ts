import { describe, expect, test } from "bun:test";

import { decideShare, shareNotice, type ShareGateConfig } from "./share-gate.ts";

const ADMIN = "451380371284557824";
const MOD = "756178968901582859";
const GURU = "439862048185253891";
const BOT_CHANNEL = "433649136370450462";

const gate: ShareGateConfig = {
  roleIds: [ADMIN, MOD, GURU],
  botChannelId: BOT_CHANNEL,
  botChannelName: "bot",
};

const ask = (over: Partial<Parameters<typeof decideShare>[0]> = {}) => ({
  wanted: true,
  actorRoleIds: [] as string[],
  channelId: "999",
  ...over,
});

describe("share gate", () => {
  test("a member with no staff role cannot share into a channel", () => {
    const decision = decideShare(ask(), gate);
    expect(decision.shared).toBe(false);
    expect(decision.denied).toBe(true);
  });

  test("each of the three roles may share anywhere", () => {
    for (const role of [ADMIN, MOD, GURU]) {
      expect(decideShare(ask({ actorRoleIds: [role] }), gate).shared).toBe(true);
    }
  });

  test("an unrelated role is not a pass", () => {
    expect(decideShare(ask({ actorRoleIds: ["1234567890123456789"] }), gate).shared).toBe(false);
  });

  test("anyone may share inside the bot channel", () => {
    expect(decideShare(ask({ channelId: BOT_CHANNEL }), gate).shared).toBe(true);
  });

  test("not asking to share is never a refusal", () => {
    const decision = decideShare(ask({ wanted: false }), gate);
    expect(decision.shared).toBe(false);
    expect(decision.denied).toBe(false);
  });

  test("no configured roles leaves sharing as it was", () => {
    expect(decideShare(ask(), { ...gate, roleIds: [] }).shared).toBe(true);
  });

  test("the refusal is one line and names where to go", () => {
    const notice = shareNotice(gate);
    expect(notice).not.toContain("\n");
    expect(notice.length).toBeLessThanOrEqual(100);
    expect(notice).toContain("#bot");
  });
});
