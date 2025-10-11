# Migration Status: brackeys-web → TanStack Start

## ✅ Completed Phases

### Phase 1-3: Foundation ✅
- ✅ Copied all infrastructure: hasura/, spacetime-db/, docs/, .storybook/
- ✅ Copied configuration files: docker-compose.yml, mise.toml, codegen.ts, etc.
- ✅ Merged package.json dependencies (SpacetimeDB, GraphQL, Motion, Clerk, etc.)
- ✅ Configured Biome (replaced ESLint/Prettier)
- ✅ Merged Tailwind styles with Brackeys color palette and custom utilities
- ✅ Copied GraphQL infrastructure (operations, schema, generated types)
- ✅ Copied SpacetimeDB TypeScript bindings
- ✅ Set up git hooks (Husky), commitlint, lerna, standard-version

### Phase 4: Contexts & Providers ✅
- ✅ Copied all context providers:
  - ClerkAuthProvider (Discord OAuth integration)
  - SpacetimeDBProvider (real-time WebSocket connection)
  - SandboxProvider (canvas state management)
  - LayoutProvider (per-route layout configuration)
  - QueryClientProvider (TanStack Query)
- ✅ Updated Clerk integration in `src/integrations/clerk/provider.tsx`
- ✅ Added Clerk auth middleware stub in `src/app/global-middleware.ts`

### Phase 5: Server Functions ✅
- ✅ Created server function structure in `src/server/`
- ✅ Created Discord role sync server function (stub)
- ✅ Created Clerk webhook server function (stub)
- ✅ Created API routes:
  - `/api/webhooks/clerk` - Clerk webhook endpoint
  - `/api/auth/sync-discord` - Manual Discord role sync

### Phase 6: Route Migration ✅
- ✅ Created all main routes:
  - `/` - Home (with HeroSection, FeatureSection, CtaSection)
  - `/login` - Login page
  - `/profile` - User profile with Discord data
  - `/resources` - Games & tools directory
  - `/sandbox` - Real-time multiplayer canvas
  - `/collaborations/` - Collaboration listing
  - `/collaborations/$postId` - Individual collaboration
  - `/collaboration-hub` - Collaboration dashboard
  - `/auth/entry` - Post-OAuth validation
  - `/games/snake` - Snake game
  - `/tools/$toolId` - Tool embed
- ✅ Updated `__root.tsx` with Brackeys layout system
- ✅ Integrated Header, Footer, LayoutProvider, Toaster

### Phase 7-9: Components & Utilities ✅
- ✅ Copied all component directories:
  - auth/, collaborations/, games/, home/, layout/
  - resources/, sandbox/, tools/, icons/
  - UI components: Alert, Button, Input, Modal, Loading, SplashScreen, etc.
- ✅ Copied all hooks: query/, sandbox/, useDiscordSync, useGraphQL, etc.
- ✅ Copied utilities: colors.ts, constants.ts, toast.ts, utils.ts
- ✅ Copied static data: resources.ts

### Phase 10: Testing ✅
- ✅ Copied vitest.shims.d.ts, vitest.workspace.ts
- ✅ Storybook configuration and stories already copied

### Phase 11: Cleanup ✅
- ✅ Removed all demo routes (`src/routes/demo/`)
- ✅ Removed demo components, hooks, data files
- ✅ Removed demo storybook components
- ✅ Removed todos.json

## 🔧 Known Issues to Fix

### TypeScript Errors (~126 total)

#### 1. Route Type Errors
Many components are trying to navigate to routes that don't exist yet in the generated route types.

**Fix**: Run `bunx tsr generate` after creating all routes.

#### 2. Import Path Issues
Several files still use relative imports instead of `@/` aliases.

**Examples**:
- `../ui/Button` → `@/components/ui/Button`
- `../lib/colors` → `@/lib/colors`
- `../../context/useAuth` → `@/context/useAuth`

**Fix**: Global find/replace in affected files.

#### 3. Motion Import Issue
`useTimeout` from `@uidotdev/usehooks` doesn't exist in current version.

