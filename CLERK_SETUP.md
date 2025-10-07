# Clerk Authentication Setup

## Quick Start

### 1. Create a Clerk Account

Go to https://clerk.com and create an account.

### 2. Create an Application

1. Click "Add application"
2. Choose "Discord" as the authentication provider
3. Configure Discord OAuth (you'll need your Discord OAuth app credentials)

### 3. Get Your Publishable Key

1. Go to https://dashboard.clerk.com/last-active?path=api-keys
2. Select "React"
3. Copy your **Publishable Key**

### 4. Configure Environment Variables

Add to your `.env` file:

```env
# Clerk
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here

# Hasura JWT (from Clerk Dashboard → JWT Templates)
HASURA_GRAPHQL_JWT_SECRET={"jwk_url":"https://your-clerk-frontend-api/.well-known/jwks.json"}
```

### 5. Configure Clerk JWT Template for Hasura

In Clerk Dashboard:

1. Go to **JWT Templates**
2. Click "New template"
3. Choose "Hasura" template
4. Name it `hasura`
5. Add these claims:

```json
{
  "https://hasura.io/jwt/claims": {
    "x-hasura-allowed-roles": ["user", "admin", "staff", "moderator", "brackeys"],
    "x-hasura-default-role": "{{user.publicMetadata.hasura.defaultRole}}",
    "x-hasura-user-id": "{{user.id}}",
    "x-hasura-discord-id": "{{user.externalAccounts.oauth_discord.externalId}}"
  }
}
```

6. Save the template

### 6. Enable Discord OAuth in Clerk

1. In Clerk Dashboard, go to **User & Authentication → Social Connections**
2. Enable **Discord**
3. Enter your Discord OAuth credentials:
   - Client ID: `${DISCORD_CLIENT_ID}`
   - Client Secret: `${DISCORD_CLIENT_SECRET}`
4. Add these scopes: `identify`, `email`, `guilds`, `guilds.members.read`
5. Save

### 7. Start Your App

```bash
# Start backend services
docker-compose up -d

# Start frontend
bun run dev
```

Visit http://localhost:5173 and click "Login with Discord"!

## How It Works

1. User clicks "Login with Discord"
2. Clerk handles the entire OAuth flow
3. User data is stored in Clerk
4. Clerk issues JWT with Hasura claims
5. Frontend uses JWT to authenticate with Hasura
6. Hasura enforces permissions based on roles

## Hasura Roles

Roles are automatically set based on Discord guild membership:

- **admin** - Discord role ID: `451380371284557824`
- **staff** - Discord role ID: `756285704061059213`
- **moderator** - Discord role ID: `756178968901582859`
- **brackeys** - Discord role ID: `491536338525356042`
- **user** - Default role

To set roles, update user metadata in Clerk Dashboard or via API.

## Benefits Over Ory

✅ No self-hosted auth services needed
✅ Automatic token management and refresh
✅ Built-in user management dashboard
✅ Easy Discord OAuth integration
✅ JWT templates with Hasura support
✅ webhooks for custom logic
✅ Production-ready scaling
✅ No configuration headaches

## Production Checklist

- [ ] Update Clerk production instance
- [ ] Configure production Discord OAuth app
- [ ] Set up Clerk webhooks for role syncing
- [ ] Update CORS settings in Hasura
- [ ] Enable Clerk's production features (2FA, etc.)

## Resources

- [Clerk Documentation](https://clerk.com/docs)
- [Clerk + Hasura Guide](https://clerk.com/docs/integrations/databases/hasura)
- [Clerk Discord](https://clerk.com/discord)
