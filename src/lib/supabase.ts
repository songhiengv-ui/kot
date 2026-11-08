import { createBrowserClient } from '@supabase/ssr'

// Browser client. Session lives in cookies (refreshed by src/proxy.ts); all access is enforced by RLS.
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
)
