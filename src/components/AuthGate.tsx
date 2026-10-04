import { useEffect, useState, type ReactNode } from 'react'
import { configured, isSignedIn, onAuthChange } from '../lib/db'
import Login from '../pages/Login'
import { Loading } from './ui'

export default function AuthGate({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    if (!configured) return
    isSignedIn().then(setSignedIn)
    return onAuthChange(setSignedIn)
  }, [])

  if (!configured)
    return (
      <p className="p-6 text-center text-paper-dim">
        尚未設定 <code>VITE_SUPABASE_URL</code> 與 <code>VITE_SUPABASE_ANON_KEY</code>。
      </p>
    )
  if (signedIn === null) return <Loading />
  if (!signedIn) return <Login />
  return <>{children}</>
}
