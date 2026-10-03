#!/bin/bash
# ─── RAGEngine — One-command startup ──────────────────────────────────────────
# Run: bash start.sh

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ██████╗  █████╗  ██████╗ ███████╗███╗   ██╗ ██████╗ ██╗███╗   ██╗███████╗"
echo "  ██╔══██╗██╔══██╗██╔════╝ ██╔════╝████╗  ██║██╔════╝ ██║████╗  ██║██╔════╝"
echo "  ██████╔╝███████║██║  ███╗█████╗  ██╔██╗ ██║██║  ███╗██║██╔██╗ ██║█████╗  "
echo "  ██╔══██╗██╔══██║██║   ██║██╔══╝  ██║╚██╗██║██║   ██║██║██║╚██╗██║██╔══╝  "
echo "  ██║  ██║██║  ██║╚██████╔╝███████╗██║ ╚████║╚██████╔╝██║██║ ╚████║███████╗"
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝╚═╝  ╚═══╝╚══════╝"
echo -e "${NC}"
echo -e "  ${YELLOW}RAG-Powered Knowledge Engine${NC}"
echo ""

# ── Backend ────────────────────────────────────────────────────────────────────
echo -e "${GREEN}[1/4]${NC} Setting up Python backend..."
cd "$BACKEND"

if [ ! -d "venv" ]; then
  python3 -m venv venv
  echo "  ✓ Virtual environment created"
fi

source venv/bin/activate
pip install -q -r requirements.txt
echo "  ✓ Dependencies installed"

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo -e "  ${YELLOW}⚠ Created .env — optionally add GROQ_API_KEY there${NC}"
fi

echo -e "${GREEN}[2/4]${NC} Starting FastAPI backend on :8000..."
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "  ✓ Backend PID: $BACKEND_PID"

# Wait for backend to be ready
echo "  Waiting for backend..."
for i in {1..15}; do
  if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "  ✓ Backend healthy"
    break
  fi
  sleep 1
done

deactivate

# ── Frontend ───────────────────────────────────────────────────────────────────
echo -e "${GREEN}[3/4]${NC} Setting up Next.js frontend..."
cd "$FRONTEND"

if [ ! -d "node_modules" ]; then
  npm install --silent
  echo "  ✓ Node modules installed"
fi

echo -e "${GREEN}[4/4]${NC} Starting Next.js on :3000..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo -e "  ${GREEN}✅ RAGEngine is running!${NC}"
echo ""
echo -e "  ${CYAN}→ App:     http://localhost:3000${NC}"
echo -e "  ${CYAN}→ API:     http://localhost:8000${NC}"
echo -e "  ${CYAN}→ API Docs: http://localhost:8000/docs${NC}"
echo ""
echo "  Press Ctrl+C to stop both servers"
echo ""

# Cleanup on exit
cleanup() {
  echo ""
  echo "Stopping servers..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  echo "Done."
}
trap cleanup INT TERM

wait
