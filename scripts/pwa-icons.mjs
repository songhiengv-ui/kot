// Renders the app icons (accent tile + mic, as on the login screen) into public/. Usage: npm run pwa-icons
import { writeFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { ImageResponse } from 'next/og.js'

const MIC = 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z'
// glyph: share of the tile the mic occupies; radius: corner rounding (0 for maskable/apple — the OS crops)
const tile = (size, glyph, radius) => h('div', { style: { width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#2E6B5B', borderRadius: radius * size } },
  h('svg', { width: size * glyph, height: size * glyph, viewBox: '0 0 24 24' }, h('path', { d: MIC, fill: '#F4F2EC' })))

for (const [file, size, glyph, radius] of [['icon-192.png', 192, 0.55, 0.22], ['icon-512.png', 512, 0.55, 0.22], ['icon-maskable-512.png', 512, 0.42, 0], ['apple-touch-icon.png', 180, 0.5, 0]]) {
  const png = Buffer.from(await new ImageResponse(tile(size, glyph, radius), { width: size, height: size }).arrayBuffer())
  writeFileSync(new URL(`../public/${file}`, import.meta.url), png)
  console.log(file, png.length, 'bytes')
}
