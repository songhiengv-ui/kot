// Throwaway test users, created straight in the dev database and signed in with Supabase's own cookie encoding.
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createServerClient } from '@supabase/ssr'

process.loadEnvFile('.env.local')
const ssl = { ca: readFileSync('supabase/prod-ca-2021.crt', 'utf8') }

export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl })
  await db.connect()
  try { return (await db.query(text, values)).rows as T[] } finally { await db.end() }
}

/** Creates a confirmed email user (English UI, voice consent given) and returns ids + a Playwright storageState. */
export async function newUser(baseURL: string) {
  const email = `e2e-${randomUUID()}@test.local`, password = randomUUID()
  const [{ id }] = await sql<{ id: string }>(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, extensions.crypt($2, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '') returning id`, [email, password])
  await sql(`update public.profiles set locale = 'en', voice_consent_at = now() where id = $1`, [id])

  const jar = new Map<string, string>()
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cs => cs.forEach(c => jar.set(c.name, c.value)) },
  })
  const { error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw error
  await new Promise(r => setTimeout(r, 50))  // setAll runs from the auth state listener
  const { hostname } = new URL(baseURL)
  return {
    id,
    storageState: {
      cookies: [...jar].map(([name, value]) => ({ name, value, domain: hostname, path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' as const })),
      origins: [],
    },
  }
}

export const deleteUser = (id: string) => sql('delete from auth.users where id = $1', [id])
