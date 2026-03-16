#!/bin/bash
# ================================================================
#  Employee Monitor Desktop App — Setup Script
#  Run: chmod +x setup.sh && ./setup.sh
# ================================================================

echo ""
echo "=================================================="
echo "  Employee Monitor — Desktop App Setup"
echo "=================================================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌  Node.js not found. Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌  Node.js 18+ required. Current: $(node -v)"
    exit 1
fi

echo "✓  Node.js $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌  npm not found."
    exit 1
fi
echo "✓  npm $(npm -v)"

# Install dependencies
echo ""
echo "[1/3] Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌  npm install failed"
    exit 1
fi
echo "✓  Dependencies installed"

# Build TypeScript
echo ""
echo "[2/3] Building TypeScript..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌  TypeScript build failed"
    exit 1
fi
echo "✓  TypeScript compiled"

echo ""
echo "[3/3] Ready!"
echo ""
echo "=================================================="
echo "  ✅  Setup complete!"
echo "=================================================="
echo ""
echo "  Make sure your backend is running:"
echo "    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
echo ""
echo "  Then start the desktop app:"
echo "    npm start"
echo ""
echo "  Or for development with hot reload:"
echo "    npm run dev"
echo ""
echo "  Default login:"
echo "    Employee:  alice@company.com / Employee@123"
echo "    Admin:     admin@company.com / Admin@123456"
echo "=================================================="