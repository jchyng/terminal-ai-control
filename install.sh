#!/bin/bash

# Terminal AI Control - Quick Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/user/repo/main/install.sh | bash

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║   🖥️  Terminal AI Control - Quick Install                  ║"
echo "║                                                            ║"
echo "║   Your server. Your network. Your AI.                      ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js
echo -e "${YELLOW}[1/5]${NC} Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        echo -e "${GREEN}✓${NC} Node.js $(node -v) found"
    else
        echo -e "${RED}✗${NC} Node.js 18+ required, found $(node -v)"
        exit 1
    fi
else
    echo -e "${RED}✗${NC} Node.js not found. Please install Node.js 18+"
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

# Check build tools
echo -e "${YELLOW}[2/5]${NC} Checking build tools..."
if command -v gcc &> /dev/null && command -v g++ &> /dev/null; then
    echo -e "${GREEN}✓${NC} Build tools found"
else
    echo -e "${YELLOW}!${NC} Installing build tools..."
    if [ -f /etc/debian_version ]; then
        sudo apt update && sudo apt install -y build-essential python3
    elif [ -f /etc/arch-release ]; then
        sudo pacman -S --noconfirm base-devel python
    elif [ "$(uname)" == "Darwin" ]; then
        xcode-select --install 2>/dev/null || true
    fi
fi

# Install dependencies
echo -e "${YELLOW}[3/5]${NC} Installing dependencies..."
npm install

# Create config
echo -e "${YELLOW}[4/5]${NC} Creating config..."
if [ ! -f config.json ]; then
    cp config.example.json config.json
    echo -e "${GREEN}✓${NC} config.json created"
    echo -e "${YELLOW}!${NC} Edit config.json to customize settings"
else
    echo -e "${GREEN}✓${NC} config.json already exists"
fi

# Done
echo ""
echo -e "${YELLOW}[5/5]${NC} Installation complete!"
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                                                            ║"
echo "║   🎉 Installation Complete!                                ║"
echo "║                                                            ║"
echo "║   Start the server:                                        ║"
echo "║     npm start                                              ║"
echo "║                                                            ║"
echo "║   Then open:                                               ║"
echo "║     http://localhost:3000                                  ║"
echo "║                                                            ║"
echo "║   For Discord notifications:                               ║"
echo "║     Edit config.json and add your webhook URL              ║"
echo "║                                                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
