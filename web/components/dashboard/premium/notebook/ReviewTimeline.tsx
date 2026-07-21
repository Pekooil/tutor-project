import type { NbTimelineEvent } from '../notebook-read'
import { C } from '../theme'

// The Review Timeline (redesign, brief §2) — the story of the student's learning
// on one concept: when they first worked it, misconceptions spotted and later
// resolved, a mastery crossing, and the next scheduled review. Every node is a
// real dated signal from the learning tables — never a fabricated milestone. A
// concept with no dated history simply omits the timeline.

const KIND_STYLE: Record<NbTimelineEvent['kind'], { dot: string; ring: string }> = {
  learned: { dot: '#2563eb', ring: 'rgba(37,99,235,.16)' },
  spotted: { dot: '#92400e', ring: 'rgba(146,64,14,.14)' },
  resolved: { dot: '#166534', ring: 'rgba(22,101,52,.16)' },
  mastered: { dot: '#166534', ring: 'rgba(134,239,172,.4)' },
  practiced: { dot: '#6b6b65', ring: 'rgba(28,28,26,.08)' },
  review: { dot: '#a21caf', ring: 'rgba(162,28,175,.14)' },
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function ReviewTimeline({ events }: { events: NbTimelineEvent[] }) {
  if (events.length === 0) return null
  return (
    <ol style={{ position: 'relative', margin: 0, padding: 0, listStyle: 'none' }}>
      {events.map((e, i) => {
        const style = KIND_STYLE[e.kind]
        const isLast = i === events.length - 1
        return (
          <li key={`${e.kind}-${e.date}-${i}`} style={{ position: 'relative', display: 'flex', gap: 14, paddingBottom: isLast ? 0 : 18 }}>
            {/* Rail + node */}
            <span style={{ position: 'relative', flex: 'none', width: 14, display: 'flex', justifyContent: 'center' }}>
              {!isLast && (
                <span style={{ position: 'absolute', top: 16, bottom: -18, width: 2, background: 'rgba(28,28,26,.1)' }} />
              )}
              <span
                style={{
                  position: 'relative',
                  zIndex: 1,
                  width: 14,
                  height: 14,
                  borderRadius: 99,
                  background: e.future ? 'transparent' : style.dot,
                  border: e.future ? `2px dashed ${style.dot}` : `3px solid ${style.ring}`,
                  boxShadow: e.future ? 'none' : `0 0 0 2px #f7f6f2`,
                  marginTop: 3,
                }}
              />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: e.future ? style.dot : C.faint }}>
                {fmtDate(e.date)}
                {e.future ? ' · upcoming' : ''}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: C.ink }}>{e.label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
