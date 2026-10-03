"""
RAG-Powered Knowledge Engine — FastAPI Backend
Hybrid search (vector + keyword) with multi-provider LLM support
Supports: OpenAI, Anthropic/Claude, Google Gemini, Groq, DeepSeek, OpenRouter
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os, io, json, re, math
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="RAGEngine API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Provider configuration ──────────────────────────────────────────────────

PROVIDERS = {
    "openai": {
        "name": "OpenAI",
        "type": "openai-compatible",
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "models": [
            {"value": "gpt-4o", "label": "GPT-4o"},
            {"value": "gpt-4o-mini", "label": "GPT-4o Mini"},
            {"value": "gpt-4-turbo", "label": "GPT-4 Turbo"},
            {"value": "gpt-3.5-turbo", "label": "GPT-3.5 Turbo"},
        ],
        "default_model": "gpt-4o-mini",
        "key_prefix": "sk-",
        "key_hint": "Starts with sk-…",
    },
    "anthropic": {
        "name": "Anthropic / Claude",
        "type": "anthropic",
        "endpoint": "https://api.anthropic.com/v1/messages",
        "models": [
            {"value": "claude-sonnet-4-20250514", "label": "Claude Sonnet 4"},
            {"value": "claude-haiku-4-20250414", "label": "Claude Haiku 4"},
            {"value": "claude-3-5-sonnet-20241022", "label": "Claude 3.5 Sonnet"},
        ],
        "default_model": "claude-sonnet-4-20250514",
        "key_prefix": "sk-ant-",
        "key_hint": "Starts with sk-ant-…",
    },
    "gemini": {
        "name": "Google Gemini",
        "type": "gemini",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta",
        "models": [
            {"value": "gemini-2.0-flash", "label": "Gemini 2.0 Flash"},
            {"value": "gemini-1.5-pro", "label": "Gemini 1.5 Pro"},
            {"value": "gemini-1.5-flash", "label": "Gemini 1.5 Flash"},
        ],
        "default_model": "gemini-2.0-flash",
        "key_prefix": "AIza",
        "key_hint": "Starts with AIza…",
    },
    "groq": {
        "name": "Groq",
        "type": "openai-compatible",
        "endpoint": "https://api.groq.com/openai/v1/chat/completions",
        "models": [
            {"value": "llama-3.1-70b-versatile", "label": "LLaMA 3.1 70B"},
            {"value": "llama-3.1-8b-instant", "label": "LLaMA 3.1 8B"},
            {"value": "mixtral-8x7b-32768", "label": "Mixtral 8x7B"},
            {"value": "gemma2-9b-it", "label": "Gemma 2 9B"},
        ],
        "default_model": "llama-3.1-70b-versatile",
        "key_prefix": "gsk_",
        "key_hint": "Starts with gsk_…",
    },
    "deepseek": {
        "name": "DeepSeek",
        "type": "openai-compatible",
        "endpoint": "https://api.deepseek.com/chat/completions",
        "models": [
            {"value": "deepseek-chat", "label": "DeepSeek Chat (V3)"},
            {"value": "deepseek-reasoner", "label": "DeepSeek Reasoner (R1)"},
        ],
        "default_model": "deepseek-chat",
        "key_prefix": "sk-",
        "key_hint": "Starts with sk-…",
    },
    "openrouter": {
        "name": "OpenRouter",
        "type": "openai-compatible",
        "endpoint": "https://openrouter.ai/api/v1/chat/completions",
        "models": [
            {"value": "openai/gpt-4o", "label": "GPT-4o (via OpenRouter)"},
            {"value": "anthropic/claude-sonnet-4", "label": "Claude Sonnet 4 (via OpenRouter)"},
            {"value": "google/gemini-2.0-flash-001", "label": "Gemini 2.0 Flash (via OpenRouter)"},
            {"value": "meta-llama/llama-3.1-70b-instruct", "label": "LLaMA 3.1 70B (via OpenRouter)"},
            {"value": "deepseek/deepseek-chat", "label": "DeepSeek V3 (via OpenRouter)"},
        ],
        "default_model": "openai/gpt-4o",
        "key_prefix": "sk-or-",
        "key_hint": "Starts with sk-or-…",
    },
}

# ─── In-memory document store ────────────────────────────────────────────────

documents: dict[str, dict] = {}
chunks_store: list[dict] = []

CHUNK_SIZE = 500
CHUNK_OVERLAP = 80


# ─── Text extraction ─────────────────────────────────────────────────────────

def extract_text(file_bytes: bytes, filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()

    if ext == "pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            return "\n\n".join(p.extract_text() or "" for p in reader.pages)
        except ImportError:
            return file_bytes.decode("utf-8", errors="ignore")

    if ext == "docx":
        try:
            import docx
            doc = docx.Document(io.BytesIO(file_bytes))
            return "\n".join(p.text for p in doc.paragraphs)
        except ImportError:
            return file_bytes.decode("utf-8", errors="ignore")

    if ext == "csv":
        import csv
        lines = file_bytes.decode("utf-8", errors="ignore").splitlines()
        reader = csv.reader(lines)
        return "\n".join(", ".join(row) for row in reader)

    return file_bytes.decode("utf-8", errors="ignore")


# ─── Chunking ─────────────────────────────────────────────────────────────────

def chunk_text(text: str, doc_id: str, filename: str) -> list[dict]:
    char_chunks = []
    i = 0
    while i < len(text):
        char_chunks.append(text[i : i + CHUNK_SIZE])
        i += CHUNK_SIZE - CHUNK_OVERLAP

    return [
        {
            "chunk_id": f"{doc_id}_c{idx}",
            "doc_id": doc_id,
            "filename": filename,
            "text": chunk.strip(),
            "index": idx,
        }
        for idx, chunk in enumerate(char_chunks)
        if chunk.strip()
    ]


# ─── Simple TF-IDF vectorizer ────────────────────────────────────────────────

def tokenize(text: str) -> list[str]:
    return re.findall(r"\b[a-z]{2,}\b", text.lower())

def build_tfidf(chunks: list[dict]):
    df: dict[str, int] = {}
    for c in chunks:
        terms = set(tokenize(c["text"]))
        for t in terms:
            df[t] = df.get(t, 0) + 1

    N = len(chunks)
    for c in chunks:
        tokens = tokenize(c["text"])
        tf: dict[str, float] = {}
        for t in tokens:
            tf[t] = tf.get(t, 0) + 1
        total = max(len(tokens), 1)
        c["vector"] = {
            t: (freq / total) * math.log((N + 1) / (df.get(t, 0) + 1))
            for t, freq in tf.items()
        }

def cosine_sim(v1: dict, v2: dict) -> float:
    keys = set(v1) & set(v2)
    if not keys:
        return 0.0
    dot = sum(v1[k] * v2[k] for k in keys)
    mag1 = math.sqrt(sum(x**2 for x in v1.values()))
    mag2 = math.sqrt(sum(x**2 for x in v2.values()))
    return dot / (mag1 * mag2 + 1e-9)

def bm25_score(query_terms: list[str], chunk: dict, avg_len: float, k1=1.5, b=0.75) -> float:
    text = chunk["text"].lower()
    doc_len = len(text.split())
    score = 0.0
    N = len(chunks_store)
    for term in query_terms:
        tf = text.count(term)
        df = sum(1 for c in chunks_store if term in c["text"].lower())
        if tf == 0 or df == 0:
            continue
        idf = math.log((N - df + 0.5) / (df + 0.5) + 1)
        tf_norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / (avg_len + 1e-9)))
        score += idf * tf_norm
    return score


# ─── Hybrid retrieval ─────────────────────────────────────────────────────────

def hybrid_retrieve(query: str, top_k: int = 4, alpha: float = 0.5) -> list[dict]:
    if not chunks_store:
        return []

    query_tokens = tokenize(query)
    avg_len = sum(len(c["text"].split()) for c in chunks_store) / len(chunks_store)

    query_tf: dict[str, float] = {}
    for t in query_tokens:
        query_tf[t] = query_tf.get(t, 0) + 1
    total = max(len(query_tokens), 1)
    query_vec = {t: f / total for t, f in query_tf.items()}

    results = []
    for chunk in chunks_store:
        v_score = cosine_sim(query_vec, chunk.get("vector", {}))
        k_score = bm25_score(query_tokens, chunk, avg_len)
        k_norm = min(k_score / 10.0, 1.0)
        combined = alpha * v_score + (1 - alpha) * k_norm
        results.append({**chunk, "score": combined, "v_score": v_score, "k_score": k_norm})

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


# ─── Provider error handling ─────────────────────────────────────────────────

def parse_provider_error(provider_id: str, status_code: int, body: bytes) -> str:
    try:
        data = json.loads(body.decode())
    except Exception:
        return f"Provider returned status {status_code}"

    provider = PROVIDERS.get(provider_id, {})
    provider_name = provider.get("name", provider_id)

    error = data.get("error", {})
    if isinstance(error, dict):
        msg = error.get("message", "")
    else:
        msg = str(error)
    if not msg:
        msg = data.get("message", "")

    if status_code == 401:
        return f"Invalid API key for {provider_name}. Please check your key and try again."
    if status_code == 403:
        return f"Access denied. Your {provider_name} API key may not have permission for this model."
    if status_code == 404:
        return f"Model not found on {provider_name}. The selected model may not be available. ({msg})"
    if status_code == 429:
        return f"Rate limit exceeded on {provider_name}. Please wait a moment and try again."
    if status_code == 400:
        if "model" in msg.lower():
            return f"The selected model is not available for {provider_name}. Please choose another model. ({msg})"
        return f"Invalid request to {provider_name}: {msg}"
    if status_code >= 500:
        return f"{provider_name} is temporarily unavailable. Please try again later."
    if any(w in msg.lower() for w in ("insufficient", "quota", "credit", "billing")):
        return f"Insufficient credits or quota exceeded on {provider_name}. ({msg})"

    return f"{provider_name} error ({status_code}): {msg}" if msg else f"{provider_name} returned status {status_code}"


# ─── LLM Adapters ────────────────────────────────────────────────────────────

async def call_openai_compatible(messages: list[dict], model: str, api_key: str,
                                  endpoint: str, provider_id: str, stream: bool = False):
    import httpx
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1024,
        "stream": stream,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider_id == "openrouter":
        headers["HTTP-Referer"] = "http://localhost:3000"

    async with httpx.AsyncClient(timeout=60) as client:
        if stream:
            async with client.stream("POST", endpoint, json=payload, headers=headers) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise HTTPException(resp.status_code, parse_provider_error(provider_id, resp.status_code, body))
                async for line in resp.aiter_lines():
                    if line.startswith("data: ") and line.strip() != "data: [DONE]":
                        try:
                            chunk = json.loads(line[6:])
                            delta = chunk["choices"][0]["delta"].get("content", "")
                            if delta:
                                yield delta
                        except Exception:
                            pass
        else:
            resp = await client.post(endpoint, json=payload, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(resp.status_code, parse_provider_error(provider_id, resp.status_code, resp.content))
            yield resp.json()["choices"][0]["message"]["content"]


async def call_anthropic(messages: list[dict], model: str, api_key: str, stream: bool = False):
    import httpx
    system_parts = []
    chat_messages = []
    for m in messages:
        if m["role"] == "system":
            system_parts.append(m["content"])
        else:
            chat_messages.append({"role": m["role"], "content": m["content"]})

    payload = {
        "model": model,
        "max_tokens": 1024,
        "temperature": 0.2,
        "messages": chat_messages,
    }
    if stream:
        payload["stream"] = True
    if system_parts:
        payload["system"] = "\n\n".join(system_parts)

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    endpoint = "https://api.anthropic.com/v1/messages"

    async with httpx.AsyncClient(timeout=60) as client:
        if stream:
            async with client.stream("POST", endpoint, json=payload, headers=headers) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise HTTPException(resp.status_code, parse_provider_error("anthropic", resp.status_code, body))
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            if data.get("type") == "content_block_delta":
                                text = data.get("delta", {}).get("text", "")
                                if text:
                                    yield text
                        except Exception:
                            pass
        else:
            resp = await client.post(endpoint, json=payload, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(resp.status_code, parse_provider_error("anthropic", resp.status_code, resp.content))
            data = resp.json()
            text = ""
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text += block["text"]
            yield text


async def call_gemini(messages: list[dict], model: str, api_key: str, stream: bool = False):
    import httpx
    system_text = ""
    contents = []
    for m in messages:
        if m["role"] == "system":
            system_text += m["content"] + "\n"
        else:
            role = "model" if m["role"] == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": m["content"]}]})

    payload = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 1024,
        },
    }
    if system_text.strip():
        payload["systemInstruction"] = {"parts": [{"text": system_text.strip()}]}

    base = "https://generativelanguage.googleapis.com/v1beta"
    if stream:
        url = f"{base}/models/{model}:streamGenerateContent?alt=sse&key={api_key}"
    else:
        url = f"{base}/models/{model}:generateContent?key={api_key}"

    headers = {"Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=60) as client:
        if stream:
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise HTTPException(resp.status_code, parse_provider_error("gemini", resp.status_code, body))
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            parts = (data.get("candidates", [{}])[0]
                                        .get("content", {})
                                        .get("parts", []))
                            for part in parts:
                                text = part.get("text", "")
                                if text:
                                    yield text
                        except Exception:
                            pass
        else:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(resp.status_code, parse_provider_error("gemini", resp.status_code, resp.content))
            data = resp.json()
            parts = (data.get("candidates", [{}])[0]
                        .get("content", {})
                        .get("parts", []))
            yield "".join(p.get("text", "") for p in parts)


async def call_llm(messages: list[dict], model: str, api_key: str,
                    provider_id: str, stream: bool = False):
    provider = PROVIDERS.get(provider_id)
    if not provider:
        raise HTTPException(400, f"Unknown provider: {provider_id}")

    ptype = provider["type"]

    if ptype == "openai-compatible":
        async for chunk in call_openai_compatible(
            messages, model, api_key, provider["endpoint"], provider_id, stream
        ):
            yield chunk
    elif ptype == "anthropic":
        async for chunk in call_anthropic(messages, model, api_key, stream):
            yield chunk
    elif ptype == "gemini":
        async for chunk in call_gemini(messages, model, api_key, stream):
            yield chunk
    else:
        raise HTTPException(400, f"Unsupported provider type: {ptype}")


def build_system_prompt(context_chunks: list[dict]) -> str:
    context = "\n\n---\n\n".join(
        f"[Source {i+1} | {c['filename']} | chunk {c['index']}]\n{c['text']}"
        for i, c in enumerate(context_chunks)
    )
    return f"""You are RAGEngine, a precise document Q&A assistant.
