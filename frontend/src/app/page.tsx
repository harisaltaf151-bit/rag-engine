'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Upload, Trash2, Send, Key, ChevronDown, FileText,
  Zap, BookOpen, Settings, CheckCircle, Circle, AlertCircle,
  Database, Cpu, Layers, Search, Sparkles, X, Shield, RefreshCw
} from 'lucide-react'
import {
  uploadDoc, deleteDoc, queryDocs, queryStream,
  fetchProviders, testConnection,
  DocMeta, Source, ProviderInfo
} from '@/lib/api'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  pipeline?: PipelineState
  streaming?: boolean
}

interface PipelineState {
  embed: 'idle' | 'active' | 'done'
  retrieve: 'idle' | 'active' | 'done'
  rerank: 'idle' | 'active' | 'done'
  generate: 'idle' | 'active' | 'done'
}

const STEPS: (keyof PipelineState)[] = ['embed', 'retrieve', 'rerank', 'generate']

const STEP_ICONS = {
  embed:    <Layers size={10} />,
  retrieve: <Search size={10} />,
  rerank:   <Zap size={10} />,
  generate: <Sparkles size={10} />,
}

const PROVIDER_COLORS: Record<string, string> = {
  openai:     '#10a37f',
  anthropic:  '#d97757',
  gemini:     '#4285f4',
  groq:       '#f55036',
  deepseek:   '#536dfe',
  openrouter: '#c084fc',
}

function extColor(ext: string) {
  const map: Record<string, string> = {
    pdf: '#ff6b6b', md: '#b47cff', txt: '#2dd4a0', csv: '#f0a73a', docx: '#4f8eff',
  }
  return map[ext] ?? '#7c8299'
}

function renderAnswer(text: string) {
  if (!text || typeof text !== 'string') return ''
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[Source (\d+)\]/g, '<span class="cite">[S$1]</span>')
    .split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('')
}

function detectProvider(key: string, providers: Record<string, ProviderInfo>): string | null {
  if (!key || key.length < 8) return null
  if (key.startsWith('sk-ant-')) return 'anthropic'
  if (key.startsWith('sk-or-')) return 'openrouter'
  if (key.startsWith('gsk_')) return 'groq'
  if (key.startsWith('AIza')) return 'gemini'
  return null
}

