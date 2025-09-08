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
echo "  • Monorepo release: bun run version:all"
echo ""
echo "📖 See VERSIONING.md for full documentation"
