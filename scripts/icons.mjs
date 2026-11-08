// Downloads the Material Symbols Rounded subset for src/app/icons.json into public/fonts/ (self-hosted: no
// render-blocking Google Fonts CSS, no extra cross-origin connections). Usage: npm run icons
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const icons = JSON.parse(readFileSync(new URL('../src/app/icons.json', import.meta.url), 'utf8')).sort()
const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0..1,0&icon_names=${icons.join(',')}&display=block`, {
  headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },  // → woff2
})).text()
const url = css.match(/url\((https:[^)]+)\)\s*format\('woff2'\)/)?.[1]
if (!url) throw new Error('woff2 url not found in Google Fonts CSS:\n' + css.slice(0, 300))
const font = Buffer.from(await (await fetch(url)).arrayBuffer())
mkdirSync(new URL('../public/fonts/', import.meta.url), { recursive: true })
writeFileSync(new URL('../public/fonts/material-symbols.woff2', import.meta.url), font)
console.log(`${icons.length} icons → public/fonts/material-symbols.woff2 (${(font.length / 1024).toFixed(1)} KB)`)
