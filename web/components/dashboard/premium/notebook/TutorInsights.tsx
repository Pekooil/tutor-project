import type { TutorInsights as TutorInsightsData } from '../notebook-read'
import { C, glassCard, sheen, eyebrow, pct } from '../theme'

// Tutor Insights (redesign, brief §"Student Profile") — how the student learns,
// NOT concept-specific. Pinned at the top of the notebook. Every metric is
// derived from real learning data; we deliberately DON'T fabricate the signals
// Calyxa doesn't yet track (hint usage, "favorite explanation style"), so the
// panel shows only what's true and stays honest as those signals get built.

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={eyebrow}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.01em' }}>{value}</span>
        {sub && <span style={{ fontSize: 11.5, color: C.muted }}>{sub}</span>}
      </span>
    </div>
  )
}

export function TutorInsights({ insights }: { insights: TutorInsightsData }) {
  const {
    subjectsMastered,
    mistakePatterns,
    activeMisconceptions,
    resolvedMisconceptions,
    accuracy,
    streak,
    sessionCount,
    avgStudyMinutes,
    practicesToMastery,
    masteredConcepts,
    practicedConcepts,
  } = insights

  const hasAny =
    subjectsMastered.length > 0 || mistakePatterns.length > 0 || accuracy != null || sessionCount > 0

  return (
    <section id="insights" className="nb-anchor" style={{ ...glassCard, padding: '20px 22px', marginBottom: 26 }}>
      <span style={sheen} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span
            style={{
              flex: 'none',
              width: 30,
              height: 30,
              borderRadius: 9,
              background: 'rgba(134,239,172,.24)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#166534" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="5.2" r="2.6" />
              <path d="M3.2 13 C3.9 10.4 5.8 9.2 8 9.2 C10.2 9.2 12.1 10.4 12.8 13" />
            </svg>
          </span>
          <div>
            <span style={eyebrow}>Tutor insights</span>
            <h2 style={{ margin: '1px 0 0', fontSize: 18, fontWeight: 600, letterSpacing: '-.01em' }}>How you learn</h2>
          </div>
        </div>
        <p style={{ margin: '4px 0 16px', fontSize: 13, color: C.muted }}>
          What your tutor has quietly noticed across every session.
        </p>

        {!hasAny ? (
          <p style={{ margin: 0, fontSize: 13.5, color: C.muted }}>
            Your learning profile fills in as you study. Start a session with the Calyxa extension and your patterns
            will appear here.
          </p>
        ) : (
          <>
            {/* Stat strip */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: '16px 22px',
                paddingBottom: 16,
                borderBottom: `1px solid ${C.hair}`,
              }}
            >
              <Stat label="Concepts mastered" value={String(masteredConcepts)} sub={`of ${practicedConcepts} practiced`} />
              {accuracy != null && <Stat label="Recent accuracy" value={`${accuracy}%`} />}
              <Stat label="Day streak" value={String(streak)} sub={streak === 1 ? 'day' : 'days'} />
              {avgStudyMinutes != null && <Stat label="Avg session" value={`${avgStudyMinutes}`} sub="min" />}
              {practicesToMastery != null && (
                <Stat label="Learning speed" value={`~${practicesToMastery}`} sub="tries to master" />
              )}
              <Stat label="Misconceptions" value={String(resolvedMisconceptions)} sub={`resolved · ${activeMisconceptions} active`} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 22, marginTop: 16 }}>
              {/* Subjects mastered */}
              {subjectsMastered.length > 0 && (
                <div>
                  <span style={{ ...eyebrow, display: 'block', marginBottom: 10 }}>Subjects</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {subjectsMastered.map((s) => {
                      const p = s.practiced > 0 ? pct(s.mastered / s.practiced) : 0
                      return (
                        <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                            <span style={{ fontWeight: 500 }}>{s.label}</span>
                            <span style={{ color: C.muted }}>
                              {s.mastered}/{s.practiced} mastered
                            </span>
                          </div>
                          <span style={{ display: 'block', height: 5, borderRadius: 99, background: 'rgba(28,28,26,.06)', overflow: 'hidden' }}>
                            <span style={{ display: 'block', height: 5, borderRadius: 99, width: `${p}%`, background: s.color }} />
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Common mistake patterns */}
              {mistakePatterns.length > 0 && (
                <div>
                  <span style={{ ...eyebrow, display: 'block', marginBottom: 10 }}>Your typical mistakes</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {mistakePatterns.map((m) => (
                      <span
                        key={m.category}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12.5,
                          fontWeight: 500,
                          borderRadius: 99,
                          padding: '5px 11px',
                          background: 'rgba(146,64,14,.08)',
                          color: C.amber,
                        }}
                      >
                        {m.category}
                        <span style={{ fontSize: 11, opacity: 0.75 }}>×{m.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
