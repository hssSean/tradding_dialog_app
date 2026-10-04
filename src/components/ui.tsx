import type { ButtonHTMLAttributes, ReactNode } from 'react'

export const inputClass =
  'w-full min-h-11 rounded-lg border border-ink-line bg-ink-raised px-3 py-2 text-paper placeholder:text-paper-dim focus:border-moon focus:outline-none'

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-paper-dim">
        {label}
        {hint && <span className="ml-1 text-paper-dim/60">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

type Variant = 'primary' | 'secondary' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-moon text-ink active:opacity-90 disabled:opacity-40',
  secondary: 'bg-paper/10 text-paper active:bg-paper/15 disabled:opacity-40',
  danger: 'border border-ochre/60 text-ochre active:bg-ochre/10',
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
    <section className={`rounded-xl border border-ink-line bg-ink-raised/60 p-4 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-paper-dim">{title}</h2>}
      {children}
    </section>
  )
}

export function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null
  return (
    <ul className="rounded-lg border border-ochre/15 bg-ochre/50 p-3 text-sm text-ochre">
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
    <div className="flex gap-1 rounded-lg bg-ink-raised p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-md text-sm font-medium ${
            value === o.value ? (o.className ?? 'bg-paper/15 text-paper') : 'text-paper-dim'
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
      <h1 className="sec-title" style={{ fontSize: 26 }}>
        {title}
      </h1>
      {right}
    </header>
  )
}

export function Loading() {
  return <p className="py-10 text-center text-paper-dim">載入中…</p>
}

export function LoadError({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="space-y-3 py-6 text-center">
      <p className="text-ochre">{error.message}</p>
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
  return r > 0 ? 'text-jade' : r < 0 ? 'text-ochre' : 'text-paper-dim'
}
