# Semantic Versioning Setup

This project uses a comprehensive semantic versioning setup with the following tools:

## 🛠️ Tools Overview

### 1. **Husky** - Git Hooks Management

- Automatically runs checks before commits and pushes
- Ensures code quality and commit message standards

### 2. **Commitlint** - Commit Message Validation

- Enforces [Conventional Commits](https://www.conventionalcommits.org/) format
- Validates commit messages against defined rules
- Configured with Lerna scopes for monorepo

### 3. **Commitizen** - Interactive Commit Helper

- Provides interactive CLI for creating properly formatted commits
- Guides through commit type, scope, and message
- Run with: `bun run commit`

### 4. **Standard-version** - Automated Versioning & Changelog

- Automatically bumps version based on commits
- Generates/updates CHANGELOG.md
- Creates git tags for releases
- Follows semantic versioning rules

### 5. **Lerna** - Monorepo Management

- Manages multiple packages in the repository
- Coordinates versioning across packages
- Handles publishing workflow

### 6. **Lint-staged** - Pre-commit Code Quality

- Runs linters on staged files before commit
- Automatically fixes issues when possible
- Ensures code quality standards

## 📋 Commit Message Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Types

- `feat`: New feature (MINOR version bump)
- `fix`: Bug fix (PATCH version bump)
- `perf`: Performance improvement (PATCH version bump)
- `docs`: Documentation only
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding/updating tests
- `build`: Build system changes
- `ci`: CI configuration changes
- `chore`: Other changes (maintenance)
- `revert`: Reverting previous commit

### Scopes

- `web`: Main web application
- `api`: API server
- `spacetime`: SpacetimeDB module
- `deps`: Dependencies
- `release`: Release-related
- `config`: Configuration
- `ci`: CI/CD
- `docs`: Documentation
- `*`: All packages
- Multiple scopes: `web,api`, `web,spacetime`, etc.

**Note**: For multi-scope changes, you can use comma-separated scopes or omit the scope entirely. See [Multi-Scope Commits Guide](./MULTI_SCOPE_COMMITS.md) for details.

### Breaking Changes

Add `BREAKING CHANGE:` in the commit body or use `!` after type/scope:

```
feat!: remove deprecated API endpoint

BREAKING CHANGE: The /api/v1/users endpoint has been removed.
Use /api/v2/users instead.
```

## 🚀 Workflow

### 1. Making Commits

#### Option A: Interactive (Recommended)

```bash
bun run commit
```

This launches Commitizen's interactive prompt.

#### Option B: Manual

```bash
git commit -m "feat(web): add user profile page"
```

Commitlint will validate the message format.

### 2. Creating Releases

#### Individual Package Release

```bash
# Preview what will change
bun run release:dry-run

# Create release (auto-detects version bump from commits)
bun run release

# Or specify version bump explicitly
bun run release:patch  # 1.0.0 → 1.0.1
bun run release:minor  # 1.0.1 → 1.1.0
bun run release:major  # 1.1.0 → 2.0.0
```

#### Pre-releases

```bash
bun run release:alpha  # 1.0.0 → 1.0.1-alpha.0
bun run release:beta   # 1.0.1-alpha.0 → 1.0.1-beta.0
```

#### Monorepo-wide Release

```bash
# Version all changed packages
bun run version:all

# Publish all packages
bun run publish:all
```

### 3. Pushing Release

```bash
git push --follow-tags origin main
```

## 📁 Configuration Files

- `.husky/` - Git hooks
  - `commit-msg` - Runs commitlint
  - `pre-commit` - Runs lint-staged
- `commitlint.config.js` - Commit message rules
- `.versionrc.json` - Standard-version config
- `lerna.json` - Monorepo configuration
- `.prettierrc.json` - Code formatting rules

## 🔄 Version Bump Rules

Standard-version automatically determines version bumps:

| Commit Type             | Version Bump | Example           |
| ----------------------- | ------------ | ----------------- |
| `fix:`                  | Patch        | 1.0.0 → 1.0.1     |
| `feat:`                 | Minor        | 1.0.1 → 1.1.0     |
| `BREAKING CHANGE:`      | Major        | 1.1.0 → 2.0.0     |
| `chore:`, `docs:`, etc. | None         | No version change |

## 📝 Changelog Generation

Changelogs are automatically generated from commits:

- Features (`feat:`) → "Features" section
- Bug fixes (`fix:`) → "Bug Fixes" section
- Breaking changes → "BREAKING CHANGES" section
- Other types can be configured in `.versionrc.json`

## 🤖 CI/CD Integration

The setup includes a GitHub Actions workflow (`.github/workflows/release.yml`) that:

1. Triggers on push to main or manual dispatch
2. Runs tests and checks
3. Creates release if there are releasable commits
4. Publishes GitHub release with changelog

## 💡 Best Practices

1. **Write meaningful commits** - They become your changelog
2. **Use scopes** - Helps organize changes by area
3. **Include breaking changes** - Critical for major version bumps
4. **Review before releasing** - Use `--dry-run` to preview
5. **Keep commits atomic** - One logical change per commit
6. **Reference issues** - Add issue numbers in commit body

## 🛠️ Troubleshooting

### Commit Rejected

```
⧗   input: chore: update deps
✖   subject may not be empty [subject-empty]
```

**Solution**: Ensure your commit message follows the format exactly.

### Version Not Bumping

**Check**: Are you using the correct commit types? Only `feat`, `fix`, `perf` trigger bumps.

### Changelog Not Updating

**Check**: Is your commit type configured to show in `.versionrc.json`?

### Pre-commit Hook Failing

**Solution**: Fix linting errors or run `git commit --no-verify` to skip (not recommended).

## 📚 Additional Resources

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/)
- [Standard-version Documentation](https://github.com/conventional-changelog/standard-version)
- [Lerna Documentation](https://lerna.js.org/)
- [Commitizen Documentation](https://github.com/commitizen/cz-cli)
