# Multi-Scope Commits Guide

## Overview

When your changes affect multiple parts of the monorepo, you have several options for creating commits.

## Approaches

### 1. No Scope (Recommended for broad changes)

Omit the scope when changes affect multiple areas:

```bash
# Good for changes that truly affect everything
feat: implement authentication system
fix: update dependencies across all packages
chore: standardize error handling
```

### 2. Wildcard Scope

Use `*` for changes affecting all packages:

```bash
feat(*): add logging to all services
chore(*): update build configuration
```

### 3. Multiple Scopes (Now supported)

Use comma-separated scopes for specific multi-package changes:

```bash
feat(web,api): implement user authentication flow
fix(api,spacetime): resolve connection timeout issues
refactor(web,api,spacetime): standardize error responses
```

### 4. Separate Commits (Best for clarity)

Create individual commits for each scope:

```bash
# Stage and commit web changes
git add src/
git commit -m "feat(web): add login UI components"

# Stage and commit API changes
git add server/
git commit -m "feat(api): add authentication endpoints"

# Stage and commit SpacetimeDB changes
git add spacetime-db/
git commit -m "feat(spacetime): add user session management"
```

## When to Use Each Approach

### Use No Scope When:

- Changes are truly cross-cutting (build tools, CI/CD)
- Updates affect the monorepo structure itself
- Dependency updates that impact everything

### Use Multi-Scope When:

- Feature implementation spans specific packages
- Bug fix requires coordinated changes
- Refactoring that touches known packages

### Use Separate Commits When:

- Changes are logically independent
- You want clearer change history
- Different types of changes per package

## Examples

### Feature Implementation

```bash
# Option 1: Multi-scope
feat(web,api): implement real-time notifications

# Option 2: Separate commits
feat(web): add notification UI components
feat(api): create WebSocket notification service
```

### Bug Fix

```bash
# Option 1: Multi-scope
fix(web,api): resolve CORS issues in production

# Option 2: No scope
fix: resolve cross-origin communication issues
```

### Dependency Update

```bash
# Affects all packages
chore(*): upgrade TypeScript to v5.0

# Affects specific packages
chore(web,api): update React to v19
```

## Commitizen Support

When using `bun run commit`, you can:

1. Select no scope (just press Enter when asked)
2. Type a single scope
3. Type multiple scopes separated by commas (e.g., `web,api`)

## Changelog Generation

Multi-scope commits will appear in the changelog under each affected package when using Lerna for versioning.

## Best Practices

1. **Be Specific**: Use multi-scope only when changes are truly interdependent
2. **Keep It Simple**: If more than 3 scopes, consider using `*` or no scope
3. **Atomic Commits**: When possible, prefer separate commits for clarity
4. **Consistent Format**: Always use commas without spaces: `web,api` not `web, api`

## Supported Multi-Scope Combinations

Currently configured in `commitlint.config.js`:

- `web,api`
- `web,spacetime`
- `api,spacetime`
- `web,api,spacetime`
- `*` (all packages)

Additional combinations can be added as needed.
