# Webhook Testing Guide with ngrok

## Setup ngrok for Clerk Webhooks

### 1. Install ngrok (if not already installed)

**Windows:**
```bash
# Using Chocolatey
choco install ngrok

# Or download from https://ngrok.com/download
```

**macOS:**
```bash
brew install ngrok
```

**Linux:**
```bash
# Download and install
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
sudo apt update && sudo apt install ngrok
```

### 2. Sign up for ngrok (Free)

1. Go to https://dashboard.ngrok.com/signup
2. Sign up for a free account
3. Copy your auth token from https://dashboard.ngrok.com/get-started/your-authtoken

### 3. Configure ngrok

```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN_HERE
```

### 4. Start Your Dev Server

In one terminal:
```bash
bun run dev
```

This starts your app on http://localhost:3000

### 5. Start ngrok Tunnel

In a second terminal:
```bash
ngrok http 3000
```

You'll see output like:
```
Session Status                online
Account                       your-email@example.com
Version                       3.x.x
Region                        United States (us)
Latency                       -
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://abc123.ngrok.io -> http://localhost:3000

Connections                   ttl     opn     rt1     rt5     p50     p90
                              0       0       0.00    0.00    0.00    0.00
```

### 6. Configure Clerk Webhook

1. Go to Clerk Dashboard: https://dashboard.clerk.com
2. Navigate to: **Webhooks** (in left sidebar)
3. Click **Add Endpoint**
4. Enter your ngrok URL + webhook path:
   ```
   https://YOUR_NGROK_SUBDOMAIN.ngrok.io/api/webhooks/clerk
   ```
   (Example: `https://abc123.ngrok.io/api/webhooks/clerk`)

5. Subscribe to events:
   - ✅ `user.created`
   - ✅ `session.created`

6. Click **Create**
7. Copy the **Signing Secret** (starts with `whsec_`)

### 7. Add Webhook Secret to .env

```env
CLERK_WEBHOOK_SECRET=whsec_your_secret_here
```

### 8. Test the Webhook

**Trigger a test event:**
1. In Clerk Dashboard → Webhooks → Your endpoint
2. Click "Send Test Event"
3. Choose `user.created` or `session.created`
4. Click "Send"

**Watch your terminal** running `bun run dev` for logs:
```
Clerk webhook received: user.created
```

### 9. ngrok Web Interface

Visit http://localhost:4040 to see:
- All incoming requests in real-time
- Request/response details
- Replay requests for testing

## Enhanced Logging

Update the webhook handler for better debugging:

```typescript
// src/routes/api/webhooks/clerk.tsx
export const Route = createFileRoute('/api/webhooks/clerk')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();

          console.log('==== CLERK WEBHOOK ====');
          console.log('Event Type:', body.type);
          console.log('Event Data:', JSON.stringify(body.data, null, 2));
          console.log('======================');

          // TODO: Verify Svix signature
          // TODO: Sync Discord roles

          return json({ received: true });
        } catch (error) {
          console.error('❌ Webhook error:', error);
          return json({ error: 'Webhook processing failed' }, { status: 500 });
        }
      },
    },
  },
});
```

## Testing Real Discord OAuth

1. **Start servers:**
   ```bash
   # Terminal 1: Dev server
   bun run dev
   
   # Terminal 2: ngrok
   ngrok http 3000
   ```

2. **Update Clerk OAuth redirect URLs:**
   - Clerk Dashboard → **OAuth** → **Redirect URLs**
   - Add: `https://YOUR_NGROK_SUBDOMAIN.ngrok.io/auth/entry`

3. **Test login flow:**
   - Visit: `https://YOUR_NGROK_SUBDOMAIN.ngrok.io/login`
   - Click "Sign in with Discord"
   - Authorize
   - Watch webhook fire in terminal!

## Troubleshooting

### "ngrok: command not found"
Install ngrok following step 1 above.

### "ERR_NGROK_108: Invalid credentials"
Run `ngrok config add-authtoken YOUR_TOKEN` with your auth token from ngrok dashboard.

### Webhook not receiving events
- Check ngrok is running and forwarding to port 3000
- Verify webhook URL in Clerk Dashboard matches ngrok URL exactly
- Check Clerk Dashboard → Webhooks → Logs for errors

### CORS errors
Add CORS headers to webhook handler:
```typescript
return json({ received: true }, {
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  },
});
```

## Production Setup

For production, replace ngrok URL with your actual deployment URL:
- Vercel: `https://your-app.vercel.app/api/webhooks/clerk`
- Custom domain: `https://brackeys.dev/api/webhooks/clerk`

Don't forget to update:
1. Clerk webhook endpoint URL
2. Clerk OAuth redirect URLs
3. CORS allowed origins

## Tips

- **Keep ngrok running** while developing with webhooks
- **Use ngrok web interface** (http://localhost:4040) for debugging
- **Replay requests** from ngrok interface to test without retriggering auth
- **Free ngrok** gives random subdomain - use paid version for custom subdomain
- **ngrok expires** - restart tunnel if it disconnects (free tier has 2hr limit)

