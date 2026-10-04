import { Link, useNavigate } from 'react-router-dom'
import { Ring, Spark, TradeRow, fmtCountdown, useNow } from '../components/game'
import Radar from '../components/home/Radar'
import Scene, { fmtR1 } from '../components/home/Scene'
import { LoadError, Loading } from '../components/ui'
import { fmtR } from '../lib/format'
import { CLASS_DESCRIPTIONS, DEBUFF_NAMES, DEX_REVEAL_N, TIERS } from '../game/rules'
import { tpe } from '../lib/tz'
import { useJournal } from '../lib/useJournal'

const WEEKDAYS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']

const FlameIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3.3a2.5 2.5 0 0 0 2.5 2.8z" />
  </svg>
)

export default function Home() {
  const { data, error, reload } = useJournal()
  const navigate = useNavigate()
  const now = useNow()

  if (error) return <div className="px-[18px] pt-[calc(env(safe-area-inset-top)+2rem)]"><LoadError error={error} onRetry={reload} /></div>
  if (!data) return <div className="pt-[calc(env(safe-area-inset-top)+2rem)]"><Loading /></div>

  const { game, setupNames, settings } = data
  const { profile, tier, daily, season } = game
  const t = tpe(now)
  const eyebrow = `${String(t.getUTCMonth() + 1).padStart(2, '0')}.${String(t.getUTCDate()).padStart(2, '0')} ${WEEKDAYS[t.getUTCDay()]} · ${season.name} 第 ${season.dayIndex} 天`
  const sub = `Lv.${profile.level} · ${profile.className ? `${profile.className} · ${CLASS_DESCRIPTIONS[profile.className]}` : '職業未定（本季滿 10 筆）'}`
  const debuffs = game.debuffs.filter((d) => Date.parse(d.endsAt) > now.getTime())

  // 倉位梯子：見習 0%、正式 50%、老手 100%
  const ladderDone =
    tier.level === 3 ? 100 : tier.level === 2 ? 50 + 50 * Math.min(1, tier.progress / 50) : 50 * Math.min(1, tier.progress / 30)
  const prevTier = TIERS[Math.max(0, tier.level - 2)]

  const boss = game.boss
  const dex = [...game.setupDex].sort((a, b) => Number(b.revealed) - Number(a.revealed) || b.n - a.n)
  const revealedCount = game.setupDex.filter((c) => c.revealed).length

  return (
    <div>
      <Scene
        rs={season.rs}
        hp={daily.hp}
        hpHint={daily.hp >= 60 ? daily.hpHint : daily.hpLabel}
        eyebrow={eyebrow}
        title={profile.title}
        sub={sub}
        xp={profile.xp}
        xpToNext={profile.xpToNext}
        maxDrawdownPct={season.maxDrawdownPct}
      />

      <main className="page">
        {settings.starting_equity === null && (
          <section className="sec">
            <Link to="/me" className="hint" style={{ color: 'var(--ochre)' }}>
              還沒設定帳戶起始權益，風險 % 與倉位上限都算不出來。點這裡到「角色」設定 →
            </Link>
          </section>
        )}

        {/* 狀態異常 */}
        <section className="sec" aria-label="狀態異常">
          {debuffs.length === 0 ? (
            <div className="debuff">
              <div className="blot" style={{ color: 'var(--jade)', background: 'radial-gradient(circle at 45% 40%, rgba(138,207,186,0.3), rgba(138,207,186,0.06) 70%)' }}>
                ○
              </div>
              <div>
                <div className="debuff-name" style={{ color: 'var(--jade)' }}>
                  狀態正常
                </div>
                <p>精神力 {daily.hpLabel}。</p>
              </div>
            </div>
          ) : (
            debuffs.map((d) => (
              <div className="debuff" key={d.kind}>
                <div className="blot">{FlameIcon}</div>
                <div>
                  <div className="debuff-name">
                    {DEBUFF_NAMES[d.kind]}
                    <span className="data">
                      {d.kind === 'cooldown' ? '冷卻 ' : '剩 '}
                      {fmtCountdown(Date.parse(d.endsAt) - now.getTime())}
                    </span>
                  </div>
                  <p>{d.kind === 'cooldown' ? `上一筆虧損後 ${Math.floor((now.getTime() - (Date.parse(d.endsAt) - 15 * 60_000)) / 60_000)} 分鐘。冷卻期間開單會記為上頭：評分上限 B、倉位降一階。` : d.detail}</p>
                </div>
              </div>
            ))
          )}
          <button className="slip" type="button" onClick={() => navigate('/card/new')}>
            <span>
              <span className="slip-title">立作戰卡</span>
              <br />
              <span className="slip-sub">進場前存檔，才拿得到完整經驗值</span>
            </span>
            <span className="slip-xp">+20</span>
          </button>
          <span className="sec-note">
            今日 <span className="data">{daily.tradeCount}</span> 筆 · <span className="data">{fmtR1(daily.totalR)}</span>
          </span>
        </section>

        {/* 倉位階級 */}
        <section className="sec" aria-labelledby="tier-h">
          <div className="sec-head">
            <h2 className="sec-title" id="tier-h">
              倉位
            </h2>
            <span className="sec-note">用紀律換風險額度</span>
          </div>
          <div className="tier-top">
            <div className="tier-name">
              {tier.name}
              <small>第{['一', '二', '三'][tier.level - 1]}階</small>
            </div>
            <div className="tier-cap">
              {tier.capPct.toFixed(1)}%
              <small>單筆風險上限</small>
            </div>
          </div>
          <div className="ladder" aria-hidden="true">
            <div className="ladder-line" />
            <div className="ladder-done" style={{ width: `${ladderDone}%` }} />
            {TIERS.map((def, i) => (
              <div key={def.level} className={`rung${def.level === tier.level ? ' on' : def.level < tier.level ? ' past' : ''}`} style={{ left: `${i * 50}%` }}>
                <i />
                <span>
                  {def.name}
                  <b>{def.capPct.toFixed(1)}%</b>
                </span>
              </div>
            ))}
          </div>
          <div className="conds">
            {tier.progressTarget !== null ? (
              <div className="cond">
                <span>晉升{TIERS[tier.level].name}：A 以上交易</span>
                <span className="data">
                  {tier.progress} / {tier.progressTarget}
                </span>
              </div>
            ) : (
              <div className="cond">
                <span>已是最高階</span>
              </div>
            )}
            {tier.level >= 2 && (
              <div className="cond">
                <span>本季最大回撤低於 8%</span>
                <span className={`data ${tier.ddOk ? 'ok' : 'c-ochre'}`}>
                  {season.maxDrawdownPct === null ? '—' : `${season.maxDrawdownPct}%`} {tier.ddOk ? '達標' : '未達標'}
                </span>
              </div>
            )}
          </div>
          <span className="warn-line">
            觸發「上頭」會{tier.level > 1 ? `降回${prevTier.name}（${prevTier.capPct.toFixed(1)}%）` : '讓晉升進度歸零'}
          </span>
        </section>

        {/* 屬性 */}
        <section className="sec" aria-labelledby="stat-h">
          <div className="sec-head">
            <h2 className="sec-title" id="stat-h">
              屬性
            </h2>
            <span className="sec-note">本季 · {season.tradeCount} 筆</span>
          </div>
          {game.attributes ? (
            <>
              <Radar values={game.attributes.values} weakest={game.attributes.weakest} />
              <p className="hint" style={{ margin: 0 }}>
                <b>最弱是{game.attributes.weakest}。</b>
                {game.attributes.advice}。
              </p>
            </>
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              本季有評分的交易滿 5 筆才顯示屬性。
            </p>
          )}
        </section>

        {/* 心魔 */}
        <section className="sec demon" aria-labelledby="demon-h">
          <span className="demon-glyph" aria-hidden="true">
            魔
          </span>
          <div className="sec-head">
            <h2 className="sec-title" id="demon-h" style={{ fontSize: 15, fontWeight: 400, color: 'var(--paper-dim)' }}>
              本月心魔
            </h2>
          </div>
          {boss ? (
            <>
              <div className="demon-name">
                {boss.name}
                {boss.defeated && <span className="mini-seal" style={{ marginLeft: 10, fontSize: 13 }}>已擊敗</span>}
              </div>
              <div className="tally" role="img" aria-label={`已守住 ${boss.maxHp - boss.hp} 筆，剩 ${boss.hp} 筆`}>
                {Array.from({ length: boss.maxHp }, (_, i) => (
                  <span key={i} className={i < boss.maxHp - boss.hp ? 'hit' : undefined} />
                ))}
              </div>
              <p>
                {boss.defeated ? (
                  <>
                    已擊敗，得到稱號「{boss.reward}」。
                  </>
                ) : (
                  <>
                    已連續 <b>{boss.maxHp - boss.hp}</b> 筆{boss.description}。再守 <b>{boss.hp}</b> 筆就能擊敗它，換得稱號「{boss.reward}」。
                  </>
                )}
              </p>
            </>
          ) : (
            <p>本月無心魔。上個月沒有任何違規。</p>
          )}
        </section>

        {/* 功課 */}
        <section className="sec" aria-labelledby="quest-h">
          <div className="sec-head">
            <h2 className="sec-title" id="quest-h">
              功課
            </h2>
            <span className="sec-note">連續 {game.streak} 天 · 休息日也算</span>
          </div>
          <div className="quests">
            {game.quests.map((q) => (
              <button key={q.id} type="button" className={`quest${q.done ? ' done' : ''}`} aria-pressed={q.done} onClick={() => navigate(q.href)}>
                <Ring done={q.done} />
                <span className="quest-label">
                  {q.label}
                  {q.progress && <span className="data">{q.progress}</span>}
                </span>
                <span className="quest-xp">+{q.xp}</span>
              </button>
            ))}
          </div>
        </section>

        {/* 近事 */}
        <section className="sec" aria-labelledby="trade-h">
          <div className="sec-head">
            <h2 className="sec-title" id="trade-h">
              近事
            </h2>
            <Link to="/log" className="sec-note">
              全部紀錄
            </Link>
          </div>
          {game.recentTrades.length ? (
            <div className="trades">
              {game.recentTrades.map((e, i) => (
                <TradeRow key={e.trade.id} e={e} index={i} setupName={e.trade.setup_id ? setupNames.get(e.trade.setup_id) : undefined} />
              ))}
            </div>
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              還沒有平倉的交易。
            </p>
          )}
        </section>

        {/* 圖鑑 */}
        <section className="sec" aria-labelledby="dex-h">
          <div className="sec-head">
            <h2 className="sec-title" id="dex-h">
              圖鑑
            </h2>
            <Link to="/dex" className="sec-note">
              已鑑定 {revealedCount} / {game.setupDex.length} · 滿 {DEX_REVEAL_N} 筆才揭曉
            </Link>
          </div>
          {dex.length ? (
            <div className="scrolls">
              {dex.slice(0, 3).map((c) =>
                c.revealed ? (
                  <Link to="/dex" key={c.setupId} className={`scroll${c.cursed ? ' curse' : ''}`}>
                    <Spark path={c.path} tone={c.cursed ? 'var(--ochre)' : 'var(--jade)'} />
                    <span className="scroll-name">{c.name}</span>
                    <span className={`scroll-ev ${c.cursed ? 'c-ochre' : 'c-jade'}`}>{fmtR(c.ev!)}</span>
                    {c.cursed ? <span className="mini-seal">詛咒 · {c.n} 筆</span> : <span className="scroll-n">{c.n} 筆 · 已鑑定</span>}
                  </Link>
                ) : (
                  <Link to="/dex" key={c.setupId} className="scroll veiled">
                    <div className="veil">
                      <Spark path={c.path} tone="var(--paper-dim)" />
                    </div>
                    <span className="scroll-name">{c.name}</span>
                    <span className="scroll-ev data">？？？</span>
                    <span className="scroll-n">
                      {c.n} / {DEX_REVEAL_N} 筆
                    </span>
                  </Link>
                ),
              )}
            </div>
          ) : (
            <Link to="/dex" className="hint">
              還沒有 Setup。到圖鑑新增你常用的進場型態 →
            </Link>
          )}
        </section>

        {/* 賽季落款 */}
        <section className="sec" aria-label="賽季">
          <div className="colophon">
            <div>
              <div className="k">{season.name}</div>
              <div className="s">剩 {season.daysLeft} 天 · 結算時生成回顧卡</div>
            </div>
            <div className="score">
              <div className="s">紀律分數</div>
              <div className="data">{season.disciplineScore ?? '—'}</div>
            </div>
          </div>
          {game.recap && (
            <Link to="/me" className="sample-note">
              上季回顧卡已生成 →
            </Link>
          )}
        </section>
      </main>
    </div>
  )
}
