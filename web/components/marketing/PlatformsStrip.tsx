// The Landing v3 platforms band: a full-width hairline-bounded strip under
// the hero — kicker, a 24s marquee of brand-tinted platform chips, and the
// honest footnote. Pure CSS loop (marketing.css's .mkt-marquee, two
// identical halves sliding -50%); aria-hidden with an sr-only list, and
// reduced motion wraps one static set — the marquee classes already handle
// both.

// Brand-adjacent hues only (no logos), tinted with the retired
// PlatformMarquee's recipe — 11% background / 30% border / 62% text mixes
// keep every chip readable on white. "a worksheet PDF" gets PDF red.
const PLATFORMS: { name: string; brand: string }[] = [
  { name: 'Canvas', brand: '#e2323b' },
  { name: 'MyLab Math', brand: '#7a3e93' },
  { name: 'Khan Academy', brand: '#14a07a' },
  { name: 'DeltaMath', brand: '#2f9e6f' },
  { name: 'IXL', brand: '#ef7d21' },
  { name: 'WebAssign', brand: '#c8102e' },
  { name: 'a worksheet PDF', brand: '#d0021b' },
]

function Chip({ name, brand, dup }: { name: string; brand: string; dup?: boolean }) {
  return (
    <span
      aria-hidden={dup}
      className={`${dup ? 'mkt-marquee-dup ' : ''}flex-none rounded-full border px-[15px] py-[7px] text-[13px] font-semibold`}
      style={{
        background: `color-mix(in srgb, ${brand} 11%, #ffffff)`,
        borderColor: `color-mix(in srgb, ${brand} 30%, #ffffff)`,
        color: `color-mix(in srgb, ${brand} 62%, #1c1c1a)`,
      }}
    >
      {name}
    </span>
  )
}

export function PlatformsStrip() {
  return (
    <section
      aria-label="Where Calyxa works"
      className="flex flex-col items-center gap-4 border-y border-(--mkt-hairline-faint) px-6 py-9"
    >
      <p className="mkt-kicker-faint m-0">works where your homework already is</p>
      <ul className="sr-only">
        {PLATFORMS.map(({ name }) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <div aria-hidden="true" className="mkt-marquee mkt-marquee-fast w-full max-w-[900px]">
        <div className="mkt-marquee-track gap-2.5">
          {PLATFORMS.map(({ name, brand }) => (
            <Chip key={name} name={name} brand={brand} />
          ))}
          {PLATFORMS.map(({ name, brand }) => (
            <Chip key={`dup-${name}`} name={name} brand={brand} dup />
          ))}
        </div>
      </div>
      <p className="m-0 text-[13px] text-(--mkt-faint)">if you can open it in chrome, calyxa can tutor on it.</p>
    </section>
  )
}
