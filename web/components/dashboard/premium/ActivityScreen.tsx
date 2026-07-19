import Link from 'next/link'
import type { DashboardData } from '@/lib/learning/dashboard-read'
import type { SessionQuota, RecentSession } from '@/lib/learning/activity-read'
import type { TrendPoint } from '@/components/dashboard/TrendChart'
import { C, glassCard, glassCardSoft, sheen, eyebrow, entrance } from './theme'
import { heatmap, answerBars, sessionsPerWeek } from './derive'

const MS_PER_DAY = 86_400_000

const cellPad = {
  position: 'relative' as const,
  padding: '15px 20px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
}
const cellSheen = {
  position: 'absolute' as const,
  inset: 0,
  background: 'linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0) 55%)',
  pointerEvents: 'none' as const,
}
const bigNum = { fontSize: 24, fontWeight: 600, lineHeight: '28px' }
const numSub = { fontSize: 12, color: C.muted }

function sessionDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function resetsInDays(iso: string | null): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return ms > 0 ? Math.ceil(ms / MS_PER_DAY) : 0
}

function TrendSvg({ points, now }: { points: TrendPoint[]; now: Date }) {
  const yFor = (m: number) => 142 - Math.max(0, Math.min(1, m)) * 126
  let poly = ''
  let dots: { x: number; y: number }[] = []
  if (points.length > 0) {
    const first = new Date(points[0].day + 'T00:00:00Z').getTime()
    const last = now.getTime()
    const span = Math.max(MS_PER_DAY, last - first)
    // Anchor the series on the right ~40% of the axis (it's forward-only/sparse).
    const xStart = 432.5
    const xEnd = 608.5
    const coords = points.map((p, i) => {
      const t = new Date(p.day + 'T00:00:00Z').getTime()
      const frac = points.length === 1 ? 1 : (t - first) / span
      const x = points.length === 1 ? xEnd : xStart + frac * (xEnd - xStart)
      void i
      return { x, y: yFor(p.mastery) }
    })
    poly = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
    dots = coords
  }
  return (
    <svg viewBox="0 0 640 170" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1="40" y1="16" x2="622" y2="16" stroke="rgba(28,28,26,.06)" strokeWidth="1" />
      <line x1="40" y1="47.5" x2="622" y2="47.5" stroke="rgba(28,28,26,.06)" strokeWidth="1" />
      <line x1="40" y1="79" x2="622" y2="79" stroke="rgba(28,28,26,.06)" strokeWidth="1" />
      <line x1="40" y1="110.5" x2="622" y2="110.5" stroke="rgba(28,28,26,.06)" strokeWidth="1" />
      <line x1="40" y1="142" x2="622" y2="142" stroke="rgba(28,28,26,.12)" strokeWidth="1" />
      <text x="34" y="19" textAnchor="end" fontSize="10" fill="#6b6b65">100%</text>
      <text x="34" y="82" textAnchor="end" fontSize="10" fill="#6b6b65">50%</text>
      <text x="34" y="145" textAnchor="end" fontSize="10" fill="#6b6b65">0%</text>
      {points.length > 1 && <polyline points={poly} fill="none" stroke="#166534" strokeWidth="2" strokeLinecap="round" />}
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r="3.5" fill="#166534" stroke="#ffffff" strokeWidth="1.5" />
      ))}
      {points.length === 0 && (
        <text x="180" y="85" fontSize="11" fill="#9a988f">No snapshots yet — the curve fills in as you practice</text>
      )}
    </svg>
  )
}

