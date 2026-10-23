#!/usr/bin/env node
// Minimal OpenAI-compatible mock for developing / testing the AI lab without an API key.
//   node scripts/mock-llm.mjs [--port 8787]   → base URL http://localhost:8787/v1
// Vision requests (with images) get a contiguous segmentation built from the frame indices in the prompt;
// text requests get a format-analysis skeleton derived from the feature list in the prompt.
import { createServer } from 'node:http'

const port = Number(process.argv[process.argv.indexOf('--port') + 1] || 8787)

function reply(messages) {
  const parts = messages.flatMap((m) => (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content))
  const images = parts.filter((p) => p.type === 'image_url').length
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
  if (images) {
    const frames = [...text.matchAll(/frame (\d+) \(t=/g)].map((m) => Number(m[1]))
    const length = Number(text.match(/(\d+) frames at/)?.[1] ?? frames[frames.length - 1] + 1)
    const k = Math.max(2, Math.min(5, Math.floor(frames.length / 3)))
    const cuts = Array.from({ length: k + 1 }, (_, i) => Math.round((i / k) * length))
    const verbs = ['reach', 'grasp', 'move', 'place', 'release']
    return {
      segments: cuts.slice(0, -1).map((s, i) => ({ start_frame: s, end_frame: cuts[i + 1], subtask: `${verbs[i % verbs.length]} the object (mock)`, skill: verbs[i % verbs.length], caption: `mock caption ${i + 1}` })),
      episode_caption: `Mock caption for an episode with ${length} frames and ${images} sampled images.`,
      scene: 'mock scene',
      success: true,
    }
  }
  const keys = [...text.matchAll(/"key":"([^"]+)"/g)].map((m) => m[1]).slice(0, 40)
  return {
    summary: `Mock analysis of ${keys.length} features.`,
    embodiment: 'mock',
    features: keys.map((k) => ({ key: k, slice: null, role: k.includes('image') ? 'camera' : 'unknown', side: null, meaning: 'mock', reference_frame: null, rotation: null, units: null, confidence: 0.1 })),
    coordinate_frames: [{ name: 'base', description: 'mock frame' }],
    action_semantics: 'mock',
    issues: ['mock issue'],
    training_recommendations: ['mock recommendation'],
  }
}

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') return res.end()
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    try {
      const j = JSON.parse(body || '{}')
      const content = JSON.stringify(reply(j.messages ?? []))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: body.length / 4, completion_tokens: content.length / 4 } }))
    } catch (e) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: { message: String(e) } }))
    }
  })
}).listen(port, () => console.log(`mock LLM on http://localhost:${port}/v1`))
