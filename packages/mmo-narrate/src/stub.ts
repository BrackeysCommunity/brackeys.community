import type { ModelCall, ModelReply, NarrationModel } from "./types.ts";
import { USE_CONFIG } from "./uses.ts";

export type StubMode =
  | "good"
  | "number"
  | "name"
  | "uncited"
  | "mention"
  | "refusal"
  | "truncated"
  | "error"
  | "slow";

/** structural: the stub's tokens a character, the usual rule of thumb for English. */
const CHARS_PER_TOKEN = 4;
/** structural: how long `slow` waits when no delay is given. */
const SLOW_MS = 50;
/** Field names a corruption prefers, so it lands in prose rather than in an id. */
const TEXT_FIELDS = ["text", "description", "line"];

const clone = (v: unknown): unknown =>
  v === undefined ? undefined : JSON.parse(JSON.stringify(v));

/** Appends before the closing punctuation, so the sentence still reads as one. */
const append = (s: string, add: string) => {
  const m = s.match(/[.!?]+$/);
  return m ? `${s.slice(0, m.index)}${add}${m[0]}` : `${s}${add}`;
};

type Holder = { get(): string; set(s: string): void };

/** The first prose string in a reply: a `text`, `description` or `line` field before any other string. */
function firstText(v: unknown): Holder | null {
  let fallback: Holder | null = null;
  const walk = (node: unknown): Holder | null => {
    if (Array.isArray(node)) {
      for (const [i, x] of node.entries()) {
        if (typeof x === "string") {
          fallback ??= { get: () => node[i] as string, set: (s) => (node[i] = s) };
          continue;
        }
        const found = walk(x);
        if (found) return found;
      }
      return null;
    }
    if (typeof node !== "object" || node === null) return null;
    const o = node as Record<string, unknown>;
    for (const f of TEXT_FIELDS) {
      if (typeof o[f] === "string") return { get: () => o[f] as string, set: (s) => (o[f] = s) };
    }
    for (const [k, x] of Object.entries(o)) {
      if (typeof x === "string") {
        fallback ??= { get: () => o[k] as string, set: (s) => (o[k] = s) };
        continue;
      }
      const found = walk(x);
      if (found) return found;
    }
    return null;
  };
  return walk(v) ?? fallback;
}

function firstFacts(v: unknown): { facts: unknown[] } | null {
  if (Array.isArray(v)) {
    for (const x of v) {
      const found = firstFacts(x);
      if (found) return found;
    }
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.facts)) return o as { facts: unknown[] };
  for (const x of Object.values(o)) {
    const found = firstFacts(x);
    if (found) return found;
  }
  return null;
}

function corrupt(stub: unknown, add: string): unknown {
  if (typeof stub === "string") return append(stub, add);
  const v = clone(stub);
  const t = firstText(v);
  if (t) t.set(append(t.get(), add));
  return v;
}

function replyText(mode: StubMode, stub: unknown): string {
  switch (mode) {
    case "number":
      return JSON.stringify(corrupt(stub, " for 3 days"));
    case "name":
      return JSON.stringify(corrupt(stub, " beside Zarnok"));
    case "mention":
      return JSON.stringify(corrupt(stub, " @everyone"));
    case "uncited": {
      const v = clone(stub);
      const s = firstFacts(v);
      if (s) s.facts = [];
      return JSON.stringify(v);
    }
    case "refusal":
      return "";
    case "truncated": {
      const full = JSON.stringify(stub);
      return full.slice(0, Math.floor(full.length / 2));
    }
    default:
      return JSON.stringify(stub);
  }
}

const abortError = () =>
  Object.assign(new Error("The stub call was aborted"), { name: "AbortError" });

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A model that never touches the network: it answers with the use's own stub
 * reply, or a corruption of it the checks must catch. Usage is deterministic,
 * so a ledger built from it can be checked to the micro-dollar.
 */
export function stubModel(opts?: {
  mode?: StubMode;
  delayMs?: number;
}): NarrationModel & { calls: ModelCall[] } {
  const mode = opts?.mode ?? "good";
  const calls: ModelCall[] = [];
  return {
    calls,
    async complete(call: ModelCall, signal: AbortSignal): Promise<ModelReply> {
      calls.push(call);
      if (signal.aborted) throw abortError();
      if (mode === "slow") await wait(opts?.delayMs ?? SLOW_MS, signal);
      if (mode === "error") throw new Error("The stub model failed");
      const text = replyText(mode, call.stub);
      const stop: ModelReply["stop"] =
        mode === "refusal" ? "refusal" : mode === "truncated" ? "max_tokens" : "end";
      return {
        text,
        stop,
        usage: {
          input: Math.ceil((call.system + call.user).length / CHARS_PER_TOKEN),
          output: Math.ceil(text.length / CHARS_PER_TOKEN) + USE_CONFIG[call.use].stubThinking,
          cacheRead: 0,
          cacheWrite: 0,
        },
      };
    },
  };
}
