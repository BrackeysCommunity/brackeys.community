#!/bin/bash
# Brackeys Web - Development Environment Doctor
# This script checks your development environment for common issues

set -e

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

# Track if any issues were found
ISSUES_FOUND=0

print_header "🩺 Brackeys Web Development Environment Doctor"

# Check mise
print_header "Checking mise"
if command -v mise &> /dev/null; then
    print_success "mise is installed ($(mise --version))"

    # Check if mise is activated
    if [[ -n "$MISE_SHELL" ]]; then
        print_success "mise is activated in your shell"
    else
        print_warning "mise is not activated in your shell"
        echo "   Add this to your shell config: eval \"\$(mise activate bash)\""
        ISSUES_FOUND=1
    fi
else
    print_error "mise is not installed"
    echo "   Install with: curl -L https://mise.run | sh"
    ISSUES_FOUND=1
fi

# Check required tools
print_header "Checking required tools"

# Bun
if command -v bun &> /dev/null; then
    print_success "Bun is installed ($(bun --version))"
else
    print_error "Bun is not installed"
    echo "   Run: mise install"
    ISSUES_FOUND=1
fi

# Node
if command -v node &> /dev/null; then
    print_success "Node is installed ($(node --version))"
else
    print_error "Node is not installed"
    echo "   Run: mise install"
    ISSUES_FOUND=1
fi

# Rust
if command -v rustc &> /dev/null; then
    print_success "Rust is installed ($(rustc --version))"

    # Check WASM target
    if rustup target list --installed | grep -q wasm32-unknown-unknown; then
        print_success "Rust WASM target is installed"
    else
        print_error "Rust WASM target is not installed"
        echo "   Run: rustup target add wasm32-unknown-unknown"
        ISSUES_FOUND=1
    fi
else
    print_error "Rust is not installed"
    echo "   Run: mise install"
    ISSUES_FOUND=1
fi

# Docker
print_header "Checking Docker"
if command -v docker &> /dev/null; then
    print_success "Docker is installed"

    if docker info &> /dev/null; then
        print_success "Docker daemon is running"
    else
        print_error "Docker daemon is not running"
        echo "   Start Docker Desktop"
        ISSUES_FOUND=1
    fi
else
    print_error "Docker is not installed"
    echo "   Install from: https://www.docker.com/products/docker-desktop"
    ISSUES_FOUND=1
fi

# Hasura DDN CLI
print_header "Checking Hasura DDN CLI"
if command -v ddn &> /dev/null; then
    print_success "Hasura DDN CLI is installed"

    # Run ddn doctor
    echo "Running ddn doctor..."
    if ddn doctor &> /dev/null; then
        print_success "ddn doctor passed"
    else
        print_warning "ddn doctor reported issues"
        echo "   Run: ddn doctor"
        ISSUES_FOUND=1
    fi
else
    print_error "Hasura DDN CLI is not installed"
    echo "   Install from: https://hasura.io/docs/3.0/quickstart/"
    ISSUES_FOUND=1
fi

# Check project files
print_header "Checking project files"

# .env file
if [ -f .env ]; then
    print_success ".env file exists"

    # Check for placeholder values
    if grep -q "your_.*_here" .env; then
        print_warning ".env contains placeholder values"
        echo "   Update .env with your actual values"
        ISSUES_FOUND=1
    fi
else
    print_error ".env file is missing"
    echo "   Copy .env.example to .env and update values"
    ISSUES_FOUND=1
fi

# node_modules
if [ -d node_modules ]; then
    print_success "node_modules exists"
else
    print_warning "node_modules is missing"
    echo "   Run: bun install"
fi

# SpacetimeDB build
if [ -f spacetime-db/target/wasm32-unknown-unknown/release/spacetime_module.wasm ]; then
    print_success "SpacetimeDB module is built"
else
    print_warning "SpacetimeDB module is not built"
    echo "   Run: mise run setup"
fi

# Hasura build
if [ -d hasura/engine/build ]; then
    print_success "Hasura supergraph is built"
else
    print_warning "Hasura supergraph is not built"
    echo "   Run: cd hasura && ddn supergraph build local"
fi

# Check ports
print_header "Checking ports"

check_port() {
    local port=$1
    local service=$2

    if [[ "$OSTYPE" == "darwin"* ]] || [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if lsof -i :$port &> /dev/null; then
            print_warning "Port $port is in use (needed for $service)"
            echo "   Kill process using: lsof -i :$port"
            ISSUES_FOUND=1
        else
            print_success "Port $port is available for $service"
        fi
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        if netstat -an | grep -q ":$port.*LISTENING"; then
            print_warning "Port $port is in use (needed for $service)"
            echo "   Find process: netstat -ano | findstr :$port"
            ISSUES_FOUND=1
        else
            print_success "Port $port is available for $service"
        fi
    fi
}

check_port 5173 "Vite dev server"
check_port 3280 "Hasura GraphQL Engine"
check_port 3000 "SpacetimeDB"

# Summary
print_header "Summary"
if [ $ISSUES_FOUND -eq 0 ]; then
    print_success "All checks passed! Your environment is ready."
    echo
    echo "Start development with: mise run dev"
else
    print_error "$ISSUES_FOUND issue(s) found"
    echo
    echo "Fix the issues above and run this script again."
fi

exit $ISSUES_FOUND
