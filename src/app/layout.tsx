import type { Metadata, Viewport } from 'next'
import { Geist, Kantumruy_Pro } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const kantumruy = Kantumruy_Pro({ subsets: ['khmer', 'latin'], variable: '--font-kantumruy', weight: ['400', '500', '600'] })

// Only the icons we use — the full Material Symbols font is several hundred KB.
// Icon font is self-hosted (public/fonts/material-symbols.woff2), subset to src/app/icons.json.
// After adding an icon to icons.json run: npm run icons

export const metadata: Metadata = {
  title: 'Kat · កត់',
  description: 'All your banks and cash in one place — just speak Khmer.',
  appleWebApp: { capable: true, title: 'កត់', statusBarStyle: 'default' },
  icons: { apple: '/apple-touch-icon.png' },
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#F4F2EC' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="km" className={`${geist.variable} ${kantumruy.variable}`}>
      <head>
        <link rel="preload" href="/fonts/material-symbols.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  )
}
