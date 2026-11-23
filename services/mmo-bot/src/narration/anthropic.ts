import Anthropic from "@anthropic-ai/sdk";

import {
  type ModelCall,
  type ModelReply,
  ModelTimeoutError,
  type NarrationModel,
} from "../../../../packages/mmo-narrate/src/index.ts";

/** The part of the SDK client the model uses, so a test can hand in a fake. */
export interface MessagesClient {
  messages: {
    stream(
      body: Anthropic.MessageStreamParams,
      options?: { timeout?: number; signal?: AbortSignal },
    ): { finalMessage(): Promise<Anthropic.Message> };
  };
}

/**
 * The narration model over the Anthropic API: one streamed request a call,
 * the system prompt cached, the reply held to the use's JSON schema. The
 * key is handed to the SDK and nowhere else.
 */
export function anthropicModel(apiKey: string): NarrationModel {
  return messagesModel(new Anthropic({ apiKey, maxRetries: 1 }));
}

export function messagesModel(client: MessagesClient): NarrationModel {
  return {
    async complete(call, signal) {
      let msg: Anthropic.Message;
      try {
        msg = await client.messages
          .stream(request(call), { timeout: call.timeoutMs, signal })
          .finalMessage();
      } catch (e) {
        if (e instanceof Anthropic.APIConnectionTimeoutError)
          throw new ModelTimeoutError(`${call.use}: no reply within ${call.timeoutMs} ms`);
        if (e instanceof Anthropic.APIUserAbortError && signal.aborted)
          throw new ModelTimeoutError(`${call.use}: aborted`);
        throw e;
      }
      return reply(msg);
    },
  };
}

/** The request a call makes. No thinking or sampling settings: effort is the only control. */
export function request(call: ModelCall): Anthropic.MessageStreamParams {
  return {
    model: call.model,
    max_tokens: call.maxTokens,
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: call.user }],
    output_config: {
      effort: call.effort,
      format: { type: "json_schema", schema: call.schema },
    },
  };
}

const STOPS: Partial<Record<string, ModelReply["stop"]>> = {
  end_turn: "end",
  refusal: "refusal",
  max_tokens: "max_tokens",
};

/** The reply as the narrator reads it; the stop reason is read before the content. */
export function reply(msg: Anthropic.Message): ModelReply {
  const stop = STOPS[msg.stop_reason ?? ""] ?? "other";
  const text =
    stop === "end"
      ? msg.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
      : "";
  const u = msg.usage;
  return {
    text,
    stop,
    usage: {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    },
  };
}