export function ActivityScreen({
  data,
  trend,
  quota,
  sessions,
}: {
  data: DashboardData
  trend: TrendPoint[]
  quota: SessionQuota
  sessions: RecentSession[]
}) {
  const now = new Date()
  const heat = heatmap(data, now)
  const bars = answerBars(data, now)
  const weeks = sessionsPerWeek(data, now)
  const resetDays = resetsInDays(quota.resetsAt)

  return (
    <section data-screen-label="Activity">
      <header style={{ marginBottom: 22, animation: 'cxPop .5s cubic-bezier(.3,1.4,.4,1) both' }}>
        <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>Activity</p>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: '34px', fontWeight: 600, letterSpacing: '-.015em' }}>How your studying adds up</h1>
      </header>

      {/* Free-session quota strip — this period's usage at a glance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', ...glassCardSoft, marginBottom: 16, ...entrance(0.04) }}>
        <div style={cellPad}>
          <span style={cellSheen} />
          <span style={eyebrow}>Free sessions left</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={bigNum}>{quota.isPro ? '∞' : quota.remaining}</span>
            <span style={numSub}>{quota.isPro ? 'unlimited on Plus' : `of ${quota.limit}`}</span>
          </span>
        </div>
        <div style={{ ...cellPad, borderLeft: `1px solid ${C.hair}` }}>
          <span style={cellSheen} />
          <span style={eyebrow}>Sessions this month</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={bigNum}>{quota.used}</span>
            <span style={numSub}>{quota.isPro ? 'logged' : 'logged this period'}</span>
          </span>
        </div>
        <div style={{ ...cellPad, borderLeft: `1px solid ${C.hair}` }}>
          <span style={cellSheen} />
          <span style={eyebrow}>{quota.isPro ? 'Plan' : 'Allowance resets'}</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={bigNum}>{quota.isPro ? 'Plus' : resetDays == null ? '—' : resetDays}</span>
            <span style={numSub}>
              {quota.isPro ? 'unlimited sessions' : resetDays == null ? '' : resetDays === 1 ? 'day' : 'days'}
            </span>
          </span>
        </div>
      </div>

      {/* Recent sessions — line by line, each linking to its study kit */}
      <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.06) }}>
        <span style={sheen} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 13 }}>
          <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 11, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4v4l2.5 1.5" /><circle cx="8" cy="8" r="6" /></svg>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
            <span style={eyebrow}>Your tutoring sessions · newest first</span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>Recent sessions</span>
          </span>
        </div>
        <div style={{ position: 'relative', height: 1, background: C.hair }} />
        {sessions.length === 0 ? (
          <p style={{ position: 'relative', margin: '14px 2px 2px', fontSize: 13, color: C.muted }}>
            No sessions yet — start one from the Calyxa pill on any math page and it’ll show up here.
          </p>
        ) : (
          <div style={{ position: 'relative' }}>
            {sessions.map((s, i) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '11px 2px',
                  borderTop: i === 0 ? 'none' : '1px solid rgba(28,28,26,.06)',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{sessionDateTime(s.startedAt)}</span>
                  <span
                    style={{
                      flex: 'none',
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: C.muted,
                      background: 'rgba(28,28,26,.06)',
                      borderRadius: 99,
                      padding: '2px 8px',
                    }}
                  >
                    {s.mode === 'voice' ? 'Voice' : 'Text'}
                  </span>
                  {s.endedAt == null && (
                    <span style={{ flex: 'none', fontSize: 11, color: C.amber }}>In progress</span>
                  )}
                </span>
                {s.kitHref ? (
                  <Link
                    href={s.kitHref}
                    className="cx-hover-mint"
                    style={{
                      flex: 'none',
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: C.greenDeep,
                      background: C.mint,
                      borderRadius: 99,
                      padding: '5px 13px',
                      textDecoration: 'none',
                    }}
                  >
                    View study kit →
                  </Link>
                ) : (
                  <span style={{ flex: 'none', fontSize: 12, color: C.faint }}>No study kit</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Heatmap */}
      <div style={{ ...glassCard, padding: '16px 19px', marginBottom: 16, ...entrance(0.08) }}>
        <span style={sheen} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 13 }}>
          <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 11, background: C.mintTile, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinejoin="round"><rect x="2" y="2" width="5.4" height="5.4" rx="1.2" /><rect x="8.6" y="2" width="5.4" height="5.4" rx="1.2" /><rect x="2" y="8.6" width="5.4" height="5.4" rx="1.2" /><rect x="8.6" y="8.6" width="5.4" height="5.4" rx="1.2" /></svg>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
            <span style={eyebrow}>Sessions per day · last 12 weeks</span>
            <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.005em' }}>Study heatmap</span>
          </span>
        </div>
        <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 14 }} />
        <div style={{ position: 'relative', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ display: 'grid', gridTemplateRows: 'repeat(7,16px)', rowGap: 3, fontSize: 10, color: C.muted }}>
            <span /><span style={{ lineHeight: '16px' }}>Mon</span><span /><span style={{ lineHeight: '16px' }}>Wed</span><span /><span style={{ lineHeight: '16px' }}>Fri</span><span />
          </div>
          <div style={{ display: 'grid', gridAutoFlow: 'column', gridTemplateRows: 'repeat(7,16px)', gridAutoColumns: '16px', gap: 3 }}>
            {heat.map((bg, i) => (
              <span key={i} style={{ borderRadius: 4, background: bg }} />
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end', marginTop: 12, fontSize: 11, color: C.muted }}>
          Less
          <span style={{ width: 12, height: 12, borderRadius: 4, background: 'rgba(28,28,26,.06)' }} />
          <span style={{ width: 12, height: 12, borderRadius: 4, background: '#bbf7d0' }} />
          <span style={{ width: 12, height: 12, borderRadius: 4, background: '#4ade80' }} />
          <span style={{ width: 12, height: 12, borderRadius: 4, background: '#1f9d5b' }} />
          More
        </div>
      </div>

      {/* Answers + Sessions per week */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 16, marginBottom: 16, alignItems: 'start' }}>
        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.16) }}>
          <span style={sheen} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={eyebrow}>Answers · last 14 days</span>
            <div style={{ display: 'flex', gap: 5 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: C.greenInk, background: C.greenBg, borderRadius: 99, padding: '3px 9px' }}>Correct</span>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: C.amber, background: 'rgba(146,64,14,.09)', borderRadius: 99, padding: '3px 9px' }}>Partial</span>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: C.red, background: C.redBg, borderRadius: 99, padding: '3px 9px' }}>Incorrect</span>
            </div>
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 6, height: 150 }}>
            {bars.map((b, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 150 }}>
                <div style={{ borderRadius: '3px 3px 0 0', background: '#b91c1c', height: b.hi }} />
                <div style={{ background: '#92400e', height: b.hp }} />
                <div style={{ borderRadius: '0 0 3px 3px', background: '#166534', height: b.hc }} />
                <div style={{ borderRadius: 3, background: 'rgba(28,28,26,.08)', height: b.hs, marginTop: 1 }} />
              </div>
            ))}
          </div>
          <div style={{ position: 'relative', display: 'flex', gap: 6, marginTop: 6 }}>
            {bars.map((b, i) => (
              <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: C.muted }}>{b.label}</span>
            ))}
          </div>
        </div>

        <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.22) }}>
          <span style={sheen} />
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <span style={eyebrow}>Sessions per week</span>
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 10, height: 150 }}>
            {weeks.map((w, i) => (
              <div key={i} style={{ flex: 1, height: w.height, borderRadius: '6px 6px 3px 3px', background: w.current ? '#4ade80' : '#bbf7d0', transformOrigin: 'bottom', animation: i === 0 ? 'cxGrow .8s cubic-bezier(.3,1.2,.4,1) .3s both' : undefined }} />
            ))}
          </div>
          <div style={{ position: 'relative', display: 'flex', gap: 10, marginTop: 6 }}>
            {weeks.map((w, i) => (
              <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: C.muted }}>{w.label}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Mastery over time */}
      <div style={{ ...glassCard, padding: '16px 19px', ...entrance(0.28) }}>
        <span style={sheen} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={eyebrow}>Mastery over time</span>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: C.muted, border: '1px dashed #c9c7c0', borderRadius: 99, padding: '1px 6px' }}>Forward&#8209;only</span>
        </div>
        <p style={{ position: 'relative', margin: '0 0 10px', fontSize: 12.5, color: C.muted }}>
          {trend.length > 0
            ? `Builds as you practice — ${trend.length} data point${trend.length === 1 ? '' : 's'} so far. Give it a few weeks.`
            : 'Builds as you practice — the daily snapshot starts the trend. Give it a few weeks.'}
        </p>
        <div style={{ position: 'relative' }}>
          <TrendSvg points={trend} now={now} />
        </div>
      </div>
    </section>
  )
}
