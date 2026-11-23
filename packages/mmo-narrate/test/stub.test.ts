import { describe, expect, test } from "vite-plus/test";

import { ModelTimeoutError, USE_CONFIG, stubModel, type ModelCall } from "../src/index.ts";

const call = (stub: unknown, use: ModelCall["use"] = "chronicle"): ModelCall => ({
  use,
  model: USE_CONFIG[use].model,
  effort: USE_CONFIG[use].effort,
  maxTokens: USE_CONFIG[use].maxTokens,
  timeoutMs: USE_CONFIG[use].timeoutMs,
  stream: false,
  system: "s".repeat(10),
  user: "u".repeat(7),
  schema: {},
  stub,
});

const sentences = {
  sentences: [
    { text: "The wall held.", facts: [1] },
    { text: "The road stayed open.", facts: [2] },
  ],
};
const signal = () => new AbortController().signal;
const reply = async (
  mode: Parameters<typeof stubModel>[0],
  stub: unknown,
  use?: ModelCall["use"],
) => stubModel(mode).complete(call(stub, use), signal());

describe("stubModel", () => {
  test("good returns the use's stub with deterministic usage", async () => {
    const m = stubModel();
    const r = await m.complete(call(sentences), signal());
    expect(JSON.parse(r.text)).toEqual(sentences);
    expect(r.stop).toBe("end");
    expect(r.usage).toEqual({
      input: Math.ceil(17 / 4),
      output: Math.ceil(r.text.length / 4) + USE_CONFIG.chronicle.stubThinking,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(m.calls).toHaveLength(1);
  });

  test("the corrupting modes break the first prose text", async () => {
    const text = async (mode: "number" | "name" | "mention", stub: unknown) =>
      JSON.parse((await reply({ mode }, stub)).text);
    expect((await text("number", sentences)).sentences[0].text).toBe("The wall held for 3 days.");
    expect((await text("name", sentences)).sentences[0].text).toBe("The wall held beside Zarnok.");
    expect((await text("mention", sentences)).sentences[0].text).toBe("The wall held @everyone.");
    expect((await text("number", sentences)).sentences[1].text).toBe("The road stayed open.");
    const names = { names: ["Ash", "Dust", "Rust"], description: "A blade of scrap." };
    expect(await text("number", names)).toEqual({
      ...names,
      description: "A blade of scrap for 3 days.",
    });
    expect(await text("number", ["One line.", "Two"])).toEqual(["One line for 3 days.", "Two"]);
    expect(await text("number", "Plain")).toBe("Plain for 3 days");
    const voice = {
      topics: [{ id: "t1", line: "Trade is slow.", choices: [{ id: "c", line: "Buy." }] }],
    };
    expect((await text("number", voice)).topics[0].line).toBe("Trade is slow for 3 days.");
  });

  test("uncited drops the first sentence's facts; the stub itself is untouched", async () => {
    const r = JSON.parse((await reply({ mode: "uncited" }, sentences)).text);
    expect(r.sentences[0].facts).toEqual([]);
    expect(r.sentences[1].facts).toEqual([2]);
    expect(sentences.sentences[0].facts).toEqual([1]);
  });

  test("refusal, truncated and error", async () => {
    const refused = await reply({ mode: "refusal" }, sentences);
    expect(refused).toMatchObject({ stop: "refusal", text: "" });
    expect(refused.usage.output).toBe(USE_CONFIG.chronicle.stubThinking);
    const cut = await reply({ mode: "truncated" }, sentences);
    expect(cut.stop).toBe("max_tokens");
    expect(() => JSON.parse(cut.text)).toThrow();
    await expect(reply({ mode: "error" }, sentences)).rejects.toThrow();
  });

  test("slow waits, and stops when aborted", async () => {
    const t0 = Date.now();
    await stubModel({ mode: "slow", delayMs: 30 }).complete(call(sentences), signal());
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
    const ctrl = new AbortController();
    const p = stubModel({ mode: "slow", delayMs: 10_000 }).complete(call(sentences), ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(new ModelTimeoutError()).toBeInstanceOf(Error);
  });
});
