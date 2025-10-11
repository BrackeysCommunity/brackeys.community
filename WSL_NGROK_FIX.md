# Fixing ngrok WSL2 → Windows Localhost Issue

## The Problem

ngrok running in WSL2 can't reach `localhost:3000` in Windows because they have separate network stacks.

## Solution Options

### Option 1: Use Windows Host IP from WSL2 (Recommended)

1. **Stop the current ngrok** (Ctrl+C in WSL terminal)

2. **Get your Windows IP address:**
   ```bash
   # In WSL2, run:
   wsl hostname -I
   # Or in Windows PowerShell:
   ipconfig | findstr IPv4
   ```
   
   Look for something like: `172.x.x.x` or `192.168.x.x`

3. **Start ngrok pointing to Windows IP:**
   ```bash
   # In WSL2:
   ngrok http 172.x.x.x:3000
   # Replace 172.x.x.x with your actual Windows IP
   ```

### Option 2: Install ngrok on Windows (Easiest)

1. **Download ngrok for Windows:**
   - Go to: https://ngrok.com/download
   - Download Windows version (zip file)
   - Extract to a folder (e.g., `C:\tools\ngrok\`)

2. **Add to PATH (optional):**
   ```powershell
   # PowerShell (as Admin):
   $env:Path += ";C:\tools\ngrok"
   [Environment]::SetEnvironmentVariable("Path", $env:Path, "Machine")
   ```

3. **Authenticate:**
   ```bash
   ngrok config add-authtoken YOUR_TOKEN
   ```

4. **Run from Windows Git Bash:**
   ```bash
   ngrok http 3000
   ```

### Option 3: Use WSL2 Special Hostname

In WSL2, you can access Windows localhost using a special hostname:

```bash
# In WSL2:
ngrok http host.docker.internal:3000
# or
ngrok http $(cat /etc/resolv.conf | grep nameserver | awk '{print $2}'):3000
```

## Quick Test

Once ngrok is running, test it:

```bash
# Get your ngrok URL from http://localhost:4040
# Then test:
curl https://YOUR_NGROK_URL.ngrok-free.app/
```

You should see your app's HTML response instead of 502.

## Current Status

Your ngrok URL is: `https://399186e0bee5.ngrok.app`

Try one of the solutions above, then test:
```bash
curl https://399186e0bee5.ngrok.app/
```

If you see HTML, it's working! If you still get 502, the connection issue persists.

