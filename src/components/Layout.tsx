import { NavLink, Outlet } from 'react-router-dom'

const tabs = [
  { to: '/', label: '交易', end: true },
  { to: '/review', label: '檢討', end: false },
  { to: '/settings', label: '設定', end: false },
]

export default function Layout() {
  return (
    <div className="mx-auto min-h-dvh max-w-xl">
      <main className="px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+5rem)]">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-xl">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `flex min-h-14 flex-1 items-center justify-center text-sm font-medium ${isActive ? 'text-sky-400' : 'text-zinc-500'}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
