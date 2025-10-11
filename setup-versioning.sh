#!/bin/bash

echo "🚀 Setting up semantic versioning for Brackeys monorepo..."

# Initialize git hooks
echo "📌 Initializing git hooks..."
bunx husky

# Run initial install to ensure everything is set up
echo "📦 Installing dependencies..."
bun install

echo "✅ Setup complete!"
echo ""
echo "📝 Quick Guide:"
echo "  • Make commits:     bun run commit (or git commit with conventional format)"
echo "  • Create release:   bun run release:patch/minor/major"
echo "  • Dry run:          bun run release:dry-run"
echo "  • Format code:      bun run format"
echo "  • Lint code:        bun run lint:fix"
echo ""
echo "🔍 Available scopes:"
echo "  • web        - Main web application"
echo "  • hasura     - GraphQL configuration"
echo "  • spacetime  - SpacetimeDB module"
echo "  • deps       - Dependencies"
echo "  • config     - Configuration"
echo "  • ci         - CI/CD"
echo "  • docs       - Documentation"
echo ""
echo "📖 See docs/SEMANTIC_VERSIONING.md for full documentation"
