import type { NbNotebook, NbMisconception } from '../notebook-read'
import { C } from '../theme'

// The "live notebook" note renderers (redesign): the two structured sections a
// concept page is really about — "Must know" key points and the "How to solve
// it" method flow — plus the green highlighted-expression bubble and the
// step-level mistake annotations, echoing the extension's on-problem
// highlight-and-annotate style. Pure display; the mistake's live count/date is
// joined from the concept's misconception rows in the parent (miscByCategory).

type KeyPoint = NbNotebook['mustKnow'][number]
type Step = NbNotebook['method'][number]

// Short UTC month/day, matching the rest of the dashboard's date grain.
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// A math expression highlighted in a green bubble — the notebook's echo of the
// extension's on-problem highlight. Monospace so expressions read cleanly.
export function MathBubble({ expr }: { expr: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 11px',
        borderRadius: 9,
        background: C.mintTile,
        border: '1px solid rgba(134,239,172,.75)',
        color: C.greenDeep,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '.01em',
        whiteSpace: 'pre-wrap',
        lineHeight: 1.5,
      }}
    >
      {expr}
    </span>
  )
}

// ── "Must know" — the numbered key points ────────────────────────────────────

export function MustKnowList({ items }: { items: KeyPoint[] }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {items.map((k, i) => (
        <li key={i} style={{ display: 'flex', gap: 12 }}>
          <span
            style={{
              flex: 'none',
              width: 24,
              height: 24,
              borderRadius: 8,
              background: C.mintTile,
              color: C.greenDeep,
              fontSize: 12.5,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {i + 1}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, lineHeight: '21px' }}>{k.heading}</p>
            {k.expression && (
              <div style={{ margin: '9px 0 2px' }}>
                <MathBubble expr={k.expression} />
              </div>
            )}
            {k.points.length > 0 && (
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {k.points.map((p, j) => (
                  <li key={j} style={{ display: 'flex', gap: 9, fontSize: 13.5, lineHeight: '20px', color: C.ink }}>
                    <span style={{ flex: 'none', width: 5, height: 5, marginTop: 7, borderRadius: 99, background: C.greenInk }} />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

// ── "How to solve it" — the ordered method, arrows between steps ──────────────

// The mistake annotation attached to a step the student slipped on. The AI wrote
// what-went-wrong + watch-for; the count/date is joined live from the matching
// misconception row (miscByCategory) so it stays truthful as the slip recurs.
function MistakeNote({ step, misc }: { step: Step; misc: NbMisconception | undefined }) {
  const mistake = step.mistake
  if (!mistake) return null
  return (
    <div style={{ marginTop: 11, padding: '11px 13px', borderRadius: 12, background: 'rgba(146,64,14,.06)', border: '1px solid rgba(146,64,14,.18)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={C.amber} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 1.8 L14.5 13.5 H1.5 Z" />
          <path d="M8 6.5 V9.4" />
          <circle cx="8" cy="11.6" r=".3" />
        </svg>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: C.amber }}>Watch out</span>
        {misc && (
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: C.amber }}>
            {misc.occurrenceCount}× · last {shortDate(misc.lastSeenAt)}
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: '19px', color: C.ink }}>
        {misc ? `On ${shortDate(misc.lastSeenAt)}, ` : ''}
        {misc ? mistake.whatWentWrong.charAt(0).toLowerCase() + mistake.whatWentWrong.slice(1) : mistake.whatWentWrong}
      </p>
      {mistake.watchFor && (
        <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: '19px', color: C.amber, fontWeight: 500 }}>
          → {mistake.watchFor}
        </p>
      )}
    </div>
  )
}

export function MethodFlow({
  steps,
  miscByCategory,
}: {
  steps: Step[]
  miscByCategory: Map<string, NbMisconception>
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {steps.map((s, i) => {
        const notLast = i < steps.length - 1
        const hasMistake = !!s.mistake
        const misc = s.mistake?.category ? miscByCategory.get(s.mistake.category) : undefined
        return (
          <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
            {/* Rail: numbered badge + connecting line with a downward arrow. */}
            <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 26 }}>
              <span
                style={{
                  flex: 'none',
                  width: 26,
                  height: 26,
                  borderRadius: 99,
                  background: hasMistake ? 'rgba(146,64,14,.1)' : C.mintTile,
                  color: hasMistake ? C.amber : C.greenDeep,
                  border: hasMistake ? '1.5px solid rgba(146,64,14,.4)' : '1.5px solid transparent',
                  fontSize: 12.5,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {i + 1}
              </span>
              {notLast && (
                <span style={{ flex: 1, position: 'relative', display: 'flex', justifyContent: 'center', minHeight: 20, margin: '3px 0' }}>
                  <span style={{ width: 2, background: 'rgba(134,239,172,.7)', borderRadius: 2 }} />
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={C.greenInk} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', bottom: -3, background: 'transparent' }}>
                    <path d="M3 5 L6 8 L9 5" />
                  </svg>
                </span>
              )}
            </div>
            {/* Step body */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: notLast ? 20 : 0 }}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: '21px', color: C.ink }}>{s.step}</p>
              {s.expression && (
                <div style={{ margin: '9px 0 2px' }}>
                  <MathBubble expr={s.expression} />
                </div>
              )}
              <MistakeNote step={s} misc={misc} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Active misconceptions the AI did not attach to any specific step — surfaced as
// a compact "also watch out for" list so no tracked slip silently disappears.
export function LooseMistakes({ items }: { items: NbMisconception[] }) {
  if (items.length === 0) return null
  return (
    <div style={{ marginTop: 18, padding: '13px 15px', borderRadius: 12, background: 'rgba(146,64,14,.05)' }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: C.amber }}>Also watch out for</span>
      <ul style={{ margin: '9px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((m) => (
          <li key={m.id} style={{ display: 'flex', gap: 9, fontSize: 13, lineHeight: '19px' }}>
            <span style={{ flex: 'none', width: 6, height: 6, marginTop: 6, borderRadius: 99, background: C.amber }} />
            <span style={{ flex: 1 }}>
              <span style={{ fontWeight: 500 }}>{m.title}</span>
              {m.description ? ` — ${m.description}` : ''}
              <span style={{ color: C.amber, fontWeight: 600 }}> · {m.occurrenceCount}× · last {shortDate(m.lastSeenAt)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// The category strings the method already annotates — so LooseMistakes can show
// only the misconceptions NOT already attached to a step (no duplication).
export function attachedCategories(steps: Step[]): Set<string> {
  const set = new Set<string>()
  for (const s of steps) if (s.mistake?.category) set.add(s.mistake.category)
  return set
}
