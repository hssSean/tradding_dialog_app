import { useState } from 'react'
import { Spark } from '../components/game'
import { Button, Errors, LoadError, Loading, inputClass } from '../components/ui'
import { DEX_REVEAL_N } from '../game/rules'
import { monthKey } from '../game/evaluate'
import type { DexCard } from '../game/progress'
import { createSetup, reviewSetup, updateSetup } from '../lib/db'
import { fmtPct, fmtR } from '../lib/format'
import { type Journal, useJournal } from '../lib/useJournal'

export default function Dex() {
  const journal = useJournal()
  if (journal.error) return <LoadError error={journal.error} onRetry={journal.reload} />
  if (!journal.data) return <Loading />
  return <DexPage journal={journal.data} reload={journal.reload} />
}

function DexPage({ journal, reload }: { journal: Journal; reload: () => void }) {
  const cards = journal.game.setupDex
  const archived = journal.setups.filter((s) => s.archived)
  const revealed = cards.filter((c) => c.revealed).length
  const thisMonth = monthKey(new Date())
  const checkedThisMonth = journal.setups.some((s) => s.reviewed_at && monthKey(s.reviewed_at) === thisMonth)
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setErrors([])
    try {
      await fn()
      reload()
      return true
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)])
      return false
    }
  }

  async function add() {
    const n = name.trim()
    if (!n) return
    if (await run(() => createSetup(n, journal.setups.length))) setName('')
  }

  return (
    <div className="space-y-5">
      <header className="flex items-baseline justify-between">
        <h1 className="sec-title" style={{ fontSize: 28 }}>
          圖鑑
        </h1>
        <span className="text-xs text-paper-dim">
          已鑑定 {revealed} / {cards.length} · 滿 {DEX_REVEAL_N} 筆才揭曉
        </span>
      </header>
      <p className="text-sm text-paper-dim">
        每種進場型態是一張卡。期望值是平均 R；鑑定後期望值為負就是詛咒卡。
        {checkedThisMonth ? '本月已檢查過圖鑑。' : '本月功課：挑一張卡決定保留或淘汰（+100）。'}
      </p>
      <Errors errors={errors} />

      {cards.length === 0 ? (
        <p className="py-6 text-center text-paper-dim">還沒有 Setup。在下面新增你常用的進場型態。</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {cards.map((c) => (
            <DexScroll key={c.setupId} c={c} thisMonth={thisMonth} run={run} />
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
          placeholder="新增 Setup，例如「突破回踩」"
        />
        <Button className="shrink-0" onClick={add}>
          新增
        </Button>
      </div>

      {archived.length > 0 && (
        <section>
          <h2 className="mb-2 font-brush text-lg text-paper-dim">已淘汰</h2>
          <ul className="divide-y divide-ink-line">
            {archived.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <span className="text-paper-dim line-through">{s.name}</span>
                <button type="button" className="min-h-11 px-2 text-sm text-moon" onClick={() => void run(() => updateSetup(s.id, { archived: false }))}>
                  恢復
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function DexScroll({ c, thisMonth, run }: { c: DexCard; thisMonth: string; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.name)
  const [deciding, setDeciding] = useState(false)
  const checked = c.reviewedAt !== null && monthKey(c.reviewedAt) === thisMonth
  const tone = !c.revealed ? 'var(--paper-dim)' : c.cursed ? 'var(--ochre)' : 'var(--jade)'

  async function rename() {
    const n = name.trim()
    if (n && n !== c.name && (await run(() => updateSetup(c.setupId, { name: n })))) setEditing(false)
    else setEditing(false)
  }

  return (
    <div className={`scroll${c.cursed ? ' curse' : ''}${c.revealed ? '' : ' veiled'}`} style={{ gap: 8 }}>
      {c.revealed ? (
        <Spark path={c.path} tone={tone} />
      ) : (
        <div className="veil">
          <Spark path={c.path} tone={tone} />
        </div>
      )}
      {editing ? (
        <input className={`${inputClass} text-sm`} value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} autoFocus />
      ) : (
        <button type="button" className="scroll-name text-left" onClick={() => setEditing(true)}>
          {c.name}
        </button>
      )}
      {c.revealed ? (
        <>
          <span className={`scroll-ev ${c.cursed ? 'c-ochre' : 'c-jade'}`}>{fmtR(c.ev!)}</span>
          <span className="scroll-n">
            {c.n} 筆 · 勝率 {fmtPct(c.winRate!)}
          </span>
          {c.cursed && <span className="mini-seal">詛咒</span>}
        </>
      ) : (
        <>
          <span className="scroll-ev data">？？？</span>
          <span className="scroll-n">
            {c.n} / {DEX_REVEAL_N} 筆
          </span>
        </>
      )}
      {checked ? (
        <span className="text-xs text-jade">本月已檢查 · 保留</span>
      ) : deciding ? (
        <div className="flex gap-1">
          <button type="button" className="min-h-10 flex-1 rounded-sm bg-jade/20 text-xs text-jade" onClick={() => void run(() => reviewSetup(c.setupId, true))}>
            保留
          </button>
          <button type="button" className="min-h-10 flex-1 rounded-sm bg-ochre/20 text-xs text-ochre" onClick={() => void run(() => reviewSetup(c.setupId, false))}>
            淘汰
          </button>
        </div>
      ) : (
        <button type="button" className="min-h-10 rounded-sm border border-ink-line text-xs text-paper-dim" onClick={() => setDeciding(true)}>
          檢查這張卡
        </button>
      )}
    </div>
  )
}
