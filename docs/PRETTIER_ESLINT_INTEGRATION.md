# Prettier & ESLint Integration

This document explains how Prettier and ESLint are configured to work together in this project.

## Overview

- **ESLint**: Catches code quality issues, bugs, and enforces coding standards
- **Prettier**: Handles code formatting automatically
- **eslint-config-prettier**: Disables ESLint rules that conflict with Prettier

## Configuration Files

### ESLint (`eslint.config.js`)

- Uses the new flat config format (ESLint 9+)
- TypeScript-aware with `typescript-eslint`
- React hooks and refresh plugins for React development
- Storybook plugin for component stories
- **Prettier config at the end** to disable conflicting rules

### Prettier (`.prettierrc.json`)

- Single quotes for JavaScript/TypeScript
- Semicolons required
- 2-space indentation
- 100-character line width
- ES5 trailing commas
- TypeScript parser for `.ts`/`.tsx` files

### EditorConfig (`.editorconfig`)

- Ensures consistent settings across different editors
- Complements Prettier for basic formatting rules

## Workflow

### 1. During Development

Your editor should:

- Show ESLint errors/warnings in real-time
- Format on save with Prettier (if configured)

### 2. Before Commit (Automatic)

The pre-commit hook runs via Husky and lint-staged:

1. **ESLint** first - fixes auto-fixable issues
2. **Prettier** second - formats the code
3. Only staged files are processed

### 3. Manual Commands

```bash
# Check for linting issues
bun run lint

# Fix auto-fixable linting issues
bun run lint:fix

# Format all files with Prettier
bun run format

# Check if files are formatted
bun run format:check
```

## Integration Details

### Rule Conflicts

`eslint-config-prettier` disables these ESLint rules that conflict with Prettier:

- Indentation rules
- Quote style rules
- Semicolon rules
- Line length rules
- Spacing rules

### File Processing Order

1. ESLint runs first to catch actual code issues
2. Prettier runs second to format the code
3. This ensures code quality checks aren't bypassed by formatting

### Ignored Files

Both tools respect:

- `.gitignore` patterns
- `.eslintignore` patterns (if present)
- `.prettierignore` patterns

## Common Scenarios

### "ESLint and Prettier disagree on formatting"

This shouldn't happen with our setup. If it does:

1. Ensure `eslint-config-prettier` is last in ESLint config
2. Run `bun run lint:fix` followed by `bun run format`

### "Prettier is formatting files I don't want formatted"

Add patterns to `.prettierignore`

### "I want different Prettier settings for specific files"

Use the `overrides` section in `.prettierrc.json`

## VS Code Setup

Recommended settings (`.vscode/settings.json`):

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.validate": ["javascript", "javascriptreact", "typescript", "typescriptreact"]
}
```

## Best Practices

1. **Don't disable Prettier** for code style preferences - adjust the config instead
2. **Use ESLint directives** sparingly and only for actual false positives
3. **Run format check in CI** to ensure consistent formatting
4. **Commit both configs** together when making changes

## Troubleshooting

### Pre-commit hook is slow

- Consider reducing the scope in `.lintstagedrc`
- Use `--cache` flag for ESLint (already configured)

### Format on save not working

1. Check VS Code default formatter setting
2. Ensure Prettier extension is installed
3. Check for workspace-specific settings overrides

### Conflicts after merging

Run these commands to resolve:

```bash
bun run lint:fix
bun run format
```
