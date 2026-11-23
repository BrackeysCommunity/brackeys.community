import { describe, expect, test } from "vite-plus/test";

import {
  CAP_TTL_SECONDS,
  FAIL_TTL_SECONDS,
  Narrator,
  USE_CONFIG,
  cacheKey,
  capKey,
  costKey,
  costMicros,
  failKey,
  fixedSwitch,
  memoryStore,
  stubModel,
  upperMicros,
  type NarrationModel,
  type NarrationStore,
  type NarratorDeps,
  type StubMode,
  type UseConfig,
  type UseId,
} from "../src/index.ts";
import { toyInput, toyUse } from "./toy.ts";

const DAY = 4;
const TAGS = ["", "again", "still", "today", "later", "anew", "now", "once more"];

function setup(over: Partial<NarratorDeps> & { mode?: StubMode; delayMs?: number } = {}) {
  const store = memoryStore();
  const model = stubModel({ mode: over.mode, delayMs: over.delayMs });
  const lines: string[] = [];
  const narrator = new Narrator({
    model,
    store,
    switch: fixedSwitch(true),
    dayUsd: 1,
    log: (l) => lines.push(l),
    ...over,
  });
  return { store, model, narrator, lines };
}

const promptChars = (use: UseId, tag = "") => {
  const p = toyUse(use).prompt(toyInput(tag));
  return p.system.length + p.user.length;
};

