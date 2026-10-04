import { Link, Outlet, useLocation } from 'react-router-dom'

const tabs = [
  { to: '/', label: '首頁', end: true, d: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { to: '/log', label: '日誌', end: false, d: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5zM8 7h8M8 11h6' },
  { to: '/dex', label: '圖鑑', end: false, d: 'M5 3h14M5 21h14M7 3v18M17 3v18' },
  { to: '/me', label: '角色', end: false, d: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0' },
]

/** 日誌分頁底下的子頁（交易、檢討、筆記）也讓「日誌」亮起 */
const LOG_PREFIXES = ['/log', '/trade', '/card', '/review', '/notes']

export default function Layout() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'

  return (
    <div className="relative mx-auto min-h-dvh max-w-[440px] pb-[calc(96px+env(safe-area-inset-bottom))]">
      {isHome ? (
        <Outlet />
      ) : (
        <main className="px-[18px] pt-[calc(env(safe-area-inset-top)+1.25rem)]">
          <Outlet />
        </main>
      )}
      <nav className="tabs" aria-label="主選單">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="tab"
            aria-current={
              (t.end ? pathname === t.to : pathname.startsWith(t.to)) || (t.to === '/log' && LOG_PREFIXES.some((p) => pathname.startsWith(p)))
                ? 'page'
                : undefined
            }
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={t.d} />
            </svg>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
