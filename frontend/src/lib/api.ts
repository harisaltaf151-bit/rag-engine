const BASE = '/api/backend'

export interface DocMeta {
  doc_id: string
  filename: string
  size: number
  chunk_count: number
  preview: string
}

export interface Source {
  filename: string
  score: number
  v_score: number
  k_score: number
  preview: string
  index: number
}

export interface QueryResponse {
  answer: string
  sources: Source[]
}

export interface ProviderModel {
  value: string
  label: string
}

export interface ProviderInfo {
  name: string
  type: string
  models: ProviderModel[]
  default_model: string
  key_prefix: string
  key_hint: string
}

export interface ProvidersResponse {
  providers: Record<string, ProviderInfo>
}

export async function fetchProviders(): Promise<ProvidersResponse> {
  const r = await fetch(`${BASE}/providers`)
  if (!r.ok) throw new Error('Failed to load providers')
  return r.json()
}

export async function testConnection(params: {
  provider: string
  api_key: string
  model: string
}): Promise<{ status: string; provider: string; model: string; response: string }> {
  const r = await fetch(`${BASE}/test-connection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || `Connection test failed (${r.status})`)
  }
  return r.json()
}

export async function uploadDoc(file: File): Promise<DocMeta> {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${BASE}/upload`, { method: 'POST', body: fd })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || `Upload failed (${r.status})`)
  }
  return r.json()
}

export async function deleteDoc(docId: string): Promise<void> {
  await fetch(`${BASE}/document/${docId}`, { method: 'DELETE' })
}

export async function listDocs(): Promise<{ documents: DocMeta[]; total_chunks: number }> {
  const r = await fetch(`${BASE}/documents`)
  return r.json()
}

export async function queryDocs(params: {
  query: string
  top_k: number
  provider: string
  model: string
  api_key: string
  history: { role: string; content: string }[]
}): Promise<QueryResponse> {
  const r = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, stream: false }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.detail || `Query failed (${r.status})`)
  }
  return r.json()
}

export async function* queryStream(params: {
  query: string
  top_k: number
  provider: string
  model: string
  api_key: string
  history: { role: string; content: string }[]
}): AsyncGenerator<{ type: string; content?: string; sources?: Source[] }> {
  const r = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, stream: true }),
  })
  if (!r.ok) throw new Error(`Query failed (${r.status})`)
  const reader = r.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        yield JSON.parse(trimmed)
      } catch {
        // skip malformed chunks
      }
    }
  }
}
