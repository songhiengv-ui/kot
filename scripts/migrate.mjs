// Applies supabase/migrations/*.sql in order, each in its own transaction, once.
// Usage: node --env-file=.env.local scripts/migrate.mjs
import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'

const dir = new URL('../supabase/migrations/', import.meta.url)
const ca = readFileSync(new URL('../supabase/prod-ca-2021.crt', import.meta.url), 'utf8')  // Supabase root CA
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { ca } })
await db.connect()
await db.query('create schema if not exists private; create table if not exists private.migrations (name text primary key, applied_at timestamptz default now())')
const done = new Set((await db.query('select name from private.migrations')).rows.map(r => r.name))

for (const name of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  if (done.has(name)) continue
  try {
    await db.query('begin')
    await db.query(readFileSync(new URL(name, dir), 'utf8'))
    await db.query('insert into private.migrations (name) values ($1)', [name])
    await db.query('commit')
    console.log('applied', name)
  } catch (e) {
    await db.query('rollback')
    console.error('FAILED', name, e.message)
    process.exit(1)
  }
}
await db.end()
