// ponytail: in-memory sliding window, per server instance (resets on deploy, not shared across instances). Move to Postgres/Redis if abused.
const WINDOW_MS = 60_000
const buckets = new Map<string, number[]>()

/** true = over the limit. Separate buckets per route via the key prefix. */
export function limited(key: string, maxPerMinute = 20) {
  const now = Date.now()
  if (buckets.size > 10_000) buckets.clear()
  const recent = (buckets.get(key) ?? []).filter(t => now - t < WINDOW_MS)
  const over = recent.length >= maxPerMinute
  if (!over) recent.push(now)
  buckets.set(key, recent)
  return over
}
