// The hero's compatibility strip (Sprint 25): a rolling line of the
// platforms Calyxa works on, replacing the old ambient mode/ping row. Each
// platform is a small pill tinted toward its brand color (no logos — brand
// hue only, per the copy note). The visual marquee is a pure-CSS loop (two
// identical halves translated -50%); it is aria-hidden, with an sr-only list
// carrying the same platforms for assistive tech. Reduced motion drops the
// animation and wraps the pills into a centered, static set (see
// marketing.css). Server component — no client JS.

type Platform = { name: string; brand: string }

// Brand-adjacent hues only (tinted at render, never the raw logo color as a
// large fill). Ordered so neighboring pills don't repeat a hue family.
const PLATFORMS: Platform[] = [
  { name: 'Canvas', brand: '#e2323b' },
  { name: 'Blackboard / Blackboard Ultra', brand: '#1a7f8e' },
  { name: 'McGraw-Hill Connect', brand: '#0067b1' },
  { name: 'Pearson MyLab & Mastering', brand: '#7a3e93' },
  { name: 'Cengage / WebAssign / MindTap', brand: '#c8102e' },
  { name: 'Google Classroom', brand: '#1e8e3e' },
  { name: 'Schoology', brand: '#2f8fd6' },
  { name: 'Quizlet', brand: '#4255ff' },
  { name: 'Khan Academy', brand: '#14a07a' },
  { name: 'Delta Math', brand: '#2f9e6f' },
]

function PlatformPill({ platform, dup }: { platform: Platform; dup?: boolean }) {
  return (
    <span
      aria-hidden={dup}
      className={dup ? 'mkt-platform-pill mkt-marquee-dup' : 'mkt-platform-pill'}
      style={{ '--pill': platform.brand } as React.CSSProperties}
    >
      {platform.name}
    </span>
  )
}

export function PlatformMarquee() {
  return (
    <div className="mt-8 w-full">
      <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        Works right on top of
      </p>
      {/* Screen-reader equivalent of the animated strip. */}
      <ul className="sr-only">
        {PLATFORMS.map((platform) => (
          <li key={platform.name}>{platform.name}</li>
        ))}
      </ul>
      <div aria-hidden="true" className="mkt-marquee">
        <div className="mkt-marquee-track">
          {PLATFORMS.map((platform) => (
            <PlatformPill key={platform.name} platform={platform} />
          ))}
          {/* Duplicate half — the -50% translate loops seamlessly; hidden
              entirely under reduced motion so the wrap shows one set. */}
          {PLATFORMS.map((platform) => (
            <PlatformPill key={`dup-${platform.name}`} platform={platform} dup />
          ))}
        </div>
      </div>
    </div>
  )
}
