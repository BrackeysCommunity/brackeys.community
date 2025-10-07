# Brackeys Web

A modern web application built with React, Ory authentication, Hasura GraphQL, and a complete self-hosted backend stack.

## 🏗️ Stack

- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Authentication**: Clerk (Discord OAuth)
- **API**: Hasura GraphQL Engine
- **Database**: PostgreSQL
- **Cache**: Redis
- **Storage**: MinIO (S3-compatible)

## 🚀 Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Configure Clerk
# Add VITE_CLERK_PUBLISHABLE_KEY to .env
# See CLERK_SETUP.md for details

# 3. Start backend services
docker-compose up -d

# 4. Start development server
bun run dev
```

Visit http://localhost:5173 to see your app!

For detailed setup instructions, see [CLERK_SETUP.md](CLERK_SETUP.md).

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

### 🔐 Authentication

We use **Ory Kratos + Hydra** for self-hosted authentication with Discord OAuth:

- **[ory/INDEX.md](./ory/INDEX.md)** - Authentication documentation hub
- **[ory/QUICKSTART.md](./ory/QUICKSTART.md)** - Quick setup guide
- **[ory/SUMMARY.md](./ory/SUMMARY.md)** - Complete reference

Features:

- Discord social login
- Automatic Discord role → Hasura permissions mapping
- JWT tokens with custom claims
- Session management

### 🗄️ Backend Services

All backend services are managed via Docker Compose:

- **PostgreSQL** - Primary database (port 5432)
- **Hasura** - GraphQL API (port 8080) - [Console](http://localhost:8080)
- **Redis** - Caching and sessions (port 6379)
- **MinIO** - Object storage (port 9000/9001) - [Console](http://localhost:9001)
- **Ory Kratos/Hydra** - Authentication (ports 4433/4444)

See [SETUP.md](SETUP.md) for detailed configuration.

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
