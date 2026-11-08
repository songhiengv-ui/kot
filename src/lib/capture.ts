// Client helper: parse locally; only round-trip to /api/capture when the local parse can't place the amounts.
import { needsAI, parseCapture, type Candidate } from './parse'

export async function parseHybrid(text: string, mode: 'personal' | 'business', source: 'text' | 'voice'): Promise<{ candidates: Candidate[]; usedAI: boolean }> {
  const local = { candidates: parseCapture(text, mode), usedAI: false }
  if (!needsAI(text, local.candidates) || text.trim().length > 500) return local
  try {
    const res = await fetch('/api/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, mode, source }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return local
    const data = await res.json()
    return Array.isArray(data?.candidates) && data.candidates.length ? { candidates: data.candidates, usedAI: !!data.usedAI } : local
  } catch {
    return local
  }
}