Answer ONLY using the retrieved context below. Cite every factual claim inline with [Source N].
If the answer isn't in the context, say: "I couldn't find this in the uploaded documents."
Be concise, structured, and accurate.

Retrieved Context:
{context}"""


# ─── API Routes ───────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "docs": len(documents), "chunks": len(chunks_store)}


@app.get("/providers")
def get_providers():
    return {
        "providers": {
            pid: {
                "name": p["name"],
                "type": p["type"],
                "models": p["models"],
                "default_model": p["default_model"],
                "key_prefix": p.get("key_prefix", ""),
                "key_hint": p.get("key_hint", ""),
            }
            for pid, p in PROVIDERS.items()
        }
    }


class TestConnectionRequest(BaseModel):
    provider: str
    api_key: str
    model: str


@app.post("/test-connection")
async def test_connection(req: TestConnectionRequest):
    provider = PROVIDERS.get(req.provider)
    if not provider:
        raise HTTPException(400, f"Unknown provider: {req.provider}")

    valid_models = [m["value"] for m in provider["models"]]
    if req.model not in valid_models:
        raise HTTPException(
            400,
            f"Model '{req.model}' is not available for {provider['name']}. "
            f"Available models: {', '.join(m['label'] for m in provider['models'])}"
        )

    messages = [{"role": "user", "content": "Say OK"}]
    try:
        response = ""
        async for chunk in call_llm(messages, req.model, req.api_key, req.provider, stream=False):
            response = chunk
        return {"status": "ok", "provider": provider["name"], "model": req.model, "response": response[:50]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Connection test failed: {str(e)}")


@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 20MB)")

    doc_id = re.sub(r"[^a-zA-Z0-9_]", "_", file.filename) + f"_{len(documents)}"
    text = extract_text(content, file.filename)

    if not text.strip():
        raise HTTPException(400, "Could not extract text from this file")

    new_chunks = chunk_text(text, doc_id, file.filename)
    build_tfidf(new_chunks)

    documents[doc_id] = {
        "doc_id": doc_id,
        "filename": file.filename,
        "size": len(content),
        "chunk_count": len(new_chunks),
        "preview": text[:200],
    }
    chunks_store.extend(new_chunks)

    return {
        "doc_id": doc_id,
        "filename": file.filename,
        "chunks": len(new_chunks),
        "preview": text[:200],
    }


@app.delete("/document/{doc_id}")
def delete_document(doc_id: str):
    if doc_id not in documents:
        raise HTTPException(404, "Document not found")
    documents.pop(doc_id)
    global chunks_store
    chunks_store = [c for c in chunks_store if c["doc_id"] != doc_id]
    return {"deleted": doc_id}


@app.get("/documents")
def list_documents():
    return {"documents": list(documents.values()), "total_chunks": len(chunks_store)}


class QueryRequest(BaseModel):
    query: str
    top_k: int = 4
    provider: str = "groq"
    model: str = "llama-3.1-70b-versatile"
    api_key: str
    history: list[dict] = []
    stream: bool = False


@app.post("/query")
async def query(req: QueryRequest):
    if not req.query.strip():
        raise HTTPException(400, "Query cannot be empty")
    if not req.api_key:
        raise HTTPException(400, "API key required")
    if not chunks_store:
        raise HTTPException(400, "No documents uploaded yet")

    provider = PROVIDERS.get(req.provider)
    if not provider:
        raise HTTPException(400, f"Unknown provider: {req.provider}. Available: {', '.join(PROVIDERS.keys())}")

    retrieved = hybrid_retrieve(req.query, top_k=req.top_k)
    system_prompt = build_system_prompt(retrieved)

    messages = [{"role": "system", "content": system_prompt}]
    for m in req.history[-6:]:
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": req.query})

    source_data = [
        {
            "filename": c["filename"],
            "score": round(c["score"], 3),
            "v_score": round(c["v_score"], 3),
            "k_score": round(c["k_score"], 3),
            "preview": c["text"][:120],
            "index": c["index"],
        }
        for c in retrieved
    ]

    if req.stream:
        async def streamer():
            yield json.dumps({"type": "sources", "sources": source_data}) + "\n"
            try:
                async for token in call_llm(messages, req.model, req.api_key, req.provider, stream=True):
                    yield json.dumps({"type": "token", "content": token}) + "\n"
                yield json.dumps({"type": "done"}) + "\n"
            except HTTPException as e:
                yield json.dumps({"type": "error", "content": e.detail}) + "\n"
            except Exception as e:
                yield json.dumps({"type": "error", "content": str(e)}) + "\n"

        return StreamingResponse(streamer(), media_type="application/x-ndjson")

    answer = ""
    async for chunk in call_llm(messages, req.model, req.api_key, req.provider, stream=False):
        answer = chunk

    return {"answer": answer, "sources": source_data}
