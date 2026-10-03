import type { ButtonHTMLAttributes, ReactNode } from 'react'

export const inputClass =
  'w-full min-h-11 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-400">
        {label}
        {hint && <span className="ml-1 text-zinc-600">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

type Variant = 'primary' | 'secondary' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-sky-600 text-white active:bg-sky-700 disabled:bg-sky-900 disabled:text-sky-400',
  secondary: 'bg-zinc-800 text-zinc-100 active:bg-zinc-700 disabled:text-zinc-500',
  danger: 'bg-red-900/60 text-red-200 active:bg-red-900',
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`min-h-11 rounded-lg px-4 py-2 font-medium transition-colors ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-zinc-400">{title}</h2>}
      {children}
    </section>
  )
}

export function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null
  return (
    <ul className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
      {errors.map((e) => (
        <li key={e}>• {e}</li>
      ))}
    </ul>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; className?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-zinc-900 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-md text-sm font-medium ${
            value === o.value ? (o.className ?? 'bg-zinc-700 text-white') : 'text-zinc-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <header className="mb-4 flex items-center justify-between">
      <h1 className="text-xl font-bold">{title}</h1>
      {right}
    </header>
  )
}

export function Loading() {
  return <p className="py-10 text-center text-zinc-500">載入中…</p>
}

export function LoadError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="space-y-3 py-6 text-center">
      <p className="text-red-300">{error.message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          重試
        </Button>
      )}
    </div>
  )
}

/** R 值的顏色 */
export function rColor(r: number): string {
  return r > 0 ? 'text-emerald-400' : r < 0 ? 'text-red-400' : 'text-zinc-400'
}