// ── Pipeline bar ────────────────────────────────────────────────────────────
function Pipeline({ state }: { state: PipelineState }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      padding: '8px 12px', background: 'var(--bg3)',
      borderRadius: 6, border: '1px solid var(--border)', marginBottom: 8
    }}>
      {STEPS.map((step, i) => (
        <span key={step} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span className={`pipeline-step ${state[step]}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {STEP_ICONS[step]}{step}
          </span>
          {i < STEPS.length - 1 && <span style={{ color: 'var(--text3)', fontSize: 10 }}>›</span>}
        </span>
      ))}
    </div>
  )
}

// ── Source cards ─────────────────────────────────────────────────────────────
function SourceCards({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
        color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: 'DM Mono, monospace', marginBottom: open ? 8 : 0, letterSpacing: '0.03em'
      }}>
        <BookOpen size={11} />
        {sources.length} source{sources.length !== 1 ? 's' : ''} retrieved
        <ChevronDown size={10} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
      </button>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {sources.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 10px', borderRadius: 5,
              background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: 11
            }}>
              <span style={{ color: 'var(--text3)', fontFamily: 'DM Mono,monospace', fontSize: 9, letterSpacing: '0.05em' }}>S{i+1}</span>
              <span style={{ color: 'var(--text2)' }}>{s.filename}</span>
              <span className="tag" style={{ fontSize: 9 }}>{Math.round(s.score * 100)}%</span>
            </div>
          ))}
        </div>
      )}
      {open && sources[0] && (
        <div style={{
          marginTop: 8, padding: '10px 12px', borderRadius: 6,
          background: 'var(--bg3)', border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text2)', lineHeight: 1.65
        }}>
          <span style={{ color: 'var(--text3)', fontFamily: 'DM Mono,monospace', fontSize: 9, letterSpacing: '0.05em', textTransform: 'uppercase' }}>top chunk</span><br/>
          <span style={{ marginTop: 4, display: 'block' }}>{sources[0].preview}…</span>
        </div>
      )}
    </div>
  )
}

// ── Thinking ─────────────────────────────────────────────────────────────────
function Thinking({ pipeline }: { pipeline: PipelineState }) {
  return (
    <div className="fade-up" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{
        width: 30, height: 30, borderRadius: 6, flexShrink: 0,
        background: 'linear-gradient(135deg, #4f8eff22, #7b5cff22)',
        border: '1px solid rgba(79,142,255,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        <Cpu size={14} style={{ color: 'var(--accent)' }} />
      </div>
      <div style={{ maxWidth: '75%' }}>
        <Pipeline state={pipeline} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', borderRadius: 8,
          background: 'var(--bg2)', border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text3)'
        }}>
          <span className="dot" style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
          <span className="dot" style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
          <span className="dot" style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
          <span style={{ marginLeft: 2 }}>Retrieving context…</span>
        </div>
      </div>
    </div>
  )
}

// ── Logo mark ─────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 7, flexShrink: 0, position: 'relative',
      background: 'linear-gradient(135deg, #0d1628, #151d35)',
      border: '1px solid rgba(79,142,255,0.25)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 0 20px rgba(79,142,255,0.12)'
    }}>
      <Database size={14} style={{ color: 'var(--accent)' }} />
    </div>
  )
}

// ── Stat box ──────────────────────────────────────────────────────────────────
function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      background: 'var(--bg3)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 12px', textAlign: 'center'
    }}>
      <div className="font-display" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
        {isNaN(value) ? 0 : value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  // Provider state
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({})
  const [selectedProvider, setSelectedProvider] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [connected, setConnected] = useState(false)

  // Setup modal
  const [showSetup, setShowSetup] = useState(true)
  const [setupProvider, setSetupProvider] = useState('')
  const [setupKey, setSetupKey] = useState('')
  const [setupModel, setSetupModel] = useState('')
  const [setupTesting, setSetupTesting] = useState(false)
  const [setupError, setSetupError] = useState('')
  const [setupSuccess, setSetupSuccess] = useState('')
  const [autoDetected, setAutoDetected] = useState('')

  // Settings panel
  const [showSettings, setShowSettings] = useState(false)
  const [settingsProvider, setSettingsProvider] = useState('')
  const [settingsKey, setSettingsKey] = useState('')
  const [settingsModel, setSettingsModel] = useState('')
  const [settingsTesting, setSettingsTesting] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsSuccess, setSettingsSuccess] = useState('')

  // Other
  const [topK, setTopK] = useState(4)
  const [streaming, setStreaming] = useState(false)
  const [hybrid, setHybrid] = useState(true)
  const [status, setStatus] = useState('Ready')
  const [uploading, setUploading] = useState(false)
  const [queryCount, setQueryCount] = useState(0)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [thinkingPipeline, setThinkingPipeline] = useState<PipelineState | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const messagesEnd = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/backend/health')
      .then(r => r.ok ? setBackendOk(true) : setBackendOk(false))
      .catch(() => setBackendOk(false))

    fetchProviders()
      .then(data => {
        setProviders(data.providers)
        const saved = sessionStorage.getItem('rag_provider_config')
        if (saved) {
          try {
            const cfg = JSON.parse(saved)
            if (cfg.provider && cfg.apiKey && cfg.model && data.providers[cfg.provider]) {
              setSelectedProvider(cfg.provider)
              setApiKey(cfg.apiKey)
              setModel(cfg.model)
              setConnected(true)
              setShowSetup(false)
            }
          } catch {}
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinkingPipeline])

  // Auto-detect provider when key changes in setup
  useEffect(() => {
    if (!setupKey || Object.keys(providers).length === 0) {
      setAutoDetected('')
      return
    }
    const detected = detectProvider(setupKey, providers)
    if (detected && providers[detected]) {
      setAutoDetected(detected)
      if (!setupProvider) {
        setSetupProvider(detected)
        setSetupModel(providers[detected].default_model)
      }
    } else {
      setAutoDetected('')
    }
  }, [setupKey, providers, setupProvider])

  async function animatePipeline(updateFn: (p: PipelineState) => void, delays = [300, 280, 280, 200]) {
    const state: PipelineState = { embed: 'idle', retrieve: 'idle', rerank: 'idle', generate: 'idle' }
    for (let i = 0; i < STEPS.length; i++) {
      state[STEPS[i]] = 'active'
      updateFn({ ...state })
      await new Promise(r => setTimeout(r, delays[i]))
      state[STEPS[i]] = 'done'
      updateFn({ ...state })
    }
    return state
  }

  const setTempStatus = (s: string, ms = 3000) => {
    setStatus(s)
    setTimeout(() => setStatus('Ready'), ms)
  }

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    for (const file of Array.from(files)) {
      try {
        const doc = await uploadDoc(file)
        setDocs(prev => [...prev, doc])
        setTempStatus(`Uploaded: ${file.name}`)
      } catch (e: any) {
        setTempStatus(`Error: ${e.message}`)
      }
    }
    setUploading(false)
  }, [])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  async function handleSetupTest() {
    if (!setupProvider || !setupKey || !setupModel) {
      setSetupError('Please select a provider, enter an API key, and choose a model.')
      return
    }
    setSetupTesting(true)
    setSetupError('')
    setSetupSuccess('')
    try {
      const result = await testConnection({ provider: setupProvider, api_key: setupKey, model: setupModel })
      setSetupSuccess(`Connected to ${result.provider} with model ${result.model}`)
    } catch (e: any) {
      setSetupError(e.message)
    }
    setSetupTesting(false)
  }

  function handleSetupConnect() {
    if (!setupProvider || !setupKey || !setupModel) {
      setSetupError('Please complete all fields before connecting.')
      return
    }
    setSelectedProvider(setupProvider)
    setApiKey(setupKey)
    setModel(setupModel)
    setConnected(true)
    setShowSetup(false)
    sessionStorage.setItem('rag_provider_config', JSON.stringify({
      provider: setupProvider, apiKey: setupKey, model: setupModel,
    }))
    setTempStatus('Connected')
  }

  function openSettings() {
    setSettingsProvider(selectedProvider)
    setSettingsKey(apiKey)
    setSettingsModel(model)
    setSettingsError('')
    setSettingsSuccess('')
    setShowSettings(true)
  }

  async function handleSettingsTest() {
    if (!settingsProvider || !settingsKey || !settingsModel) {
      setSettingsError('Please complete all fields.')
      return
    }
    setSettingsTesting(true)
    setSettingsError('')
    setSettingsSuccess('')
    try {
      const result = await testConnection({ provider: settingsProvider, api_key: settingsKey, model: settingsModel })
      setSettingsSuccess(`Connected to ${result.provider} with model ${result.model}`)
    } catch (e: any) {
      setSettingsError(e.message)
    }
    setSettingsTesting(false)
  }

  function handleSettingsSave() {
    if (!settingsProvider || !settingsKey || !settingsModel) {
      setSettingsError('Please complete all fields.')
      return
    }
    setSelectedProvider(settingsProvider)
    setApiKey(settingsKey)
    setModel(settingsModel)
    setConnected(true)
    setShowSettings(false)
    sessionStorage.setItem('rag_provider_config', JSON.stringify({
      provider: settingsProvider, apiKey: settingsKey, model: settingsModel,
    }))
    setTempStatus('Settings saved')
  }

  const send = async () => {
    const q = input.trim()
    if (!q || loading || docs.length === 0) return
    if (!connected) { setShowSetup(true); return }

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)
    setQueryCount(c => c + 1)

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: q }
    setMessages(prev => [...prev, userMsg])
    const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }))

    if (streaming) {
      const pipe: PipelineState = { embed: 'idle', retrieve: 'idle', rerank: 'idle', generate: 'idle' }
      setThinkingPipeline({ ...pipe })
      for (let i = 0; i < 3; i++) {
        pipe[STEPS[i]] = 'active'; setThinkingPipeline({ ...pipe })
        await new Promise(r => setTimeout(r, 280))
        pipe[STEPS[i]] = 'done'; setThinkingPipeline({ ...pipe })
      }
      let sources: Source[] = []
      let aiId = (Date.now() + 1).toString()
      pipe.generate = 'active'; setThinkingPipeline({ ...pipe })
      try {
        for await (const chunk of queryStream({
          query: q, top_k: topK, provider: selectedProvider, model, api_key: apiKey, history
        })) {
          if (chunk.type === 'sources') {
            sources = chunk.sources!
          } else if (chunk.type === 'token') {
            pipe.generate = 'done'; setThinkingPipeline(null)
            setMessages(prev => {
              const existing = prev.find(m => m.id === aiId)
              if (existing) return prev.map(m => m.id === aiId ? { ...m, content: m.content + chunk.content! } : m)
              return [...prev, { id: aiId, role: 'assistant', content: chunk.content!, sources, streaming: true, pipeline: { embed:'done', retrieve:'done', rerank:'done', generate:'done' } }]
            })
          } else if (chunk.type === 'error') {
            setThinkingPipeline(null)
            setMessages(prev => [...prev, { id: aiId, role: 'assistant', content: `**Error**: ${chunk.content}`, sources: [] }])
          } else if (chunk.type === 'done') {
            setMessages(prev => prev.map(m => m.id === aiId ? { ...m, streaming: false } : m))
            setThinkingPipeline(null)
          }
        }
        setTempStatus(`Done · ${sources.length} sources`)
      } catch (e: any) {
        setThinkingPipeline(null)
        setMessages(prev => [...prev, { id: aiId, role: 'assistant', content: `**Error**: ${e.message}`, sources: [] }])
        setTempStatus('Error')
      }
    } else {
      const finalPipeline: PipelineState = { embed: 'idle', retrieve: 'idle', rerank: 'idle', generate: 'idle' }
      setThinkingPipeline({ ...finalPipeline })
      const pipePromise = animatePipeline(p => setThinkingPipeline({ ...p }))
      try {
        const [result] = await Promise.all([
          queryDocs({ query: q, top_k: topK, provider: selectedProvider, model, api_key: apiKey, history }),
          pipePromise
        ])
        setThinkingPipeline(null)
        setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'assistant', content: result.answer, sources: result.sources, pipeline: { embed:'done', retrieve:'done', rerank:'done', generate:'done' } }])
        setTempStatus(`Done · ${result.sources.length} sources`)
      } catch (e: any) {
        setThinkingPipeline(null)
        setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'assistant', content: `**Error**: ${e.message}`, sources: [] }])
        setTempStatus('Error')
      }
    }

    setLoading(false)
    textareaRef.current?.focus()
  }

  const totalChunks = docs.reduce((a, d) => a + (d.chunk_count || 0), 0)

  const currentProvider = providers[selectedProvider]
  const providerColor = PROVIDER_COLORS[selectedProvider] || 'var(--accent)'

  const providerLabel = currentProvider
    ? `${currentProvider.name} · ${currentProvider.models.find(m => m.value === model)?.label || model}`
    : ''

  // ── Provider selector sub-component ──
  function ProviderSelector({ value, onChange, provs }: { value: string; onChange: (v: string) => void; provs: Record<string, ProviderInfo> }) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        {Object.entries(provs).map(([pid, prov]) => {
          const color = PROVIDER_COLORS[pid] || 'var(--accent)'
          const selected = value === pid
          return (
            <button key={pid} onClick={() => onChange(pid)} style={{
              padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${selected ? color + '60' : 'var(--border2)'}`,
              background: selected ? color + '12' : 'var(--bg)',
              color: selected ? color : 'var(--text2)',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, fontFamily: 'Inter, sans-serif', fontWeight: 500,
              transition: 'all 0.15s', textAlign: 'left',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: selected ? color : 'var(--border2)',
                flexShrink: 0, transition: 'all 0.15s',
                boxShadow: selected ? `0 0 8px ${color}50` : 'none',
              }} />
              {prov.name}
            </button>
          )
        })}
      </div>
    )
  }

  // ── Model selector sub-component ──
  function ModelSelector({ provider, value, onChange }: { provider: string; value: string; onChange: (v: string) => void }) {
    const prov = providers[provider]
    if (!prov) return null
    return (
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        width: '100%', fontSize: 12, padding: '10px 12px', borderRadius: 7,
        border: '1px solid var(--border2)', background: 'var(--bg)',
        color: 'var(--text)', fontFamily: 'DM Mono, monospace',
        outline: 'none', cursor: 'pointer',
      }}>
        {prov.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', position: 'relative', overflow: 'hidden', zIndex: 1 }}>

      {/* ── Header ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', height: 52,
        borderBottom: '1px solid var(--border)',
        background: 'rgba(5,6,8,0.9)', backdropFilter: 'blur(12px)',
        flexShrink: 0, zIndex: 10, position: 'relative'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo />
          <div>
            <div className="font-display" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>HarryRAG</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: -1, letterSpacing: '0.08em', textTransform: 'uppercase' }}>by Muhammad Haris</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Backend status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontFamily: 'DM Mono, monospace', color: backendOk ? 'var(--green)' : backendOk === false ? 'var(--red)' : 'var(--text3)' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: backendOk ? 'var(--green)' : backendOk === false ? 'var(--red)' : 'var(--text3)', boxShadow: backendOk ? '0 0 6px var(--green)' : 'none' }} className={backendOk ? 'pulse-dot' : ''} />
            {backendOk ? 'online' : backendOk === false ? 'offline' : 'connecting'}
          </div>

          <div style={{ width: 1, height: 14, background: 'var(--border2)' }} />

          {/* Provider badge */}
          {connected && currentProvider && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 10,
              fontFamily: 'DM Mono, monospace', padding: '3px 10px',
              borderRadius: 4, background: providerColor + '10',
              border: `1px solid ${providerColor}30`, color: providerColor,
            }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: providerColor, boxShadow: `0 0 6px ${providerColor}50` }} />
              {providerLabel}
            </div>
          )}

          <button onClick={connected ? openSettings : () => setShowSetup(true)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
            borderRadius: 5, border: '1px solid var(--border2)',
            background: connected ? 'rgba(45,212,160,0.05)' : 'var(--bg2)',
            color: connected ? 'var(--green)' : 'var(--text2)',
            cursor: 'pointer', fontSize: 10, fontFamily: 'DM Mono, monospace',
            borderColor: connected ? 'rgba(45,212,160,0.2)' : undefined,
            transition: 'all 0.15s'
          }}>
            {connected ? <><Settings size={11} /> settings</> : <><Key size={11} /> connect</>}
          </button>
        </div>
      </header>

      {/* ── Layout ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* ── Sidebar ── */}
        <aside style={{
          width: 252, borderRight: '1px solid var(--border)',
          background: 'var(--bg)', display: 'flex', flexDirection: 'column',
          flexShrink: 0, overflow: 'hidden'
        }}>
          {/* Upload zone */}
          <div style={{ padding: '16px 14px 10px' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 10, fontFamily: 'DM Mono, monospace' }}>Knowledge Base</div>
            <div
              className="upload-zone"
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `1px dashed ${dragOver ? 'rgba(79,142,255,0.5)' : 'var(--border2)'}`,
                borderRadius: 8, padding: '16px 12px', textAlign: 'center', cursor: 'pointer',
                background: dragOver ? 'rgba(79,142,255,0.04)' : 'var(--bg2)',
                transition: 'all 0.2s', opacity: uploading ? 0.6 : 1
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 6, margin: '0 auto 8px',
                background: 'var(--bg3)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Upload size={15} style={{ color: uploading ? 'var(--accent)' : 'var(--text3)' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 3 }}>
                {uploading ? 'Uploading…' : 'Drop files or click'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>PDF · TXT · MD · CSV · DOCX</div>
            </div>
            <input ref={fileRef} type="file" style={{ display: 'none' }} multiple
              accept=".pdf,.txt,.md,.csv,.docx" onChange={e => handleFiles(e.target.files)} />
          </div>

          {/* Doc list */}
          <div style={{ padding: '0 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>Documents</span>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>{docs.length}</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {docs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', paddingTop: 24, lineHeight: 1.7 }}>No documents yet.<br />Upload to begin.</div>
            ) : docs.map(d => {
              const ext = d.filename.split('.').pop() ?? 'txt'
              const color = extColor(ext)
              return (
                <div key={d.doc_id} className="doc-item" style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px',
                  borderRadius: 6, background: 'var(--bg2)', border: '1px solid var(--border)', cursor: 'default'
                }}>
                  <span style={{
                    fontSize: 9, padding: '2px 5px', borderRadius: 3, fontWeight: 500,
                    fontFamily: 'DM Mono, monospace', letterSpacing: '0.05em',
                    color, background: `${color}18`, border: `1px solid ${color}30`
                  }}>{ext.toUpperCase()}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</span>
                  <span style={{ fontSize: 9, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>{d.chunk_count}c</span>
                  <button
                    onClick={() => { deleteDoc(d.doc_id); setDocs(prev => prev.filter(x => x.doc_id !== d.doc_id)) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', opacity: 0.4, padding: 2, display: 'flex', alignItems: 'center', transition: 'opacity 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Stats */}
          <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            <StatBox label="Chunks" value={totalChunks} />
            <StatBox label="Queries" value={queryCount} />
          </div>
        </aside>

        {/* ── Chat ── */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

          {/* Config bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px',
            borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0, flexWrap: 'wrap'
          }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', letterSpacing: '0.04em' }}>model</span>
            {connected && currentProvider ? (
              <select value={model} onChange={e => {
                setModel(e.target.value)
                const cfg = { provider: selectedProvider, apiKey, model: e.target.value }
                sessionStorage.setItem('rag_provider_config', JSON.stringify(cfg))
              }} style={{
                fontSize: 11, padding: '4px 8px', borderRadius: 5,
                border: '1px solid var(--border2)', background: 'var(--bg2)',
                color: 'var(--text)', fontFamily: 'DM Mono, monospace', outline: 'none', cursor: 'pointer'
              }}>
                {currentProvider.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Mono, monospace' }}>not connected</span>
            )}

            <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', letterSpacing: '0.04em' }}>top-k</span>
            <input type="number" value={topK} min={1} max={10}
              onChange={e => setTopK(Number(e.target.value))} style={{
                width: 44, fontSize: 11, padding: '4px 6px', borderRadius: 5,
                border: '1px solid var(--border2)', background: 'var(--bg2)',
                color: 'var(--text)', fontFamily: 'DM Mono, monospace', textAlign: 'center', outline: 'none'
              }} />

            <div style={{ width: 1, height: 14, background: 'var(--border2)', margin: '0 2px' }} />

            {([
              ['Hybrid', hybrid, () => setHybrid(!hybrid), '⚡'],
              ['Stream', streaming, () => setStreaming(!streaming), '◎'],
            ] as [string, boolean, () => void, string][]).map(([label, on, toggle, icon]) => (
              <button key={label} className="toggle-btn" onClick={toggle} style={{
                fontSize: 10, padding: '4px 10px', borderRadius: 5, cursor: 'pointer',
                border: `1px solid ${on ? 'rgba(79,142,255,0.3)' : 'var(--border2)'}`,
                background: on ? 'rgba(79,142,255,0.08)' : 'var(--bg2)',
                color: on ? 'var(--accent)' : 'var(--text3)',
                fontFamily: 'DM Mono, monospace', letterSpacing: '0.04em',
                display: 'flex', alignItems: 'center', gap: 4
              }}>
                <span>{icon}</span>{label.toLowerCase()}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24, minHeight: 0 }}>

            {messages.length === 0 && !thinkingPipeline && (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 20, textAlign: 'center', padding: '40px 20px',
                animation: 'fadeUp 0.5s ease both'
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 16, margin: '0 auto',
                  background: 'linear-gradient(135deg, #0d1628, #151d35)',
                  border: '1px solid rgba(79,142,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 40px rgba(79,142,255,0.1)'
                }}>
                  <Database size={28} style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <div className="font-display" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 8 }}>Ask your documents</div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.75, maxWidth: 380 }}>
                    Upload files, ask anything. HarryRAG uses hybrid vector + keyword search and LLMs to generate cited answers.
                  </div>
                </div>
                {!connected && (
                  <button onClick={() => setShowSetup(true)} style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '9px 16px', borderRadius: 7,
                    border: '1px solid rgba(79,142,255,0.25)',
                    background: 'rgba(79,142,255,0.07)', color: 'var(--accent)',
                    cursor: 'pointer', fontSize: 12, fontFamily: 'DM Mono, monospace', letterSpacing: '0.03em'
                  }}>
                    <Key size={13} /> connect AI provider
                  </button>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, justifyContent: 'center' }}>
                  {['Summarize my documents', 'What are the key topics?', 'List all action items', 'Find main conclusions'].map(q => (
                    <button key={q} className="quick-btn" onClick={() => { setInput(q); textareaRef.current?.focus() }} style={{
                      padding: '7px 14px', borderRadius: 20,
                      border: '1px solid var(--border2)', background: 'var(--bg2)',
                      fontSize: 12, color: 'var(--text2)', cursor: 'pointer', transition: 'all 0.15s'
                    }}>{q}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div key={msg.id} className="fade-up" style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                animationDelay: `${idx * 0.03}s`
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                  background: msg.role === 'assistant' ? 'linear-gradient(135deg, #0d1628, #151d35)' : 'var(--bg3)',
                  border: msg.role === 'assistant' ? '1px solid rgba(79,142,255,0.2)' : '1px solid var(--border2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  {msg.role === 'assistant' ? <Cpu size={13} style={{ color: 'var(--accent)' }} /> : <div style={{ fontSize: 13 }}>U</div>}
                </div>
                <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', gap: 6, alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    padding: '11px 15px', borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                    lineHeight: 1.7, fontSize: 13.5,
                    background: msg.role === 'user' ? 'rgba(79,142,255,0.09)' : 'var(--bg2)',
                    border: `1px solid ${msg.role === 'user' ? 'rgba(79,142,255,0.18)' : 'var(--border)'}`,
                  }}>
                    {msg.role === 'user'
                      ? <span style={{ color: 'var(--text)' }}>{msg.content}</span>
                      : <div className="prose-answer" dangerouslySetInnerHTML={{ __html: renderAnswer(msg.content) }} />
                    }
                    {msg.streaming && <span className="cursor-blink" />}
                  </div>
                  {msg.sources && msg.sources.length > 0 && <SourceCards sources={msg.sources} />}
                </div>
              </div>
            ))}

            {thinkingPipeline && <Thinking pipeline={thinkingPipeline} />}
            <div ref={messagesEnd} />
          </div>

          {/* Input area */}
          <div style={{ padding: '12px 20px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 }}>
            {docs.length === 0 && (
              <div style={{
                fontSize: 10, color: 'var(--amber)', marginBottom: 8, textAlign: 'center',
                fontFamily: 'DM Mono, monospace', letterSpacing: '0.04em'
              }}>
                {'⚠'} upload at least one document to start querying
              </div>
            )}
            <div className="input-wrap" style={{
              display: 'flex', alignItems: 'flex-end', gap: 10,
              background: 'var(--bg2)', border: '1px solid var(--border2)',
              borderRadius: 10, padding: '10px 12px', transition: 'all 0.2s'
            }}>
              <textarea ref={textareaRef} value={input}
                onChange={e => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder={docs.length === 0 ? 'Upload documents first…' : !connected ? 'Connect an AI provider first…' : 'Ask anything about your documents…'}
                disabled={loading || docs.length === 0 || !connected}
                rows={1} style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  color: 'var(--text)', fontFamily: 'Inter, sans-serif',
                  fontSize: 13.5, lineHeight: 1.55, resize: 'none', minHeight: 20, maxHeight: 120
                }} />
              <button onClick={send}
                disabled={loading || !input.trim() || docs.length === 0 || !connected}
                style={{
                  width: 32, height: 32, borderRadius: 7, flexShrink: 0,
                  background: (loading || !input.trim() || docs.length === 0 || !connected) ? 'var(--bg4)' : 'linear-gradient(135deg, var(--accent), var(--accent2))',
                  border: 'none',
                  cursor: (loading || !input.trim() || docs.length === 0 || !connected) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                  opacity: (loading || !input.trim() || docs.length === 0 || !connected) ? 0.35 : 1,
                  boxShadow: (loading || !input.trim() || docs.length === 0 || !connected) ? 'none' : '0 2px 12px rgba(79,142,255,0.3)'
                }}>
                <Send size={14} color="white" />
              </button>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginTop: 7,
              fontSize: 10, color: 'var(--text3)', fontFamily: 'DM Mono, monospace', letterSpacing: '0.03em'
            }}>
              <span>
                <kbd style={{ padding: '1px 5px', borderRadius: 3, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 10 }}>{'↵'}</kbd> send ·
                <kbd style={{ padding: '1px 5px', borderRadius: 3, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 10, marginLeft: 4 }}>{'⇧↵'}</kbd> newline
              </span>
              <span style={{ color: status.includes('Error') ? 'var(--red)' : status.includes('Done') ? 'var(--green)' : 'var(--text3)' }}>
                {status}
              </span>
            </div>
          </div>
        </main>
      </div>

      {/* ── Setup Modal (initial provider config) ── */}
      {showSetup && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }} onClick={e => { if (e.target === e.currentTarget && connected) setShowSetup(false) }}>
          <div className="fade-up" style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 14, padding: 28, width: 440, maxHeight: '90vh', overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 18,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)'
          }}>
            {/* Title */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="font-display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>AI Provider Setup</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Which AI provider do you want to use?</div>
              </div>
              {connected && (
                <button onClick={() => setShowSetup(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', display: 'flex', padding: 4 }}>
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Provider selector */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8, fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Select Provider</div>
              <ProviderSelector value={setupProvider} onChange={pid => {
                setSetupProvider(pid)
                setSetupModel(providers[pid]?.default_model || '')
                setSetupError('')
                setSetupSuccess('')
              }} provs={providers} />
            </div>

            {/* API Key */}
            {setupProvider && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8, fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>API Key</div>
                <input
                  autoFocus type="password" value={setupKey}
                  onChange={e => { setSetupKey(e.target.value); setSetupError(''); setSetupSuccess('') }}
                  placeholder={providers[setupProvider]?.key_hint || 'Enter your API key…'}
                  style={{
                    width: '100%', padding: '10px 12px', background: 'var(--bg)',
                    border: '1px solid var(--border2)', borderRadius: 7,
                    color: 'var(--text)', fontFamily: 'DM Mono, monospace',
                    fontSize: 12, outline: 'none', letterSpacing: '0.05em'
                  }}
                />
                {autoDetected && autoDetected !== setupProvider && (
                  <div style={{
                    marginTop: 8, padding: '8px 12px', borderRadius: 6,
                    background: 'rgba(240,167,58,0.08)', border: '1px solid rgba(240,167,58,0.25)',
                    fontSize: 11, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    <AlertCircle size={13} />
                    This key looks like it belongs to {providers[autoDetected]?.name}. You selected {providers[setupProvider]?.name}.
                  </div>
                )}
              </div>
            )}

            {/* Model */}
            {setupProvider && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8, fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Model</div>
                <ModelSelector provider={setupProvider} value={setupModel} onChange={v => { setSetupModel(v); setSetupError(''); setSetupSuccess('') }} />
              </div>
            )}

            {/* Security warning */}
            <div style={{
              padding: '10px 12px', borderRadius: 6,
              background: 'rgba(79,142,255,0.05)', border: '1px solid rgba(79,142,255,0.15)',
              fontSize: 11, color: 'var(--text2)', lineHeight: 1.7,
              display: 'flex', gap: 8
            }}>
              <Shield size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
              <div>
                Your API key is stored in session storage only and sent directly to the selected provider. In a browser-based app, API keys are visible in network requests. For production use, route calls through a backend proxy.
              </div>
            </div>

            {/* Status messages */}
            {setupError && (
              <div style={{
                padding: '10px 12px', borderRadius: 6,
                background: 'rgba(255,92,106,0.08)', border: '1px solid rgba(255,92,106,0.25)',
                fontSize: 11, color: 'var(--red)', display: 'flex', alignItems: 'flex-start', gap: 8
              }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ lineHeight: 1.6 }}>{setupError}</div>
              </div>
            )}
            {setupSuccess && (
              <div style={{
                padding: '10px 12px', borderRadius: 6,
                background: 'rgba(45,212,160,0.08)', border: '1px solid rgba(45,212,160,0.25)',
                fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8
              }}>
                <CheckCircle size={14} />
                {setupSuccess}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSetupTest} disabled={setupTesting || !setupProvider || !setupKey || !setupModel} style={{
                flex: 1, padding: 11, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)',
                fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: (setupTesting || !setupProvider || !setupKey || !setupModel) ? 0.5 : 1,
              }}>
                <RefreshCw size={13} className={setupTesting ? 'spin' : ''} />
                {setupTesting ? 'Testing…' : 'Test Connection'}
              </button>
              <button onClick={handleSetupConnect} disabled={!setupProvider || !setupKey || !setupModel} style={{
                flex: 1, padding: 11, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                color: 'white', border: 'none', fontFamily: 'Inter, sans-serif',
                boxShadow: '0 2px 12px rgba(79,142,255,0.25)',
                opacity: (!setupProvider || !setupKey || !setupModel) ? 0.5 : 1,
              }}>Connect & Start</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings Modal ── */}
      {showSettings && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
        }} onClick={e => { if (e.target === e.currentTarget) setShowSettings(false) }}>
          <div className="fade-up" style={{
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 14, padding: 28, width: 440, maxHeight: '90vh', overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 18,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div className="font-display" style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>AI Provider Settings</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Change provider, model, or API key</div>
              </div>
              <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', display: 'flex', padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            {/* Current config */}
            {currentProvider && (
              <div style={{
                padding: '10px 12px', borderRadius: 6,
                background: 'var(--bg3)', border: '1px solid var(--border)',
                fontSize: 11, color: 'var(--text2)',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: providerColor, boxShadow: `0 0 8px ${providerColor}50` }} />
                Currently: <strong style={{ color: 'var(--text)' }}>{providerLabel}</strong>
              </div>
            )}

            {/* Provider selector */}
            <div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8, fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Provider</div>
              <ProviderSelector value={settingsProvider} onChange={pid => {
                setSettingsProvider(pid)
                setSettingsModel(providers[pid]?.default_model || '')
                if (pid !== selectedProvider) setSettingsKey('')
                setSettingsError('')
                setSettingsSuccess('')
              }} provs={providers} />
            </div>

            {/* API Key */}
            {settingsProvider && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8, fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>API Key</div>
                <input
                  type="password" value={settingsKey}
                  onChange={e => { setSettingsKey(e.target.value); setSettingsError(''); setSettingsSuccess('') }}
                  placeholder={providers[settingsProvider]?.key_hint || 'Enter your API key…'}
                  style={{
                    width: '100%', padding: '10px 12px', background: 'var(--bg)',
                    border: '1px solid var(--border2)', borderRadius: 7,
                    color: 'var(--text)', fontFamily: 'DM Mono, monospace',
                    fontSize: 12, outline: 'none', letterSpacing: '0.05em'
                  }}
                />
              </div>
            )}

            {/* Model */}
            {settingsProvider && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8, fontFamily: 'DM Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Model</div>
                <ModelSelector provider={settingsProvider} value={settingsModel} onChange={v => { setSettingsModel(v); setSettingsError(''); setSettingsSuccess('') }} />
              </div>
            )}

            {/* Status messages */}
            {settingsError && (
              <div style={{
                padding: '10px 12px', borderRadius: 6,
                background: 'rgba(255,92,106,0.08)', border: '1px solid rgba(255,92,106,0.25)',
                fontSize: 11, color: 'var(--red)', display: 'flex', alignItems: 'flex-start', gap: 8
              }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ lineHeight: 1.6 }}>{settingsError}</div>
              </div>
            )}
            {settingsSuccess && (
              <div style={{
                padding: '10px 12px', borderRadius: 6,
                background: 'rgba(45,212,160,0.08)', border: '1px solid rgba(45,212,160,0.25)',
                fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 8
              }}>
                <CheckCircle size={14} />
                {settingsSuccess}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSettingsTest} disabled={settingsTesting || !settingsProvider || !settingsKey || !settingsModel} style={{
                flex: 1, padding: 11, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)',
                fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: (settingsTesting || !settingsProvider || !settingsKey || !settingsModel) ? 0.5 : 1,
              }}>
                <RefreshCw size={13} className={settingsTesting ? 'spin' : ''} />
                {settingsTesting ? 'Testing…' : 'Test Connection'}
              </button>
              <button onClick={handleSettingsSave} disabled={!settingsProvider || !settingsKey || !settingsModel} style={{
                flex: 1, padding: 11, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                color: 'white', border: 'none', fontFamily: 'Inter, sans-serif',
                boxShadow: '0 2px 12px rgba(79,142,255,0.25)',
                opacity: (!settingsProvider || !settingsKey || !settingsModel) ? 0.5 : 1,
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
