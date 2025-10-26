# Development Setup & Troubleshooting Guide

This guide helps you set up and troubleshoot the Brackeys Web development environment.

## Table of Contents

- [Quick Start](#quick-start)
- [Mise (Tool Manager)](#mise-tool-manager)
- [Common Issues](#common-issues)
- [Platform-Specific Notes](#platform-specific-notes)
- [Manual Setup](#manual-setup)
- [FAQ](#faq)

## Quick Start

1. **Run the setup script:**
   - macOS/Linux/Git Bash: `./setup.sh`

2. **Set up environment variables:**
   ```bash
   # Create .env file with required variables
   cp .env.example .env  # If available, or create manually
   # Edit .env and set POSTGRES_PASSWORD and other required values
   ```

3. **Start infrastructure services:**
   ```bash
   docker compose up -d
   ```

4. **Start Hasura DDN services:**
   ```bash
   cd hasura-ddn
   ddn run docker-start
   ```

5. **Start development server:**
   ```bash
   mise run dev
   ```

That's it! The setup script handles tool installation, and Docker Compose handles infrastructure.

## Docker Infrastructure

The project uses Docker Compose for infrastructure services:

### Services

- **PostgreSQL** (`:5432`) - Main database for application and Bytebase metadata
- **Bytebase** (`:8081`) - Database schema migration and management tool
- **MinIO** (`:9000`, `:9001`) - S3-compatible object storage
- **Hasura DDN** (`:3280`) - GraphQL API engine (started separately via `ddn run docker-start`)

### Database Setup

PostgreSQL automatically initializes with:
- Main `brackeys` database for your application
- `bytebase` database for Bytebase metadata
- Proper users and permissions via `init-scripts/01-bytebase.sql`

### Environment Variables

Required in your `.env` file:

```bash
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=brackeys

# Bytebase (optional, defaults to 'bytebase')
BYTEBASE_PASSWORD=bytebase

# Hasura DDN Service Tokens (generate with: openssl rand -base64 32)
APP_POSTGRES_HASURA_SERVICE_TOKEN_SECRET=your_secret_here
APP_STORAGE_HASURA_SERVICE_TOKEN_SECRET=your_secret_here

# Optional: Hasura DDN PAT for telemetry
HASURA_DDN_PAT=your_pat_token
```

### Network Architecture

- Main compose file (`docker-compose.yml`) creates the `brackeys` network
- Hasura DDN compose (`hasura-ddn/compose.yaml`) joins the same network
- All services can communicate using service names (e.g., `postgres:5432`, `minio:9000`)

## Mise (Tool Manager)

[Mise](https://mise.jdx.dev/) is our tool manager that handles:

- Installing and managing tool versions (Bun, Node, Rust)
- Running development tasks
- Managing environment variables

### Key Mise Commands

```bash
# Install/update tools
mise install          # Install all tools defined in mise.toml
mise upgrade          # Upgrade mise itself

# Run tasks
mise tasks            # List all available tasks
mise run <task>       # Run a specific task

# Tool management
mise list             # Show installed tools
mise current          # Show currently active tool versions

# Trust project configuration
mise trust            # Trust the mise.toml file in current directory
```

## Common Issues

### 1. "Docker is not running"

**Solution:**

- Start Docker Desktop
- On Windows, ensure Docker Desktop is set to use WSL2
- Wait for Docker to fully start before running commands

### 2. "mise: command not found"

**Solution:**

```bash
# Re-run the installer
curl https://mise.run | sh

# Add to your shell (bash example)
echo 'eval "$(mise activate bash)"' >> ~/.bashrc
source ~/.bashrc
```

### 3. "Permission denied" errors

**Solution:**

```bash
# Make scripts executable
chmod +x setup.sh

# For mise installation issues
sudo chown -R $(whoami) ~/.local/share/mise
```

### 4. "Hasura connection failed"

**Solution:**

- Ensure Docker is running
- Check if ports are available: `lsof -i :3280` (macOS/Linux)
- Restart Hasura: `mise run dev-hasura`
- Rebuild supergraph: `cd hasura && ddn supergraph build local`
- Check Docker logs: `cd hasura && docker logs $(docker ps -q)`

### 5. "SpacetimeDB build failed"

**Solution:**

```bash
# Install Rust target manually
rustup target add wasm32-unknown-unknown

# Clean and rebuild
cd spacetime-db
cargo clean
cargo build --release --target wasm32-unknown-unknown
```

### 6. "Port already in use"

**Solution:**

```bash
# Find process using port (example for port 5173)
# macOS/Linux:
lsof -i :5173
kill -9 <PID>

# Windows:
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

## Platform-Specific Notes

### Windows

1. **Use PowerShell or Git Bash** - Command Prompt may not work correctly
2. **Enable Developer Mode** - Required for symlinks
3. **WSL2 Recommended** - Better performance for Docker
4. **Path Length** - Keep project path short to avoid Windows path limits

### macOS

1. **Xcode Command Line Tools** - Required for some dependencies

   ```bash
   xcode-select --install
   ```

2. **Homebrew** - Optional but recommended
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

### Linux

1. **Build essentials** - May need to install

   ```bash
   # Ubuntu/Debian
   sudo apt-get install build-essential

   # Fedora
   sudo dnf install @development-tools
   ```

## Manual Setup

If the automatic setup fails, follow these steps:

### 1. Install Mise

```bash
# Universal installer
curl https://mise.run | sh

# Or with package managers
brew install mise          # macOS
yay -S mise-bin           # Arch Linux
cargo install mise        # With Rust
```

### 2. Configure Shell

```bash
# Bash
echo 'eval "$(mise activate bash)"' >> ~/.bashrc

# Zsh
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc

# Fish
echo 'mise activate fish | source' >> ~/.config/fish/config.fish

# PowerShell
Add-Content $PROFILE 'mise activate pwsh | Out-String | Invoke-Expression'
```

### 3. Install Project Tools

```bash
cd /path/to/brackeys-web
mise trust
mise install
```

### 4. Set Up Environment

```bash
# Copy environment template
cp .env.example .env  # If it exists

# Or create manually
cat > .env << 'EOF'
VITE_SUPABASE_URL=your_url_here
VITE_SUPABASE_ANON_KEY=your_key_here
# ... other variables
EOF
```

### 5. Install Dependencies

```bash
bun install
cd spacetime-db && cargo build --release --target wasm32-unknown-unknown
```

### 6. Start Services

```bash
# Start everything
mise run dev

# Or individually
mise run dev-hasura    # Backend only
mise run dev-frontend  # Frontend only
```

## FAQ

### Q: Do I need to install Bun/Node/Rust separately?

**A:** No! Mise handles all tool installations automatically.

### Q: Can I use npm/yarn instead of Bun?

**A:** The project is configured for Bun, but you can modify `mise.toml` and scripts if needed.

### Q: How do I update tools?

**A:** Update versions in `mise.toml`, then run `mise install`.

### Q: Can I use this without Docker?

**A:** The frontend can run without Docker, but Hasura requires it. Use `mise run dev-frontend` for frontend-only development.

### Q: How do I add a new mise task?

**A:** Edit `mise.toml` and add your task under `[tasks.your-task-name]`.

### Q: Where are tools installed?

**A:** Mise installs tools in `~/.local/share/mise/installs/`.

### Q: How do I uninstall everything?

**A:**

```bash
mise implode          # Removes mise and all tools
rm -rf node_modules   # Remove project dependencies
docker compose -f hasura/compose.yaml down -v  # Remove Docker volumes
```

## Getting Help

1. **Check mise documentation:** https://mise.jdx.dev/
2. **Project issues:** Create an issue in the repository
3. **Mise issues:** https://github.com/jdx/mise/issues
4. **Discord:** Join the Brackeys community Discord

## Advanced Configuration

### Custom Tool Versions

Edit `mise.toml`:

```toml
[tools]
bun = "1.2.0"    # Specific version
node = "latest"  # Latest version
rust = "~1.75"   # Version range
```

### Environment-Specific Settings

```toml
[env]
_.file = [".env", ".env.local"]  # Load multiple env files
NODE_ENV = { default = "development" }
```

### Task Dependencies

```toml
[tasks.complex-task]
depends = ["setup", "build"]
run = "echo 'Running after dependencies'"
```

### Watching Files

```toml
[tasks.watch]
run = "bun run dev"
watch = ["src/**/*.ts", "src/**/*.tsx"]
```
