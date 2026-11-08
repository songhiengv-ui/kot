'use client'
// Root-layout crash: own document, inline styles (globals.css isn't loaded here).
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="km">
      <body style={{ margin: 0, minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#F4F2EC', color: '#191A17', fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 24 }}>
        <title>កត់</title>
        <main role="alert">
          <p style={{ fontSize: 18, fontWeight: 600 }}>មានបញ្ហា · Something went wrong</p>
          <p style={{ fontSize: 14, color: '#5F6159' }}>កំណត់ត្រារបស់អ្នកមិនបាត់ទេ។ Your records are safe.</p>
          <button onClick={retry} style={{ marginTop: 16, minHeight: 48, padding: '0 24px', border: 0, borderRadius: 16, background: '#191A17', color: '#F4F2EC', fontSize: 15 }}>ព្យាយាមម្ដងទៀត · Try again</button>
        </main>
      </body>
    </html>
  )
}
