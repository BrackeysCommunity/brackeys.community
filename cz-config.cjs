const adapter = require("cz-emoji-conventional");

module.exports = {
  prompter(cz, commit) {
    // Wrap inquirer's prompt to filter out unwanted questions
    const originalPrompt = cz.prompt.bind(cz);
    cz.prompt = (questions) => {
      const skip = new Set([
        "isBreaking",
        "breakingBody",
        "breaking",
        "isIssueAffected",
        "issuesBody",
        "issues",
      ]);
      const filtered = questions.filter((q) => !skip.has(q.name));
      return originalPrompt(filtered);
    };
    adapter.prompter(cz, commit);
  },
};
