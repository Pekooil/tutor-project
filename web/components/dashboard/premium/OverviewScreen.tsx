import Link from 'next/link'
import type { DashboardData } from '@/lib/learning/dashboard-read'
import { GlassCard, CardHead, Badge } from './primitives'
import { C, glassCardSoft, eyebrow, pillAction, entrance } from './theme'
import { kitHrefForConcept, type StudyKit } from './kits-read'
import {
  greeting,
  longDate,
  overviewStats,
  practiceNext,
  ovStrands,
  recentActivity,
  monthCalendar,
  conceptStates,
} from './derive'

const cellPad = { position: 'relative' as const, padding: '15px 20px', display: 'flex', flexDirection: 'column' as const, gap: 4 }

export function OverviewScreen({
  data,
  now,
  firstName,
  totalCurriculum,
  kits,
}: {
  data: DashboardData
  now: Date
  firstName: string
  totalCurriculum: number
  kits: StudyKit[]
}) {
  const stats = overviewStats(data)
  const practice = practiceNext(data).map((r) => ({ ...r, kitHref: kitHrefForConcept(kits, r.conceptKey) }))
  const strands = ovStrands(data)
  const events = recentActivity(data)
  const cal = monthCalendar(data, now)
  const states = conceptStates(data, totalCurriculum)

  return (
    <section data-screen-label="Overview">
      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 22, ...entrance(0.06) }}>
        <div>
          <p style={{ margin: '0 0 7px', fontSize: 10, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.muted }}>
            {longDate(now)}
          </p>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: '38px', fontWeight: 600, letterSpacing: '-.015em' }}>
            {greeting(now)}, {firstName}
          </h1>
          <p style={{ margin: '8px 0 0', fontSize: 14.5, color: C.muted }}>
            {stats.activeMisconceptions > 0
              ? `${stats.activeMisconceptions} misconception${stats.activeMisconceptions === 1 ? '' : 's'} to work through — practice with your study kits.`
              : 'No open misconceptions right now — nice work. Keep studying and Calyxa will flag the next one.'}
          </p>
        </div>
        {stats.activeMisconceptions > 0 && (
          <div style={{ position: 'relative', flex: 'none', marginBottom: 4 }}>
            <span style={{ position: 'absolute', inset: -6, borderRadius: 99, background: 'radial-gradient(closest-side,rgba(187,247,208,.95),rgba(74,222,128,.5),rgba(74,222,128,0))', filter: 'blur(11px)', animation: 'cxBreathe 3s ease-in-out infinite' }} />
            <Link href="/kits" style={{ position: 'relative', border: 'none', borderRadius: 99, background: C.mint, color: C.greenDeep, fontSize: 14.5, fontWeight: 600, padding: '12px 24px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(28,40,30,.14)', textDecoration: 'none', display: 'inline-block' }}>
              Start practicing &middot; {stats.activeMisconceptions}
            </Link>
          </div>
        )}
      </header>

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', ...glassCardSoft, marginBottom: 16, ...entrance(0.12) }}>
        <div style={cellPad}>
          <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0) 55%)', pointerEvents: 'none' }} />
          <span style={eyebrow}>Mastered</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 600, lineHeight: '28px' }}>{stats.mastered}</span>
            <span style={{ fontSize: 12, color: C.muted }}>{stats.masteredSub}</span>
          </span>
        </div>
        <div style={{ ...cellPad, borderLeft: `1px solid ${C.hair}` }}>
          <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0) 55%)', pointerEvents: 'none' }} />
          <span style={eyebrow}>To practice</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 600, lineHeight: '28px' }}>{stats.activeMisconceptions}</span>
            <span style={{ fontSize: 12, color: C.muted }}>misconception{stats.activeMisconceptions === 1 ? '' : 's'}</span>
          </span>
        </div>
        <div style={{ ...cellPad, borderLeft: `1px solid ${C.hair}` }}>
          <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0) 55%)', pointerEvents: 'none' }} />
          <span style={eyebrow}>Accuracy</span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 600, lineHeight: '28px' }}>{stats.accuracy != null ? stats.accuracy + '%' : '—'}</span>
            <span style={{ fontSize: 12, color: C.muted }}>{stats.accuracySub}</span>
          </span>
        </div>
        <div style={{ ...cellPad, borderLeft: `1px solid ${C.hair}` }}>
          <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,0) 55%)', pointerEvents: 'none' }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={eyebrow}>Day streak</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 600, lineHeight: '28px' }}>{stats.streak}</span>
            {stats.streakSince && (
              <span style={{ fontSize: 12, color: C.muted }}>
                since {new Date(stats.streakSince + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Practice next — active misconceptions to work through */}
      <GlassCard style={{ padding: '16px 14px 14px', marginBottom: 16, ...entrance(0.18) }}>
        <CardHead
          icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.8 L9.9 5.7 L14.2 6.3 L11.1 9.3 L11.8 13.6 L8 11.5 L4.2 13.6 L4.9 9.3 L1.8 6.3 L6.1 5.7 Z" /></svg>}
          kicker="Practice next"
          title={practice.length > 0 ? 'Misconceptions to work through' : 'Nothing to practice right now'}
          right={<Link href="/misconceptions" className="cx-hover-pill" style={pillAction}>All misconceptions &rarr;</Link>}
          divider={false}
        />
        <div style={{ position: 'relative', height: 1, background: C.hair, margin: '0 5px 6px' }} />
        {practice.length > 0 ? (
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {practice.map((row) => (
              <Link key={row.id} href={row.kitHref ? `/kits/${row.kitHref}` : `/misconceptions/${row.id}`} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px', borderRadius: 12, textDecoration: 'none', color: C.ink }}>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{row.title}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{row.sub}</span>
                </span>
                {row.kitHref ? (
                  <span style={{ flex: 'none', fontSize: 12, fontWeight: 600, color: C.greenDeep, background: C.mintPill, borderRadius: 99, padding: '4px 11px' }}>Open kit &rarr;</span>
                ) : (
                  <Badge bg="rgba(28,28,26,.05)" color={C.muted} style={{ flex: 'none', letterSpacing: '.09em', padding: '3px 9px' }}>{row.streak}</Badge>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p style={{ position: 'relative', margin: '4px 10px 6px', fontSize: 13, color: C.muted }}>
            No open misconceptions. When a session surfaces one, Calyxa builds a study kit here to practice it.
          </p>
        )}
      </GlassCard>

      {/* Mastery mini + Recent activity */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.08fr) minmax(0,1fr)', gap: 16, marginBottom: 16, alignItems: 'start' }}>
        <GlassCard style={{ padding: '16px 17px 14px', ...entrance(0.24) }}>
          <CardHead
            icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5"><circle cx="8" cy="8" r="5.6" /><circle cx="8" cy="8" r="2" /></svg>}
            kicker="Mastery"
            title="By strand"
            right={<Link href="/mastery" className="cx-hover-pill" style={pillAction}>All concepts &rarr;</Link>}
          />
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {strands.rows.map((s) => (
              <div key={s.short} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 8px', borderRadius: 12, background: s.rowBg }}>
                <span style={{ width: 118, flex: 'none', fontSize: 13, fontWeight: 500 }}>{s.short}</span>
                <span style={{ flex: 1, height: 7, borderRadius: 99, background: 'rgba(28,28,26,.06)', overflow: 'hidden', display: 'block' }}>
                  <span style={{ display: 'block', width: s.width, height: 7, borderRadius: 99, background: s.color, transformOrigin: 'left', animation: `cxGrow .9s cubic-bezier(.3,1.2,.4,1) ${s.delay} both` }} />
                </span>
                <span style={{ flex: 'none', width: 44, textAlign: 'center', fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: '2px 0', background: s.pctBg, color: s.pctColor }}>{s.pct}</span>
              </div>
            ))}
          </div>
          {strands.attention && (
            <p style={{ position: 'relative', margin: '8px 5px 0', paddingTop: 12, borderTop: `1px solid ${C.hair}`, fontSize: 12, color: C.muted }}>{strands.attention}</p>
          )}
        </GlassCard>

        <GlassCard style={{ padding: '16px 17px 14px', ...entrance(0.3) }}>
          <CardHead
            icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1.8 8.6 H4.6 L6.4 4.4 L9.6 11.6 L11.4 8.6 H14.2" /></svg>}
            kicker="Recent activity"
            title="Latest"
            right={<span style={{ fontSize: 11, background: 'linear-gradient(90deg,#6b6b65 25%,#1c1c1a 50%,#6b6b65 75%)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', animation: 'cxShimmer 1.6s linear infinite' }}>Updated just now</span>}
          />
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
            {events.length > 0 ? (
              events.map((e) => (
                <div key={e.key} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 8px', borderRadius: 12 }}>
                  <span style={{ flex: 'none', width: 64, textAlign: 'center', fontSize: 10, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: e.tagColor, background: e.tagBg, padding: '3px 0', borderRadius: 99, marginTop: 1 }}>{e.tag}</span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}>{e.title}</span>
                    <span style={{ fontSize: 12, color: C.muted }}>{e.detail}</span>
                  </span>
                  <span style={{ flex: 'none', fontSize: 11.5, color: C.muted, marginTop: 2 }}>{e.when}</span>
                </div>
              ))
            ) : (
              <p style={{ fontSize: 13, color: C.muted, padding: '9px 8px' }}>No activity yet — your sessions will show up here.</p>
            )}
          </div>
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', marginTop: 6, paddingTop: 11, borderTop: `1px solid ${C.hair}` }}>
            <Link href="/activity" className="cx-hover-pill" style={pillAction}>All activity &rarr;</Link>
          </div>
        </GlassCard>
      </div>

      {/* Calendar + Concept states */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.08fr)', gap: 16, alignItems: 'start' }}>
        <GlassCard style={{ padding: '16px 17px 15px', ...entrance(0.36) }}>
          <CardHead
            icon={<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.4" y="3.2" width="11.2" height="10" rx="1.8" /><path d="M2.4 6.4 H13.6" /><path d="M5.4 1.8 V4" /><path d="M10.6 1.8 V4" /></svg>}
            kicker="This month"
            title={now.toLocaleDateString(undefined, { month: 'long' })}
            right={<Badge bg={C.greenBg} color={C.greenInk}>Studied</Badge>}
            divider={false}
          />
          <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 10 }} />
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, marginBottom: 5 }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={i} style={{ textAlign: 'center', fontSize: 9.5, fontWeight: 600, letterSpacing: '.1em', color: C.muted }}>{d}</span>
            ))}
          </div>
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
            {cal.cells.map((c, i) => (
              <div key={i} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 38, borderRadius: 11, background: c.bg, color: c.color, fontSize: 12, fontWeight: c.weight }}>
                {c.today && (
                  <>
                    <span style={{ position: 'absolute', inset: -3, borderRadius: 13, background: 'radial-gradient(closest-side,rgba(187,247,208,.9),rgba(74,222,128,.4),rgba(74,222,128,0))', filter: 'blur(7px)', animation: 'cxBreathe 3s ease-in-out infinite', pointerEvents: 'none' }} />
                    <span style={{ position: 'absolute', inset: 0, borderRadius: 11, background: '#86efac' }} />
                  </>
                )}
                <span style={{ position: 'relative' }}>{c.n}</span>
                <span style={{ position: 'relative', display: 'flex', gap: 2.5, marginTop: 2, height: 4 }}>
                  <span style={{ width: 4, height: 4, borderRadius: 99, background: c.studiedDot ? '#4ade80' : 'transparent' }} />
                </span>
              </div>
            ))}
          </div>
          <p style={{ position: 'relative', margin: '12px 0 0', paddingTop: 11, borderTop: `1px solid ${C.hair}`, fontSize: 12, color: C.muted }}>{cal.footer}</p>
        </GlassCard>

        <GlassCard style={{ padding: '16px 17px 14px', ...entrance(0.42) }}>
          <CardHead
            icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2.4 A5.6 5.6 0 1 1 3.2 5.2" /><path d="M8 8 V2.4" /></svg>}
            kicker="Concept states"
            title="Where concepts stand"
            right={<Badge bg={C.greenBg} color={C.greenInk} style={{ letterSpacing: '.07em' }}>{states.practiced} of {states.total}</Badge>}
            divider={false}
          />
          <div style={{ position: 'relative', height: 1, background: C.hair, marginBottom: 16 }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 22, padding: '0 4px' }}>
            <div style={{ position: 'relative', flex: 'none' }}>
              <span style={{ position: 'absolute', inset: -8, borderRadius: 99, background: 'radial-gradient(closest-side,rgba(187,247,208,.7),rgba(74,222,128,.3),rgba(74,222,128,0))', filter: 'blur(12px)', animation: 'cxBreathe 3s ease-in-out infinite', pointerEvents: 'none' }} />
              <div style={{ position: 'relative', width: 138, height: 138, borderRadius: 99, background: states.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 28px rgba(28,40,30,.16)' }}>
                <div style={{ width: 98, height: 98, borderRadius: 99, background: 'rgba(255,255,255,.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8)' }}>
                  <span style={{ fontSize: 25, fontWeight: 600, lineHeight: '29px', letterSpacing: '-.01em' }}>{states.practiced}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted }}>practiced</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
              {states.legend.map((l) => (
                <div key={l.label} className="cx-hover-soft" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px', borderRadius: 10 }}>
                  <span style={{ width: 8, height: 8, flex: 'none', borderRadius: 99, background: l.dot }} />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{l.label}</span>
                  <span style={{ marginLeft: 'auto', flex: 'none', minWidth: 30, textAlign: 'center', fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: '2px 8px', background: l.chipBg, color: l.chipColor }}>{l.count}</span>
                </div>
              ))}
            </div>
          </div>
          <p style={{ position: 'relative', margin: '16px 5px 0', paddingTop: 12, borderTop: `1px solid ${C.hair}`, fontSize: 12, color: C.muted }}>{states.notCovered} not yet covered — they appear as you meet them</p>
        </GlassCard>
      </div>
    </section>
  )
}