describe("Narrator.narrate", () => {
  test("a good reply is checked, cached and counted", async () => {
    const { narrator, model, store } = setup();
    const spec = toyUse();
    const first = await narrator.narrate(spec, toyInput(), { day: DAY, server: "g1" });
    expect(first).toEqual({
      ok: true,
      from: "model",
      value: [
        { text: "The wall at Rustmarket held against the raiders.", facts: [1] },
        { text: "The Salt Eaters kept the road open.", facts: [2] },
      ],
    });
    const again = await narrator.narrate(spec, toyInput(), { day: DAY, server: "g2" });
    expect(again).toMatchObject({ ok: true, from: "cache" });
    expect(model.calls).toHaveLength(1);
    expect(await store.get(cacheKey(spec, toyInput()))).not.toBeNull();

    const call = model.calls[0];
    expect(call).toMatchObject({
      use: "chronicle",
      model: "claude-haiku-5-5",
      effort: "low",
      maxTokens: USE_CONFIG.chronicle.maxTokens,
    });
    const text = JSON.stringify(spec.stub(toyInput()));
    const usage = {
      input: Math.ceil((call.system + call.user).length / 4),
      output: Math.ceil(text.length / 4) + USE_CONFIG.chronicle.stubThinking,
      cacheRead: 0,
      cacheWrite: 0,
    };
    const micros = costMicros("claude-haiku-5-5", usage);
    expect(await narrator.ledger(DAY)).toEqual({
      day: DAY,
      usdMicros: micros,
      uses: {
        chronicle: {
          calls: 1,
          hits: 1,
          input: usage.input,
          output: usage.output,
          cacheRead: 0,
          cacheWrite: 0,
          usdMicros: micros,
          fallbacks: {},
        },
      },
    });
  });

  test("every fallback reason, in the narrator's order", async () => {
    const spec = toyUse("recap");
    const input = toyInput();
    const key = cacheKey(spec, input);
    const good = JSON.stringify(spec.stub(input));

    type Bad = {
      switchOff?: boolean;
      hit?: boolean;
      failed?: boolean;
      cached?: boolean;
      noModel?: boolean;
      tooLarge?: boolean;
      capSpent?: boolean;
      broke?: boolean;
    };
    async function run(bad: Bad) {
      const store = memoryStore();
      if (bad.hit) await store.set(key, good, null);
      if (bad.failed) await store.set(failKey(key), "number", FAIL_TTL_SECONDS);
      if (bad.capSpent) await store.incr(capKey("recap", "p1", DAY), CAP_TTL_SECONDS);
      const model = stubModel();
      const narrator = new Narrator({
        model: bad.noModel ? null : model,
        store,
        switch: fixedSwitch(!bad.switchOff),
        dayUsd: bad.broke ? 0 : 1,
        log: () => {},
        config: bad.tooLarge ? { recap: { maxInputChars: 10 } } : undefined,
      });
      const out = await narrator.narrate(spec, input, {
        day: DAY,
        player: "p1",
        mode: bad.cached ? "cached" : "call",
      });
      return { out, calls: model.calls.length, ledger: await narrator.ledger(DAY) };
    }

    const all: Bad = {
      switchOff: true,
      hit: true,
      failed: true,
      cached: true,
      noModel: true,
      tooLarge: true,
      capSpent: true,
      broke: true,
    };
    const steps: [keyof Bad | null, string][] = [
      [null, "off"],
      ["switchOff", "cache"],
      ["hit", "failed-before"],
      ["failed", "off"],
      ["cached", "no-model"],
      ["noModel", "too-large"],
      ["tooLarge", "cap"],
      ["capSpent", "budget"],
      ["broke", "model"],
    ];
    const bad = { ...all };
    for (const [fix, want] of steps) {
      if (fix) delete bad[fix];
      const { out, calls, ledger } = await run(bad);
      if (want === "cache" || want === "model") {
        expect(out).toMatchObject({ ok: true, from: want });
        expect(calls).toBe(want === "model" ? 1 : 0);
      } else {
        expect(out).toMatchObject({ ok: false, reason: want });
        expect(calls).toBe(0);
        expect(ledger.uses.recap?.fallbacks).toEqual({ [want]: 1 });
      }
    }
    const failedBefore = await run({ failed: true });
    expect(failedBefore.out).toEqual({ ok: false, reason: "failed-before", check: "number" });
  });

  test("the model's own failures: timeout, error, refused, truncated, check", async () => {
    const cases: [StubMode, string, string?][] = [
      ["error", "error"],
      ["refusal", "refused"],
      ["truncated", "truncated"],
      ["number", "check", "number"],
      ["name", "check", "name"],
      ["uncited", "check", "uncited"],
      ["mention", "check", "mention"],
    ];
    for (const [mode, reason, check] of cases) {
      const { narrator, model } = setup({ mode });
      const out = await narrator.narrate(toyUse(), toyInput(), { day: DAY });
      expect(out).toEqual(check ? { ok: false, reason, check } : { ok: false, reason });
      expect(model.calls).toHaveLength(1);
      const ledger = await narrator.ledger(DAY);
      expect(ledger.uses.chronicle?.fallbacks).toEqual({ [reason]: 1 });
      expect(ledger.uses.chronicle?.calls).toBe(mode === "error" ? 0 : 1);
    }

    const slow = setup({ mode: "slow", delayMs: 200, config: { chronicle: { timeoutMs: 1 } } });
    const out = await slow.narrator.narrate(toyUse(), toyInput(), { day: DAY });
    expect(out).toEqual({ ok: false, reason: "timeout" });
    expect((await slow.narrator.ledger(DAY)).uses.chronicle?.fallbacks).toEqual({ timeout: 1 });
  });

  test("a model that ignores the abort still times out", async () => {
    const hang: NarrationModel = { complete: () => new Promise(() => {}) };
    const { narrator } = setup({ model: hang, config: { chronicle: { timeoutMs: 5 } } });
    expect(await narrator.narrate(toyUse(), toyInput(), { day: DAY })).toEqual({
      ok: false,
      reason: "timeout",
    });
  });

  test("a failed check is cached, so the same input is not paid for again", async () => {
    let now = 1_000_000;
    const store = memoryStore({ now: () => now });
    const model = stubModel({ mode: "number" });
    const narrator = new Narrator({
      model,
      store,
      switch: fixedSwitch(true),
      dayUsd: 1,
      log: () => {},
    });
    const spec = toyUse();
    expect(await narrator.narrate(spec, toyInput(), { day: DAY })).toMatchObject({
      reason: "check",
      check: "number",
    });
    expect(await narrator.narrate(spec, toyInput(), { day: DAY })).toEqual({
      ok: false,
      reason: "failed-before",
      check: "number",
    });
    expect(model.calls).toHaveLength(1);
    expect(await narrator.narrate(spec, toyInput("again"), { day: DAY })).toMatchObject({
      reason: "check",
    });
    expect(model.calls).toHaveLength(2);
    now += FAIL_TTL_SECONDS * 1_000;
    await narrator.narrate(spec, toyInput(), { day: DAY });
    expect(model.calls).toHaveLength(3);
  });

  test("refusals and truncations are remembered too; errors and timeouts are not", async () => {
    for (const [mode, again] of [
      ["refusal", 1],
      ["truncated", 1],
      ["error", 2],
    ] as const) {
      const { narrator, model } = setup({ mode });
      await narrator.narrate(toyUse(), toyInput(), { day: DAY });
      const second = await narrator.narrate(toyUse(), toyInput(), { day: DAY });
      expect(model.calls).toHaveLength(again);
      if (again === 1) expect(second).toEqual({ ok: false, reason: "failed-before" });
    }
  });

  test("two presses at once make one call", async () => {
    const { narrator, model } = setup({ mode: "slow", delayMs: 20 });
    const spec = toyUse();
    const [a, b] = await Promise.all([
      narrator.narrate(spec, toyInput(), { day: DAY }),
      narrator.narrate(spec, toyInput(), { day: DAY }),
    ]);
    expect(model.calls).toHaveLength(1);
    expect([a, b].map((x) => (x.ok ? x.from : x.reason)).sort()).toEqual(["cache", "model"]);
    expect(a.ok && b.ok && a.value).toEqual(b.ok && b.value);
    const led = (await narrator.ledger(DAY)).uses.chronicle;
    expect(led).toMatchObject({ calls: 1, hits: 1 });
  });

  test("a press that loses the waitMs race shows the template, and the next view is a hit", async () => {
    const { narrator, model } = setup({
      mode: "slow",
      delayMs: 40,
      config: { recap: { waitMs: 5 } },
    });
    const spec = toyUse("recap");
    const ctx = { day: DAY, player: "p1" };
    expect(await narrator.narrate(spec, toyInput(), ctx)).toEqual({ ok: false, reason: "timeout" });
    await narrator.drain();
    expect(await narrator.narrate(spec, toyInput(), ctx)).toMatchObject({
      ok: true,
      from: "cache",
    });
    expect(model.calls).toHaveLength(1);
    expect((await narrator.ledger(DAY)).uses.recap).toMatchObject({
      calls: 1,
      hits: 1,
      fallbacks: { timeout: 1 },
    });
  });

  test("the budget, and the interactive share of it", async () => {
    const chron = upperMicros(
      "claude-haiku-5-5",
      promptChars("chronicle"),
      USE_CONFIG.chronicle.maxTokens,
    );
    const dayUsd = chron / 0.8 / 1_000_000;

    const a = setup({ dayUsd });
    expect(await a.narrator.narrate(toyUse(), toyInput(), { day: DAY })).toMatchObject({
      ok: true,
    });
    const b = setup({ dayUsd, config: { chronicle: { interactive: true } } });
    expect(await b.narrator.narrate(toyUse(), toyInput(), { day: DAY })).toEqual({
      ok: false,
      reason: "budget",
    });
    expect(b.model.calls).toHaveLength(0);
    const c = setup({
      dayUsd: chron / 0.69 / 1_000_000,
      config: { chronicle: { interactive: true } },
    });
    expect(await c.narrator.narrate(toyUse(), toyInput(), { day: DAY })).toMatchObject({
      ok: true,
    });

    const again = upperMicros(
      "claude-haiku-5-5",
      promptChars("chronicle", "again"),
      USE_CONFIG.chronicle.maxTokens,
    );
    const exact = setup({ dayUsd: again / 1_000_000 });
    expect(await exact.narrator.narrate(toyUse(), toyInput(), { day: DAY })).toMatchObject({
      ok: true,
    });
    const spent = (await exact.narrator.ledger(DAY)).usdMicros;
    expect(spent).toBeGreaterThan(0);
    expect(await exact.narrator.narrate(toyUse(), toyInput("again"), { day: DAY })).toEqual({
      ok: false,
      reason: "budget",
    });
    expect(
      await exact.narrator.narrate(toyUse(), toyInput("again"), { day: DAY + 1 }),
    ).toMatchObject({
      ok: true,
    });

    const zero = setup({ dayUsd: 0 });
    expect(await zero.narrator.narrate(toyUse(), toyInput(), { day: DAY })).toEqual({
      ok: false,
      reason: "budget",
    });
  });

  test("calls running at once share the budget", async () => {
    const chron = upperMicros(
      "claude-haiku-5-5",
      promptChars("chronicle"),
      USE_CONFIG.chronicle.maxTokens,
    );
    const { narrator, model } = setup({
      mode: "slow",
      delayMs: 20,
      dayUsd: (chron * 1.5) / 1_000_000,
    });
    const out = await Promise.all([
      narrator.narrate(toyUse(), toyInput(), { day: DAY }),
      narrator.narrate(toyUse(), toyInput("again"), { day: DAY }),
    ]);
    expect(model.calls).toHaveLength(1);
    expect(out[1]).toEqual({ ok: false, reason: "budget" });
  });

  test("per-player and per-NPC caps count model calls, not hits", async () => {
    const { narrator, model } = setup();
    const voice = toyUse("voice");
    const ctx = { day: DAY, player: "p1" };
    for (const tag of TAGS.slice(0, 5)) {
      expect(await narrator.narrate(voice, toyInput(tag), ctx)).toMatchObject({ ok: true });
    }
    expect(await narrator.narrate(voice, toyInput(TAGS[5]), ctx)).toEqual({
      ok: false,
      reason: "cap",
    });
    expect(await narrator.narrate(voice, toyInput(TAGS[0]), ctx)).toMatchObject({ from: "cache" });
    expect(
      await narrator.narrate(voice, toyInput(TAGS[5]), { day: DAY, player: "p2" }),
    ).toMatchObject({
      from: "model",
    });
    expect(
      await narrator.narrate(voice, toyInput(TAGS[6]), { day: DAY + 1, player: "p1" }),
    ).toMatchObject({
      from: "model",
    });
    expect(model.calls).toHaveLength(7);

    const recap = toyUse("recap");
    expect(await narrator.narrate(recap, toyInput(), ctx)).toMatchObject({ ok: true });
    expect(await narrator.narrate(recap, toyInput("again"), ctx)).toEqual({
      ok: false,
      reason: "cap",
    });
    expect(await narrator.narrate(recap, toyInput(), { day: DAY })).toMatchObject({
      from: "cache",
    });
    expect(await narrator.narrate(recap, toyInput("still"), { day: DAY })).toEqual({
      ok: false,
      reason: "cap",
    });

    const summary = toyUse("summary");
    expect(await narrator.narrate(summary, toyInput(), { day: DAY, npc: "n1" })).toMatchObject({
      ok: true,
    });
    expect(await narrator.narrate(summary, toyInput("again"), { day: DAY, npc: "n1" })).toEqual({
      ok: false,
      reason: "cap",
    });
    expect(await narrator.narrate(summary, toyInput("again"), { day: DAY, player: "p1" })).toEqual({
      ok: false,
      reason: "cap",
    });
  });

  test("cached mode reads the cache and never calls", async () => {
    const { narrator, model } = setup();
    const spec = toyUse();
    expect(await narrator.narrate(spec, toyInput(), { day: DAY, mode: "cached" })).toEqual({
      ok: false,
      reason: "off",
    });
    expect(model.calls).toHaveLength(0);
    await narrator.narrate(spec, toyInput(), { day: DAY });
    expect(await narrator.narrate(spec, toyInput(), { day: DAY, mode: "cached" })).toMatchObject({
      ok: true,
      from: "cache",
    });
    expect(model.calls).toHaveLength(1);
  });

  test("the switch is asked per use and server, and a throwing switch is off", async () => {
    const asked: [UseId, string | undefined][] = [];
    const { narrator, model } = setup({
      switch: {
        on: async (use, server) => {
          asked.push([use, server]);
          return server === "on";
        },
      },
    });
    expect(await narrator.narrate(toyUse(), toyInput(), { day: DAY, server: "off" })).toMatchObject(
      {
        reason: "off",
      },
    );
    expect(await narrator.narrate(toyUse(), toyInput(), { day: DAY, server: "on" })).toMatchObject({
      ok: true,
    });
    expect(asked).toEqual([
      ["chronicle", "off"],
      ["chronicle", "on"],
    ]);
    const broken = setup({
      switch: {
        on: async () => {
          throw new Error("redis down");
        },
      },
    });
    expect(await broken.narrator.narrate(toyUse(), toyInput(), { day: DAY })).toMatchObject({
      reason: "off",
    });
    expect(model.calls).toHaveLength(1);
  });

  test("a store that fails gives the store fallback, before or after the call", async () => {
    const failing = (method: keyof NarrationStore): NarrationStore => {
      const inner = memoryStore();
      return new Proxy(inner, {
        get(target, prop, receiver) {
          if (prop === method) return async () => Promise.reject(new Error("store down"));
          return Reflect.get(target, prop, receiver);
        },
      });
    };
    for (const method of ["get", "hgetall", "hincr", "set"] as const) {
      const { narrator } = setup({ store: failing(method) });
      expect(await narrator.narrate(toyUse(), toyInput(), { day: DAY })).toEqual({
        ok: false,
        reason: "store",
      });
    }
  });

  test("log lines carry no text, no player and no key", async () => {
    const { narrator, lines, store } = setup({ mode: "number" });
    await narrator.narrate(toyUse("recap"), toyInput(), { day: DAY, player: "secret-user" });
    await narrator.narrate(toyUse("recap"), toyInput(), { day: DAY, player: "secret-user" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^mmo-narr use=recap day=4 model=claude-haiku-5-5 outcome=check\/number in=\d+ out=\d+ cr=0 cw=0 usdMicros=\d+$/,
    );
    expect(lines[1]).toBe("mmo-narr use=recap day=4 fallback=failed-before check=number");
    for (const l of lines) {
      expect(l).not.toContain("secret-user");
      expect(l).not.toContain("Rustmarket");
      expect(l).not.toContain("mmo-narr:");
    }
    expect(store.keys()).toContain(costKey(DAY));
  });

  test("a config override reaches the call", async () => {
    const config: Partial<Record<UseId, Partial<UseConfig>>> = { chronicle: { maxTokens: 123 } };
    const { narrator, model } = setup({ config });
    await narrator.narrate(toyUse(), toyInput(), { day: DAY });
    expect(model.calls[0].maxTokens).toBe(123);
    expect(narrator.config("chronicle").model).toBe("claude-haiku-5-5");
  });
});
