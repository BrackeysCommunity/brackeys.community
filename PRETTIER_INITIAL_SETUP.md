# Initial Prettier Setup

Since Prettier is being added to an existing codebase, there are many files that need initial formatting. This is normal and expected.

## One-time Setup

Run this command to format all files in the project:

```bash
bun run format
```

This will:

- Format all TypeScript/JavaScript files
- Format JSON, YAML, and Markdown files
- Ensure consistent code style across the entire codebase

## What to Expect

- **171 files will be changed** - This is normal for initial setup
- Changes will mostly be:
  - Quote style (double → single for JS/TS)
  - Trailing commas
  - Indentation consistency
  - Line endings (CRLF → LF)
  - Semicolon additions

## Reviewing Changes

After running the format command:

1. Review the changes with `git diff`
2. Most changes should be formatting only
3. Commit with a message like:
   ```
   chore: apply prettier formatting to entire codebase
   ```

## Going Forward

After this initial formatting:

- Pre-commit hooks will maintain formatting automatically
- Use `bun run commit` for conventional commits
- Format-on-save will work in VS Code (with proper setup)

## VS Code Setup

For the best experience, ensure you have:

1. Prettier extension installed
2. ESLint extension installed
3. The workspace settings applied (`.vscode/settings.json`)

## Questions?

If you see unexpected changes or have concerns:

1. Check `.prettierrc.json` for current rules
2. See `docs/PRETTIER_ESLINT_INTEGRATION.md` for details
3. Formatting rules can be adjusted if needed