**Fix**: Replace with custom timeout hook or remove feature.

#### 4. Modal/Toast Duration Type
Toast duration expects boolean in some versions.

**Fix**: Update prop types in affected components.

## 🚀 SSR Configuration

Routes currently use **Full SSR by default**. To change SSR mode per route:

### Full SSR (Default)
```typescript
export const Route = createFileRoute('/my-route')({
  component: MyComponent,
});
```

### Data-Only SSR
```typescript
export const Route = createFileRoute('/my-route')({
  ssr: 'data-only', // Server fetches data, client renders UI
  component: MyComponent,
  loader: async () => {
    return await fetchDataServerSide();
  },
});
```

### SPA Mode
```typescript
export const Route = createFileRoute('/my-route')({
  ssr: false, // Fully client-side
  component: MyComponent,
});
```

## 📋 Remaining Work

### 1. Fix Import Paths (Priority: HIGH)
Run find/replace across codebase to fix relative imports to use `@/` aliases.

### 2. Implement Server Functions (Priority: HIGH)
Complete the stubs in `src/server/`:
- `webhooks/clerk.ts` - Add Svix webhook verification, Discord API calls
- `auth/discord-sync.ts` - Implement with Clerk server SDK
- `graphql/*.ts` - Create wrapper functions for SSR data loading

### 3. Add GraphQL SSR Loaders (Priority: MEDIUM)
Update data-heavy routes to use server functions in loaders:
- `/collaborations/` - Load posts server-side
- `/profile` - Load user data server-side
- `/collaborations/$postId` - Load post details server-side

### 4. Fix Component Issues (Priority: MEDIUM)
- Replace `useTimeout` usage in ColorPickerInput
- Fix Toast/Modal duration prop types
- Ensure all UI component exports are correct

### 5. Update Documentation (Priority: LOW)
- Update README.md with Brackeys-specific content
- Add SSR_CONFIGURATION.md in docs/
- Update AUTH_FLOW.md for TanStack Start architecture

### 6. Test & Verify (Priority: HIGH)
- Fix all TypeScript errors
- Test Clerk Discord OAuth flow
- Test SpacetimeDB connection
- Test real-time sandbox features
- Test GraphQL queries
- Build production bundle

## 🎯 Quick Start

```bash
# Install dependencies
bun install

# Build SpacetimeDB Rust module (first time only)
cd spacetime-db
cargo build --release --target wasm32-unknown-unknown
cd ..

# Start development (requires Docker for Hasura)
bun run dev
```

## 📝 Environment Setup

Create `.env` file with:

```env
# Clerk
VITE_CLERK_PUBLISHABLE_KEY=your_key_here

# Hasura
VITE_HASURA_GRAPHQL_URL=http://localhost:3280/graphql

# SpacetimeDB
VITE_SPACETIME_HOST=wss://localhost:3000
VITE_SPACETIME_MODULE=brackeys-sandbox

# Discord
VITE_BRACKEYS_GUILD_ID=your_guild_id

# See .env.example for full list
```

## 🔍 Type Checking

```bash
# Check types (will show ~126 errors currently)
bunx tsc --noEmit

# Format/lint code
bun run format
bun run lint
```

## ✨ What's Working

- ✅ Project structure and configuration
- ✅ All components and hooks copied
- ✅ Route structure created
- ✅ Tailwind styling with Brackeys theme
- ✅ GraphQL infrastructure
- ✅ SpacetimeDB bindings
- ✅ Git workflow (commits, versioning)

## ⚠️ What Needs Work

- ⚠️ TypeScript errors (import paths mainly)
- ⚠️ Server function implementations
- ⚠️ SSR data loading for GraphQL
- ⚠️ Testing the full auth flow
- ⚠️ Building and running the app

## 📚 Next Steps

1. **Fix import paths** (bulk find/replace)
2. **Complete server functions** (webhook handlers, GraphQL wrappers)
3. **Test the app** (run dev server, fix runtime errors)
4. **Add SSR loaders** to data-heavy routes
5. **Update documentation** for the new architecture

