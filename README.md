# Brackeys Community Web

A modern full-stack web application for the Brackeys Discord community, built with TanStack Start, React 19, and a self-hosted backend stack.

## 🏗️ Stack

- **Frontend**: React 19 + TypeScript + TanStack Start + Tailwind CSS v4
- **Routing**: TanStack Router (file-based with SSR support)
- **State**: TanStack Query + TanStack Store
- **Authentication**: Clerk (Discord OAuth only)
- **API**: Hasura GraphQL Engine v3 (DDN)
- **Database**: PostgreSQL
- **Cache**: Redis
- **Storage**: MinIO (S3-compatible)
- **Real-time**: SpacetimeDB (Rust/WASM)

## 🚀 Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Build SpacetimeDB module (first time only)
cd spacetime-db
cargo build --release --target wasm32-unknown-unknown
cd ..

# 3. Configure environment
cp .env.example .env
# Edit .env with your Clerk keys

# 4. Start backend services (requires Docker)
docker-compose up -d

# 5. Start development server
bun run dev
```

Visit http://localhost:3000 to see your app!

## 📁 Project Structure

```
brackeys/
├── hasura/                  # Hasura GraphQL metadata & migrations
├── spacetime-db/            # SpacetimeDB Rust module (WASM)
├── src/
│   ├── routes/              # File-based routes (TanStack Router)
│   │   ├── index.tsx        # Home page
│   │   ├── login.tsx        # Login page
│   │   ├── profile.tsx      # User profile
│   │   ├── sandbox.tsx      # Real-time canvas
│   │   ├── resources.tsx    # Games & tools
│   │   ├── collaborations/  # Collaboration marketplace
│   │   ├── auth/            # Auth flow pages
│   │   └── api/             # API routes (webhooks, etc.)
│   ├── components/          # React components
│   │   ├── auth/            # Auth guards, login button
│   │   ├── collaborations/  # Collab cards, filters
│   │   ├── games/           # Games (Snake, etc.)
│   │   ├── home/            # Hero, features, CTA
│   │   ├── layout/          # Header, footer, main layout
│   │   ├── resources/       # Resource cards, filters
│   │   ├── sandbox/         # Canvas, cursors, messages
│   │   └── ui/              # Reusable UI (Button, Input, Modal)
│   ├── context/             # React Context providers
│   ├── hooks/               # Custom React hooks
│   ├── lib/                 # Utilities & configurations
│   ├── server/              # Server functions
│   │   ├── auth/            # Discord sync
│   │   ├── webhooks/        # Clerk webhooks
│   │   └── graphql/         # GraphQL wrappers
│   └── styles.css           # Global styles
├── docs/                    # Comprehensive documentation
├── .storybook/              # Storybook configuration
└── mise.toml                # Development tooling
```

## 🎨 Key Features

### 1. Real-Time Multiplayer Sandbox
- Collaborative canvas powered by SpacetimeDB (Rust)
- Live cursor tracking (~140fps)
- Real-time typing indicators
- Ephemeral messages with configurable TTL
- Room system with password protection

### 2. Collaboration Marketplace
- Post collaboration opportunities
- Advanced filtering (type, hiring status, tags)
- Response system (public/private)
- Bookmarks and view tracking
- Dynamic form fields based on post type

### 3. Discord-Native Authentication
- OAuth via Clerk
- Automatic role syncing (Discord → Hasura)
- Guild membership validation
- Custom profile page with Discord data

### 4. Games & Tools Directory
- Curated resources for developers
- Filter by type, category, tags
- Embedded games (Snake, etc.)

## ⚙️ SSR Configuration

TanStack Start supports flexible server-side rendering. Routes use **Full SSR by default**.

### Full SSR (Default)
Everything rendered server-side for best SEO and initial load:

```typescript
export const Route = createFileRoute('/my-route')({
  component: MyComponent,
});
```

### Data-Only SSR
Server fetches data, client renders UI (hybrid approach):

```typescript
export const Route = createFileRoute('/my-route')({
  ssr: 'data-only',
  component: MyComponent,
  loader: async () => {
    return await fetchDataServerSide();
  },
});
```

### SPA Mode
Fully client-side rendering (like traditional React):

```typescript
export const Route = createFileRoute('/my-route')({
  ssr: false,
  component: MyComponent,
});
```

## 🔐 Authentication Flow

1. User clicks "Sign in with Discord"
2. Clerk handles OAuth with Discord
3. Webhook fires on `user.created` or `session.created`
4. Server fetches Discord guild member data
5. Maps Discord roles → Hasura roles (admin, staff, moderator, brackeys, user)
6. Updates Clerk metadata with Hasura claims
7. User redirected to `/auth/entry` for guild validation
8. If in guild → redirect to app; if not → show error

See [docs/AUTH_FLOW.md](./docs/AUTH_FLOW.md) for details.

## 🛠️ Development Commands

All development tasks are managed through mise or bun scripts:

```bash
# Core Development
mise run dev              # Start all services (Hasura + Frontend)
mise run dev-frontend     # Frontend only
mise run dev-hasura       # Hasura only

