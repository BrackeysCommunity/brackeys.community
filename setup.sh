#!/bin/bash
# Brackeys Web - One-Command Development Setup
# This script sets up everything a new developer needs

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Main setup
print_header "🚀 Brackeys Web Development Setup"

# Check if mise is installed
if ! command -v mise &> /dev/null; then
    print_warning "Mise not found. Installing mise..."

    # Detect OS and install mise
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install mise
        else
            curl https://mise.run | sh
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        curl https://mise.run | sh
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
        # Windows (Git Bash/WSL)
        print_warning "Installing mise on Windows..."
        curl https://mise.run | sh
    else
        print_error "Unsupported OS: $OSTYPE"
        exit 1
    fi

    # Add mise to PATH for current session
    export PATH="$HOME/.local/bin:$PATH"

    # Setup shell integration
    echo 'eval "$(mise activate bash)"' >> ~/.bashrc
    echo 'eval "$(mise activate zsh)"' >> ~/.zshrc 2>/dev/null || true

    print_success "Mise installed successfully!"
else
    print_success "Mise is already installed (version: $(mise --version))"
fi

# Trust the mise.toml file
print_header "🔧 Setting up development environment"
mise trust

# Install all tools defined in mise.toml
print_warning "Installing development tools (this may take a few minutes)..."
mise install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    print_header "📝 Creating .env file"

    cat > .env << 'EOF'
# Brackeys Web Environment Configuration
# Please update these values with your actual credentials

# Supabase Configuration
# Get these from: https://app.supabase.com/project/_/settings/api
VITE_SUPABASE_URL=your_supabase_url_here
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here

# SpacetimeDB Configuration
VITE_SPACETIME_HOST=wss://localhost:3000
VITE_SPACETIME_MODULE=brackeys-sandbox

# Application Configuration
VITE_APP_URL=http://localhost:5173
VITE_API_BASE_URL=http://localhost:3000

# Discord Configuration
# Get this from Discord Developer Portal
VITE_BRACKEYS_GUILD_ID=your_discord_guild_id_here

# Hasura Configuration
HASURA_GRAPHQL_ENDPOINT=http://localhost:3280/graphql
HASURA_GRAPHQL_ADMIN_SECRET=local_dev_secret

# Hasura DDN (for deployment - optional for local dev)
HASURA_DDN_PAT=your_hasura_ddn_pat_here

# Database Configuration
APP_COLLAB_JDBC_URL=postgresql://postgres:postgres@localhost:5432/collab
APP_COLLAB_HASURA_SERVICE_TOKEN_SECRET=local_dev_token
APP_COLLAB_FULLY_QUALIFY_NAMES=false
APP_COLLAB_OTEL_EXPORTER_OTLP_ENDPOINT=http://local.hasura.dev:4317
APP_COLLAB_OTEL_SERVICE_NAME=app_collab
EOF

    print_success ".env file created!"
    print_warning "Please update .env with your actual values before running the app"
else
    print_success ".env file already exists"
fi

# Check Docker
print_header "🐳 Checking Docker"
if command -v docker &> /dev/null; then
    print_success "Docker is installed"

    # Check if Docker is running
    if docker info &> /dev/null; then
        print_success "Docker is running"
    else
        print_warning "Docker is installed but not running. Please start Docker Desktop."
    fi
else
    print_error "Docker is not installed!"
    print_warning "Please install Docker Desktop from: https://www.docker.com/products/docker-desktop"
    print_warning "Docker is required for running Hasura DDN connectors locally"
fi

# Check/Install Hasura DDN CLI
print_header "🚀 Checking Hasura DDN CLI"
if command -v ddn &> /dev/null; then
    print_success "Hasura DDN CLI is installed (version: $(ddn version 2>/dev/null || echo 'unknown'))"
else
    print_warning "Hasura DDN CLI not found. Installing..."

    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
        print_error "Windows detected - please install DDN CLI manually"
        print_warning "Download from: https://hasura.io/docs/3.0/quickstart/"
        print_warning "Run the Windows installer, then re-run this setup script"
        exit 1
    else
        curl -L https://graphql-engine-cdn.hasura.io/ddn/cli/v4/get.sh | bash

        # Add to PATH for current session
        export PATH="$HOME/.local/bin:$PATH"

        print_success "Hasura DDN CLI installed!"
    fi
fi

# Run initial setup
print_header "📦 Running initial project setup"
mise run setup

# Final instructions
print_header "✨ Setup Complete!"
echo "To start development:"
echo "  1. Make sure Docker is running"
echo "  2. Update your .env file with real values"
echo "  3. Run: mise run dev"
echo
echo "Available commands:"
echo "  mise run dev             - Start all development services"
echo "  mise run dev-frontend    - Start only frontend"
echo "  mise run dev-hasura      - Start only Hasura DDN"
echo "  mise run hasura-console  - Open Hasura DDN console"
echo "  mise run test            - Run tests"
echo "  mise run lint            - Run linting"
echo "  mise run storybook       - Start Storybook"
echo "  mise run build           - Build for production"
echo
echo "For more commands, run: mise tasks"
echo
print_success "Happy coding! 🎉"
