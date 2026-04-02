import gitmojiConfig from "commitlint-config-gitmoji";

export default {
  ...gitmojiConfig,
  parserPreset: {
    ...gitmojiConfig.parserPreset,
    parserOpts: {
      // Matches both `:emoji: type(scope): subject` and `type(scope): subject`
      headerPattern:
        /^(?:(?::[\w-]+:|[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)\s)?(\w+)(?:\(([^)]*)\))?!?:\s(.+)$/u,
      headerCorrespondence: ["type", "scope", "subject"],
    },
  },
  rules: {
    ...gitmojiConfig.rules,
    "start-with-gitmoji": [0, "always"],
  },
};
