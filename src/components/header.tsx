'use client'
import { useApp } from '@/lib/app'
import { Icon } from './ui'

export function ModePill({ big }: { big?: boolean }) {
  const { t, mode, openSheet, online } = useApp()
  const biz = mode === 'business'
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => openSheet({ kind: 'mode' })} aria-label={`${t.modeT}: ${t[mode]}`}
        className={`flex items-center gap-2 rounded-full bg-surface ring-1 ring-line min-h-11 ${big ? 'pl-1.5 pr-3' : 'pl-3 pr-2.5 text-[13px]'}`}>
        {big && <span className={`w-7 h-7 rounded-full grid place-items-center text-white ${biz ? 'bg-[#8A6A3A]' : 'bg-accent'}`}><Icon name={biz ? 'storefront' : 'person'} className="text-base" /></span>}
        <span className={big ? 'text-sm font-medium' : ''}>{t[mode]}</span>
        <Icon name="unfold_more" className="text-lg text-faint" />
      </button>
      {!online && <span className="flex items-center gap-1.5 text-[12.5px] text-warn bg-warn-bg px-2.5 py-1.5 rounded-full"><Icon name="cloud_off" className="text-[15px]" />{t.offline}</span>}
    </div>
  )
}

export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-1.5 pb-3.5">
      <h1 className="text-[28px] font-semibold tracking-[-0.6px]">{children}</h1>
      <ModePill />
    </div>
  )
}
