# 🔍 RAGEngine — Knowledge Intelligence Platform

> Chat with any document using **Hybrid RAG** (vector + keyword) + **Groq LLM**

Built with: **Next.js 15** · **FastAPI** · **Groq API** · **Pure Python hybrid search** (no external vector DB required)

---

## ⚡ Quick Start (1 command)

```bash
bash start.sh
```

Then open **http://localhost:3000**

---

## 📁 Project Structure

```
rag-engine/
├── start.sh                  ← One-command launcher
├── backend/
│   ├── main.py               ← FastAPI app (upload, retrieval, Groq LLM)
│   ├── requirements.txt
│   └── .env.example          ← Copy to .env, add your Groq key
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx      ← Full chat UI
    │   │   ├── layout.tsx
    │   │   └── globals.css
    │   └── lib/
    │       └── api.ts        ← Backend API client
    ├── next.config.js        ← Proxies /api/backend/* → :8000
    └── package.json
```

---

## 🛠 Manual Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- A free Groq API key from [console.groq.com](https://console.groq.com)

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate       # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env           # optionally set GROQ_API_KEY here
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## 🔑 Groq API Key

1. Go to [console.groq.com](https://console.groq.com) → Create free account
2. API Keys → Create New Key (starts with `gsk_...`)
3. In the app: click **"Set API Key"** button → paste your key → Save

Your key stays in `sessionStorage` — it never leaves your browser except when calling Groq directly.

---

## 🏗 Architecture

```
User Query
    │
    ▼
Next.js Frontend (port 3000)
    │  POST /api/backend/query
    ▼
FastAPI Backend (port 8000)
    │
    ├─ 1. Extract & chunk uploaded docs
    │       └─ PDF (pypdf) / DOCX / CSV / TXT / MD
    │
    ├─ 2. Hybrid Retrieval
    │       ├─ TF-IDF vector similarity (cosine)
    │       └─ BM25 keyword scoring
    │       └─ Weighted fusion: α·vector + (1-α)·BM25
    │
    ├─ 3. Context assembly → system prompt
    │       └─ [Source N | filename | chunk idx] format
    │
    └─ 4. Groq LLM (streaming or batch)
            └─ Returns cited answer → frontend
```

---

## 📡 API Reference

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Backend health check |
| POST | `/upload` | Upload a document (multipart) |
| GET | `/documents` | List all documents + chunk counts |
| DELETE | `/document/{doc_id}` | Remove a document |
| POST | `/query` | RAG query (supports `stream: true`) |

**Interactive API docs:** http://localhost:8000/docs

---

## 🔧 Configuration

| Option | Default | Description |
|--------|---------|-------------|
| Model | `llama-3.1-70b-versatile` | Any Groq-supported model |
| Top-K | 4 | Chunks to retrieve per query |
| Hybrid Search | ON | Vector + BM25 fusion |
| Streaming | OFF | Real-time token streaming |
| Chunk size | 500 chars | Edit `CHUNK_SIZE` in main.py |
| Chunk overlap | 80 chars | Edit `CHUNK_OVERLAP` in main.py |

---

## 🚀 Supported Models (Groq)

| Model ID | Speed | Context |
|----------|-------|---------|
| `llama-3.1-8b-instant` | ⚡⚡⚡ Very fast | 128k |
| `llama-3.1-70b-versatile` | ⚡⚡ Fast | 128k |
| `mixtral-8x7b-32768` | ⚡⚡ Fast | 32k |
| `gemma2-9b-it` | ⚡⚡⚡ Fast | 8k |

---

## 📦 Production Upgrades

To go production-grade, swap these components:

| Component | Current | Production |
|-----------|---------|------------|
| Vector store | In-memory TF-IDF | Qdrant / Pinecone / pgvector |
| Document store | Python dict | PostgreSQL |
| Auth | None | NextAuth.js / Clerk |
| File storage | Memory | S3 / Cloudflare R2 |
| Embeddings | TF-IDF | `sentence-transformers` / OpenAI |

---

## 🐛 Troubleshooting

**Backend not starting?**
```bash
# Make sure port 8000 is free
lsof -i :8000
# Then: kill -9 <PID>
```

**`Module not found` errors?**
```bash
cd backend && source venv/bin/activate && pip install -r requirements.txt
```

**CORS errors in browser?**
- Make sure backend is on `:8000` and frontend on `:3000`
- The `next.config.js` proxy handles this automatically

**Groq API errors?**
- Check your key starts with `gsk_`
- Free tier: 14,400 requests/day, 30 req/min
