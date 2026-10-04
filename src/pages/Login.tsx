import { useState, type FormEvent } from 'react'
import { Button, Errors, Field, inputClass } from '../components/ui'
import { buildInfo, signIn } from '../lib/db'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pt-[env(safe-area-inset-top)]">
      <h1 className="mb-8 text-center text-2xl font-bold">交易日誌</h1>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <input className={inputClass} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="密碼">
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Errors errors={error ? [error] : []} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? '登入中…' : '登入'}
        </Button>
      </form>
      <p className="mt-10 text-center text-xs text-zinc-600">{buildInfo}</p>
    </main>
  )
}