# Code Quality
bun run lint              # Run linting
bun run lint:fix          # Fix linting issues
bun run format            # Format code
bun run format:check      # Check formatting
bun run check             # Run all checks

# Building & Generation
bun run build             # Production build
bun run graphql-codegen   # Generate GraphQL types
bun run storybook         # Component documentation

# Versioning & Commits
bun run commit            # Commitizen (conventional commits)
bun run release           # Create version release
mise run pre-commit       # Run all pre-commit checks

# Utilities
mise run check            # Verify tool installation
mise run doctor           # Health check
mise run clean            # Clean generated files
mise tasks                # List all available tasks
```

## 📚 Documentation

- **[MIGRATION_STATUS.md](./MIGRATION_STATUS.md)** - Current migration status from brackeys-web
- **[docs/AUTH_FLOW.md](./docs/AUTH_FLOW.md)** - Authentication architecture
- **[docs/DEVELOPMENT_SETUP.md](./docs/DEVELOPMENT_SETUP.md)** - Setup guide
- **[docs/HASURA_SETUP.md](./docs/HASURA_SETUP.md)** - Hasura configuration
- **[docs/STORYBOOK_CHROMATIC.md](./docs/STORYBOOK_CHROMATIC.md)** - Storybook deployment
- **[Storybook Live](https://brackeyscommunity.github.io/brackeys.community/)** - Component documentation

## 🌍 Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Clerk Authentication
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...

# Hasura GraphQL
VITE_HASURA_GRAPHQL_URL=http://localhost:3280/graphql
HASURA_GRAPHQL_ADMIN_SECRET=your_secret
HASURA_GRAPHQL_JWT_SECRET=your_jwt_secret

# SpacetimeDB
VITE_SPACETIME_HOST=wss://localhost:3000
VITE_SPACETIME_MODULE=brackeys-sandbox

# Discord
VITE_BRACKEYS_GUILD_ID=240491168985399296
DISCORD_GUILD_ID=240491168985399296
```

## 🧪 Testing

```bash
# Run tests
bun run test

# Type check
bunx tsc --noEmit

# Storybook (visual testing)
bun run storybook

# E2E tests (Playwright)
bunx playwright test
```

## 🔧 Troubleshooting

### "Docker is not running"
- Start Docker Desktop
- Ensure Docker is set to use WSL2 (Windows)

### "mise: command not found"
```bash
curl https://mise.run | sh
echo 'eval "$(mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
```

### "Port already in use"
```bash
# Find and kill process using port 3000
lsof -i :3000        # macOS/Linux
netstat -ano | findstr :3000  # Windows
```

### SpacetimeDB connection fails
```bash
# Rebuild the Rust module
cd spacetime-db
cargo clean
cargo build --release --target wasm32-unknown-unknown
cd ..
```

See [docs/DEVELOPMENT_SETUP.md](./docs/DEVELOPMENT_SETUP.md) for more troubleshooting.

## 📦 Backend Services

All managed via Docker Compose:

- **PostgreSQL** - Main database (port 5432)
- **Hasura** - GraphQL API (port 8080) - [Console](http://localhost:8080)
- **Redis** - Caching (port 6379)
- **MinIO** - Object storage (ports 9000/9001) - [Console](http://localhost:9001)

## 🎨 Design System

### Color Palette
- **Brackeys Yellow**: `#ffa949`
- **Brackeys Fuscia**: `#d2356b`
- **Brackeys Purple**: `#5865f2` (with variants 100-900)
- **Discord Blue**: `#5865f2`

### Custom Utilities
- **Pattern backgrounds**: `.bg-dot-pattern`, `.bg-line-pattern`
- **Pattern masks**: `.pattern-mask-radial`, `.pattern-mask-fade-in/out`
- **Custom scrollbars**: `.custom-scrollbar`

## 🚢 Deployment

### Frontend (Vercel)
```bash
bun run build
# Deploy to Vercel
```

### Backend (Hasura Cloud)
```bash
cd hasura
ddn supergraph build create
```

### Storybook (GitHub Pages)
```bash
bun run build-storybook
# Auto-deployed via GitHub Actions
```

## 🤝 Contributing

```bash
# 1. Create a feature branch
git checkout -b feature/my-feature

# 2. Make changes
# ...

# 3. Commit with Commitizen
bun run commit

# 4. Push and create PR
git push origin feature/my-feature
```

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Links

- **Live App**: https://brackeys.dev
- **Storybook**: https://brackeyscommunity.github.io/brackeys.community/
- **Discord**: Join the Brackeys Discord community
- **GitHub**: https://github.com/brackeyscommunity/brackeys-web

---

Built with ❤️ by the Brackeys Community
