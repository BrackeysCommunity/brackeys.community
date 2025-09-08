# Hasura Configuration Versioning

## Overview

The `hasura/` folder contains GraphQL configuration for Hasura Engine rather than a traditional Node.js package. Therefore, versioning works differently:

## Version Management

### 1. No Package.json

Hasura configuration doesn't have a `package.json` file since it's not a Node.js package. Version tracking happens through:

- Git commits with the `hasura` scope
- Changes documented in the main CHANGELOG.md
- Configuration version tracked in `hasura.yaml`

### 2. Commit Scopes

Use the `hasura` scope for changes to:

- GraphQL metadata (`hasura/app/metadata/`)
- Connector configurations (`hasura/app/connector/`)
- Engine configuration (`hasura/engine/`)
- Global settings (`hasura/globals/`)

### 3. Example Commits

```bash
feat(hasura): add new collaboration queries
fix(hasura): correct relationship mapping
chore(hasura): update connector configuration
refactor(hasura): reorganize metadata structure
```

### 4. Multi-scope Changes

When Hasura changes are coupled with frontend changes:

```bash
feat(web,hasura): implement user profile feature
fix(web,hasura): resolve GraphQL subscription issues
```

## Best Practices

1. **Atomic Changes**: Keep Hasura configuration changes separate from code changes when possible
2. **Descriptive Messages**: Clearly describe what metadata or configuration was changed
3. **Breaking Changes**: Mark breaking GraphQL schema changes with `!` or `BREAKING CHANGE:`
   ```bash
   feat(hasura)!: rename user_profile to profile table
   ```

## File Types

### Metadata Files (`.hml`)

- Table definitions
- Relationships
- Permissions
- GraphQL schema customizations

### Configuration Files

- `hasura.yaml` - Main Hasura project configuration
- `supergraph.yaml` - Supergraph composition
- `connector.yaml` - Data connector settings
- `compose.yaml` - Docker compose configurations

## Deployment Considerations

Since Hasura configuration is deployed differently than Node.js packages:

1. Changes don't trigger npm/package version bumps
2. Deploy through Hasura CLI or CI/CD pipelines
3. Version tracking is for documentation and changelog purposes

## Related Documentation

- See [Semantic Versioning Guide](./SEMANTIC_VERSIONING.md) for commit format
- See [Multi-Scope Commits Guide](./MULTI_SCOPE_COMMITS.md) for cross-cutting changes
