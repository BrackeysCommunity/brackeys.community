# Brackeys Web

## Setup

### Environment Variables

Create a `.env` file in the root directory with the following variables:

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
    mainClassName: "flex",
    fullHeight: true
  });

  return <div>content</div>;
};
```

### Available Layout Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `showFooter` | `boolean` | `true` | Whether to show the footer |
| `showHeader` | `boolean` | `true` | Whether to show the header |
| `containerized` | `boolean` | `true` | Whether to apply container max-width and centering |
| `mainClassName` | `string` | `"px-4 pt-8"` | Custom classes for the main content area |
| `fullHeight` | `boolean` | `false` | Whether to apply full height styles |
