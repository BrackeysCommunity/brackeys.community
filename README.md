# Brackeys Web

## 🚀 Quick Start (One-Command Setup)

Get started with a single command that sets up your entire development environment:

### macOS/Linux:

```bash
./setup.sh
```

This will:

- ✅ Install [mise](https://mise.jdx.dev/) for tool management
- ✅ Install all required tools (Bun, Node, Rust, etc.)
- ✅ Install [Hasura DDN CLI](https://hasura.io/docs/3.0/quickstart/)
- ✅ Set up your environment variables
- ✅ Install all dependencies
- ✅ Build the SpacetimeDB module (with WASM target)
- ✅ Configure Hasura DDN for local development
- ✅ Configure git hooks

After setup, just run:

```bash
mise run dev
```

## 📚 Documentation

### UI Components

Our UI components are documented and showcased using Storybook:

- **[View Live Storybook](https://brackeyscommunity.github.io/brackeys.community/)**
- **Local Development:** `mise run storybook` → [http://localhost:6006](http://localhost:6006)

### Available Documentation

- **[DEVELOPMENT_SETUP.md](./docs/DEVELOPMENT_SETUP.md)** - Complete setup guide and troubleshooting
- **[STORYBOOK_CHROMATIC.md](./docs/STORYBOOK_CHROMATIC.md)** - Storybook setup and deployment information
- **[PRETTIER_ESLINT_INTEGRATION.md](./docs/PRETTIER_ESLINT_INTEGRATION.md)** - Code formatting and linting configuration
- **[MULTI_SCOPE_COMMITS.md](./docs/MULTI_SCOPE_COMMITS.md)** - Guide for creating commits across multiple packages

## Development

### Prerequisites

- **Docker Desktop** - Required for running Hasura and database services
- That's it! Everything else is handled by mise 🎉

### Available Commands

All development tasks are managed through mise:

```bash
# Core Development
mise run dev              # Start all services (Hasura + Frontend)
mise run dev-frontend     # Start only frontend (if backend is already running)
mise run dev-hasura       # Start only Hasura services

# Code Quality
mise run lint             # Run linting checks
mise run lint-fix         # Fix linting issues
mise run test             # Run all tests
mise run pre-commit       # Run all pre-commit checks

# Building & Generation
mise run build            # Build production bundle
mise run codegen          # Generate GraphQL types
mise run storybook        # Start Storybook dev server

# Utilities
mise run db-console       # Open Hasura console
mise run clean            # Clean all generated files
mise run reset            # Full reset (clean + setup)
mise run update-deps      # Update all dependencies

# See all available tasks
mise tasks
```

### Manual Setup (if you prefer)

If you prefer to set up manually instead of using the setup scripts:

1. **Install mise:**

   ```bash
   curl https://mise.run | sh
   # or with Homebrew
   brew install mise
   ```

2. **Install tools:**

   ```bash
   mise trust
   mise install
   ```

3. **Run setup:**
   ```bash
   mise run setup
   ```

### Environment Variables

The setup script will create a `.env` file for you. Update it with your actual values:

```env
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

VITE_SPACETIME_HOST=wss://localhost:3000
VITE_SPACETIME_MODULE=brackeys-sandbox

# Application Configuration
VITE_APP_URL=http://localhost:5173
VITE_API_BASE_URL=http://localhost:3000

# Discord Configuration
VITE_BRACKEYS_GUILD_ID=your_discord_guild_id_here
```

The `VITE_BRACKEYS_GUILD_ID` is used to fetch guild-specific member data (roles, server avatar, nickname, etc.) when users authenticate with Discord.

## Layout System

each route component can specify its layout requirements using the `useLayoutProps` hook.

### Usage Example

```tsx
import { useLayoutProps } from '../context/layoutContext';

export const MyPage = () => {
  useLayoutProps({
    showFooter: false,
    containerized: false,
    mainClassName: 'flex',
    fullHeight: true,
  });

  return <div>content</div>;
};
```

### Available Layout Props

| Prop            | Type      | Default       | Description                                        |
| --------------- | --------- | ------------- | -------------------------------------------------- |
| `showFooter`    | `boolean` | `true`        | Whether to show the footer                         |
| `showHeader`    | `boolean` | `true`        | Whether to show the header                         |
| `containerized` | `boolean` | `true`        | Whether to apply container max-width and centering |
| `mainClassName` | `string`  | `"px-4 pt-8"` | Custom classes for the main content area           |
| `fullHeight`    | `boolean` | `false`       | Whether to apply full height styles                |
