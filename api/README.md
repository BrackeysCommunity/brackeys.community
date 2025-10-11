# Vercel Serverless Functions

This directory contains Vercel serverless functions for handling Clerk webhooks and Discord role synchronization.

## Functions

### `/api/webhooks/clerk`

**Clerk webhook handler** - Automatically syncs Discord roles when users sign in.

- Receives webhooks from Clerk
- Verifies webhook signature using Svix
- Fetches Discord OAuth token from Clerk
- Gets Discord guild member data
- Updates Clerk user metadata with roles
- Runs automatically on `user.created` and `session.created` events

### `/api/sync-discord-roles`

**Manual sync endpoint** - For testing or re-syncing a specific user.

**Request:**

```bash
curl -X POST https://your-app.vercel.app/api/sync-discord-roles \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_xxxxx"}'
```

**Response:**

```json
{
  "success": true,
  "roles": ["user", "moderator"],
  "defaultRole": "moderator",
  "memberData": {
    "avatar": "...",
    "nick": "...",
    "roles": ["..."],
    "joined_at": "..."
  }
}
```

## Deployment

### 1. Install Dependencies

```bash
cd api
npm install
```

### 2. Deploy to Vercel

```bash
# From project root
vercel --prod
```

### 3. Set Environment Variables in Vercel

Go to Vercel Dashboard → Your Project → Settings → Environment Variables:

```env
CLERK_SECRET_KEY=sk_test_your_secret_key
CLERK_WEBHOOK_SECRET=whsec_your_webhook_secret
DISCORD_GUILD_ID=240491168985399296
```

### 4. Configure Clerk Webhook

1. Clerk Dashboard → Webhooks → Add Endpoint
2. URL: `https://your-app.vercel.app/api/webhooks/clerk`
3. Events: `user.created`, `session.created`
4. Copy signing secret → Add to Vercel as `CLERK_WEBHOOK_SECRET`
5. Redeploy: `vercel --prod`

## How It Works

1. User signs in with Discord via Clerk
2. Clerk sends webhook to your Vercel function
3. Function gets Discord OAuth token from Clerk
4. Function fetches Discord guild member data
5. Function maps Discord roles to Hasura roles:
   - Discord role `451380371284557824` → `admin`
   - Discord role `756285704061059213` → `staff`
   - Discord role `756178968901582859` → `moderator`
   - Discord role `491536338525356042` → `brackeys`
   - Default → `user`
6. Function updates Clerk user metadata
7. Clerk JWT includes roles (via JWT template)
8. Frontend gets updated user with roles

## Testing

You can test the manual sync endpoint after deploying:

```bash
# Get your user ID from Clerk Dashboard or browser console
curl -X POST https://your-app.vercel.app/api/sync-discord-roles \
  -H "Content-Type: application/json" \
  -d '{"userId": "user_your_id_here"}'
```

## Monitoring

View function logs in Vercel Dashboard → Your Project → Functions → Click on a function.

## Local Development

For local testing with Vercel CLI:

```bash
vercel dev
```

This starts a local server at `http://localhost:3000` that simulates the Vercel environment.
