import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Errors, LoadError, Loading } from '../components/ui'
import Radar from '../components/home/Radar'
import { ACHIEVEMENTS, CLASS_DESCRIPTIONS, VIOLATION_LABELS } from '../game/rules'
import { buildInfo, signOut, storageUsageBytes, updateSettings } from '../lib/db'
import { fmtR } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { type Journal, useJournal } from '../lib/useJournal'

const STORAGE_LIMIT_MB = 1024

export default function Character() {
  const journal = useJournal()
  if (journal.error) return <LoadError error={journal.error} onRetry={journal.reload} />
  if (!journal.data) return <Loading />
  return <CharacterPage journal={journal.data} reload={journal.reload} />
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-ink-line py-5 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="sec-title">{title}</h2>
        {note && <span className="text-xs text-paper-dim">{note}</span>}
      </div>
      {children}
    </section>
  )
}

function CharacterPage({ journal, reload }: { journal: Journal; reload: () => void }) {
  const { game } = journal
  const { profile, recap } = game
  const [errors, setErrors] = useState<string[]>([])
  const usage = useAsync(storageUsageBytes, [])

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


  const usedMb = usage.data === undefined ? null : usage.data / 1024 / 1024

  return (
    <div>
      <Section title="角色">
        <div>
          <p className="font-brush text-4xl leading-tight">{profile.title}</p>
          <p className="mt-1 text-sm text-paper-dim">
            Lv.{profile.level} · {profile.className ? `${profile.className} · ${CLASS_DESCRIPTIONS[profile.className]}` : '職業未定（本季滿 10 筆）'}
          </p>
          <p className="data mt-1 text-xs text-paper-dim">
            經驗值 {profile.xp.toLocaleString()} / {profile.xpToNext.toLocaleString()} · 累計 {profile.totalXp.toLocaleString()}
          </p>
        </div>
        <p className="text-xs text-paper-dim">經驗值只來自過程（作戰卡、復盤、評級、功課），盈虧不給任何經驗值。</p>
      </Section>

      <Section title="稱號" note="擊敗心魔或解成就取得">
        <div className="flex flex-wrap gap-2">
          {[profile.levelTitle, ...profile.titles].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => void run(() => updateSettings({ display_title: t === profile.levelTitle ? null : t }))}
              className={`min-h-10 rounded-sm px-3 font-brush ${profile.title === t ? 'bg-moon text-ink' : 'border border-ink-line text-paper-dim'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {profile.titles.length === 0 && <p className="text-xs text-paper-dim">還沒有收藏的稱號。等級稱號會隨等級自動變化。</p>}
      </Section>

      {game.attributes && (
        <Section title="屬性" note={`本季 · ${game.season.tradeCount} 筆`}>
          <Radar values={game.attributes.values} weakest={game.attributes.weakest} />
        </Section>
      )}

      <Section title="成就" note={`${game.achievements.size} / ${ACHIEVEMENTS.length}`}>
        <ul className="divide-y divide-ink-line">
          {ACHIEVEMENTS.map((a) => {
            const got = game.achievements.has(a.id)
            const hidden = a.hidden && !got
            return (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <span className={`seal small ${got ? 'red' : 'line grey'}`}>{got ? '成' : '？'}</span>
                <div className="min-w-0 flex-1">
                  <p className={`font-brush text-lg ${got ? '' : 'text-paper-dim'}`}>{hidden ? '？？？' : a.name}</p>
                  <p className="text-xs text-paper-dim">{hidden ? '隱藏成就' : a.condition}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </Section>

      {recap && (
        <Section title={`${recap.season.name}回顧`} note="上季結算">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-paper-dim">總 R</p>
              <p className={`data text-xl ${recap.season.totalR >= 0 ? 'c-jade' : 'c-ochre'}`}>{fmtR(recap.season.totalR)}</p>
            </div>
            <div>
              <p className="text-paper-dim">紀律分數</p>
              <p className="data text-xl c-moon">{recap.season.disciplineScore ?? '—'}</p>
            </div>
            {recap.best && (
              <Link to={`/trade/${recap.best.trade.id}`}>
                <p className="text-paper-dim">最佳</p>
                <p>
                  {recap.best.trade.symbol} <span className="data c-jade">{fmtR(recap.best.r!)}</span>
                </p>
              </Link>
            )}
            {recap.worst && (
              <Link to={`/trade/${recap.worst.trade.id}`}>
                <p className="text-paper-dim">最差</p>
                <p>
                  {recap.worst.trade.symbol} <span className="data c-ochre">{fmtR(recap.worst.r!)}</span>
                </p>
              </Link>
            )}
          </div>
          <p className="text-sm text-paper-dim">
            心魔：{recap.boss ? `${recap.boss.name}（${VIOLATION_LABELS[recap.boss.violation]}）${recap.boss.defeated ? '，已擊敗' : `，剩 ${recap.boss.hp} 血`}` : '無'}
          </p>
          {recap.attributeDelta && (
            <p className="text-sm text-paper-dim">
              屬性變化：
              {recap.attributeDelta.map((d) => (
                <span key={d.key} className="mr-2">
                  {d.key} <span className={`data ${d.delta >= 0 ? 'c-jade' : 'c-ochre'}`}>{d.delta >= 0 ? `+${d.delta}` : `−${-d.delta}`}</span>
                </span>
              ))}
            </p>
          )}
        </Section>
      )}

      <Section title="設定">
        <Errors errors={errors} />
        <div>
          <p className="text-sm text-paper-dim">截圖儲存用量</p>
          {usedMb === null ? (
            <p className="text-sm text-paper-dim">計算中…</p>
          ) : (
            <>
              <p className="data text-sm">
                {usedMb.toFixed(1)} MB / {STORAGE_LIMIT_MB} MB
              </p>
              <div className="mt-1 h-0.5 bg-ink-line">
                <div className="h-0.5 bg-moon" style={{ width: `${Math.min(100, (usedMb / STORAGE_LIMIT_MB) * 100)}%` }} />
              </div>
            </>
          )}
        </div>
        <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
          登出
        </Button>
        <p className="text-center text-xs text-paper-dim/60">{buildInfo}</p>
      </Section>
    </div>
  )
}
