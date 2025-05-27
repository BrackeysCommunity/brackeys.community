# Brackeys Web

## Setup

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Application Configuration
VITE_APP_URL=http://localhost:5173
VITE_API_BASE_URL=http://localhost:3000

# Discord Configuration
VITE_BRACKEYS_GUILD_ID=your_discord_guild_id_here
```

The `VITE_BRACKEYS_GUILD_ID` is used to fetch guild-specific member data (roles, server avatar, nickname, etc.) when users authenticate with Discord.