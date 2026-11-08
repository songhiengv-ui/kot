'use client'
// Screen-level crash: keep the shell (nav still works) and offer a retry. Static km + en text — app context may be what failed.
export default function ScreenError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 text-center py-16 px-4">
      <p className="text-[17px] font-semibold">មានបញ្ហា · Something went wrong</p>
      <p className="text-[13.5px] text-muted max-w-xs">កំណត់ត្រារបស់អ្នកមិនបាត់ទេ។ Your records are safe.</p>
      <button onClick={retry} className="mt-3 min-h-11 px-5 rounded-2xl bg-ink text-bg text-[15px]">ព្យាយាមម្ដងទៀត · Try again</button>
    </div>
  )
}
