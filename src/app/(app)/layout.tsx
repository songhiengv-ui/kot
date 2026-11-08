'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { Providers, useApp, useAppReady } from '@/lib/app'
import { Icon } from '@/components/ui'
import { Sheets } from '@/components/sheets'

export default function AppLayout({ children }: { children: ReactNode }) {
  // Service worker in production only (it would cache dev bundles). It caches the app shell, never data.
  useEffect(() => { if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}) }, [])
  return <Providers><Gate>{children}</Gate></Providers>
}

const Gate = ({ children }: { children: ReactNode }) => useAppReady() ? <Shell>{children}</Shell> : children

function Shell({ children }: { children: ReactNode }) {
  const { t, openSheet } = useApp()
  const path = usePathname()
  const tabs = [
    { href: '/', icon: 'home', label: t.tabHome },
    { href: '/activity', icon: 'receipt_long', label: t.tabTx },
    { href: '/accounts', icon: 'account_balance_wallet', label: t.tabAccts },
    { href: '/insights', icon: 'bar_chart', label: t.tabInsights },
  ]
  const on = (h: string) => (h === '/' ? path === '/' : path.startsWith(h))
  const mic = () => openSheet({ kind: 'voice' })

  return (
    <div className="min-h-dvh md:flex">
      {/* desktop sidebar */}
      <nav aria-label="Main" className="hidden md:flex flex-col gap-1 w-60 shrink-0 h-dvh sticky top-0 border-r border-line px-4 py-6">
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <span className="w-9 h-9 rounded-xl bg-accent text-bg grid place-items-center"><Icon name="mic" className="text-xl" /></span>
          <span className="text-lg font-semibold">កត់ Kat</span>
        </div>
        <button onClick={mic} className="flex items-center justify-center gap-2 h-12 mb-3 rounded-2xl bg-ink text-bg font-medium">
          <Icon name="mic" fill className="text-xl" />{t.qVoice}
        </button>
        {[...tabs, { href: '/settings', icon: 'settings', label: t.tabSettings }].map(x => (
          <Link key={x.href} href={x.href} aria-current={on(x.href) ? 'page' : undefined}
            className={`flex items-center gap-3 h-11 px-3 rounded-xl text-[14.5px] ${on(x.href) ? 'bg-surface text-ink font-medium' : 'text-muted hover:bg-sunken-2'}`}>
            <Icon name={x.icon} fill={on(x.href)} className="text-[22px]" />{x.label}
          </Link>
        ))}
      </nav>

      <main className="flex-1 min-w-0 pt-safe pb-[calc(110px+env(safe-area-inset-bottom))] md:pb-10">
        <div className="mx-auto max-w-[1040px] px-5 md:px-10 pt-4 md:pt-8">{children}</div>
      </main>

      {/* mobile bottom nav */}
      <nav aria-label="Main" className="md:hidden fixed inset-x-0 bottom-0 z-20 bg-[rgba(244,242,236,.94)] backdrop-blur-[14px] border-t border-line flex items-start justify-around px-2 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
        {tabs.slice(0, 2).map(x => <Tab key={x.href} {...x} active={on(x.href)} />)}
        <button onClick={mic} aria-label={t.qVoice}
          className="w-16 h-16 -mt-[26px] rounded-full bg-ink text-bg grid place-items-center shrink-0 shadow-[0_10px_24px_-8px_rgba(25,26,23,.55),0_0_0_5px_#F4F2EC] active:scale-[.94] transition-transform">
          <Icon name="mic" fill className="text-[30px]" />
        </button>
        {tabs.slice(2).map(x => <Tab key={x.href} {...x} active={on(x.href)} />)}
      </nav>
      <Sheets />
    </div>
  )
}

function Tab({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 w-16 min-h-11 py-1 ${active ? 'text-ink' : 'text-[#8C8D84]'}`}>
      <Icon name={icon} fill={active} className="text-[23px]" />
      <span className="text-[10.5px] font-medium whitespace-nowrap">{label}</span>
    </Link>
  )
}
