/**
 * Provider-agnostic chat client running in the browser. Supports OpenAI-compatible endpoints
 * (OpenAI, Qwen/DashScope, DeepSeek, Zhipu, Moonshot, SiliconFlow, OpenRouter, Ollama, vLLM …),
 * Anthropic Messages and Google Gemini. Keys never leave the user's machine except to the provider.
 */
export type ProviderKind = 'openai' | 'anthropic' | 'gemini'

export interface LlmConfig {
  kind: ProviderKind
  baseUrl: string
  apiKey: string
  /** text model used for format analysis */
  model: string
  /** multimodal model used for subtask decomposition / captions (falls back to `model`) */
  visionModel?: string
  temperature?: number
  maxTokens?: number
  /** request JSON output where the provider supports it */
  jsonMode?: boolean
}

export type ChatPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatPart[]
}

export interface ChatResult {
  text: string
  usage?: { input?: number; output?: number }
  ms: number
}

export interface ProviderPreset {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  model: string
  visionModel: string
  keyUrl?: string
}

export const PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', visionModel: 'gpt-4o', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'qwen', label: '通义千问 Qwen (DashScope)', kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', visionModel: 'qwen-vl-max', keyUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', visionModel: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/' },
  { id: 'zhipu', label: '智谱 GLM', kind: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', visionModel: 'glm-4v-plus', keyUrl: 'https://open.bigmodel.cn/' },
  { id: 'moonshot', label: 'Moonshot Kimi', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k', visionModel: 'moonshot-v1-32k-vision-preview' },
  { id: 'siliconflow', label: 'SiliconFlow 硅基流动', kind: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct', visionModel: 'Qwen/Qwen2.5-VL-72B-Instruct' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', visionModel: 'google/gemini-2.0-flash-001' },
  { id: 'anthropic', label: 'Anthropic Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', visionModel: 'claude-sonnet-4-5', keyUrl: 'https://console.anthropic.com/' },
  { id: 'gemini', label: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash', visionModel: 'gemini-2.0-flash', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'ollama', label: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', visionModel: 'qwen2.5vl:7b' },
  { id: 'vllm', label: 'vLLM / custom OpenAI-compatible', kind: 'openai', baseUrl: 'http://localhost:8000/v1', model: 'Qwen/Qwen2.5-VL-7B-Instruct', visionModel: 'Qwen/Qwen2.5-VL-7B-Instruct' },
]

function splitDataUrl(u: string) {
  const m = u.match(/^data:([^;]+);base64,(.*)$/)
  return m ? { mime: m[1], data: m[2] } : { mime: 'image/jpeg', data: u }
}

export async function chat(cfg: LlmConfig, messages: ChatMessage[], opts: { vision?: boolean; json?: boolean; signal?: AbortSignal } = {}): Promise<ChatResult> {
  const t0 = performance.now()
  const model = opts.vision ? cfg.visionModel || cfg.model : cfg.model
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const parts = (c: ChatMessage['content']): ChatPart[] => (typeof c === 'string' ? [{ type: 'text', text: c }] : c)
  let res: Response
  if (cfg.kind === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => parts(m.content).map((p) => (p.type === 'text' ? p.text : '')).join('\n')).join('\n')
    res = await fetch(`${base}/messages`, {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        system: system || undefined,
        max_tokens: cfg.maxTokens ?? 4096,
        temperature: cfg.temperature ?? 0.2,
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role,
            content: parts(m.content).map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', source: { type: 'base64', media_type: splitDataUrl(p.dataUrl).mime, data: splitDataUrl(p.dataUrl).data } })),
          })),
      }),
    })
    const j = await readJson(res)
    return { text: (j.content ?? []).map((c: any) => c.text ?? '').join(''), usage: { input: j.usage?.input_tokens, output: j.usage?.output_tokens }, ms: performance.now() - t0 }
  }
  if (cfg.kind === 'gemini') {
    const system = messages.filter((m) => m.role === 'system').map((m) => parts(m.content).map((p) => (p.type === 'text' ? p.text : '')).join('\n')).join('\n')
    res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST',
      signal: opts.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: { temperature: cfg.temperature ?? 0.2, maxOutputTokens: cfg.maxTokens ?? 4096, responseMimeType: opts.json ? 'application/json' : undefined },
        contents: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: parts(m.content).map((p) => (p.type === 'text' ? { text: p.text } : { inline_data: { mime_type: splitDataUrl(p.dataUrl).mime, data: splitDataUrl(p.dataUrl).data } })),
          })),
      }),
    })
    const j = await readJson(res)
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
    return { text, usage: { input: j.usageMetadata?.promptTokenCount, output: j.usageMetadata?.candidatesTokenCount }, ms: performance.now() - t0 }
  }
  res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      temperature: cfg.temperature ?? 0.2,
      max_tokens: cfg.maxTokens ?? 4096,
      response_format: opts.json && cfg.jsonMode !== false ? { type: 'json_object' } : undefined,
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: p.dataUrl } })),
      })),
    }),
  })
  const j = await readJson(res)
  return { text: j.choices?.[0]?.message?.content ?? '', usage: { input: j.usage?.prompt_tokens, output: j.usage?.completion_tokens }, ms: performance.now() - t0 }
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      const j = JSON.parse(text)
      msg = j.error?.message ?? j.message ?? text
    } catch {
      // keep raw text
    }
    throw new Error(`HTTP ${res.status}: ${msg.slice(0, 500)}`)
  }
  return JSON.parse(text)
}

/** Extract the first JSON object / array from a model reply (tolerates ```json fences and prose). */
export function parseJsonLoose<T = any>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1] : text
  try {
    return JSON.parse(body)
  } catch {
    const start = body.search(/[[{]/)
    if (start < 0) throw new Error('model reply contains no JSON')
    const open = body[start]
    const close = open === '{' ? '}' : ']'
    let depth = 0, inStr = false, esc = false
    for (let i = start; i < body.length; i++) {
      const c = body[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === open) depth++
      else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1))
    }
    throw new Error('unterminated JSON in model reply')
  }
}
