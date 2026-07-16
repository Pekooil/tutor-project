// The Landing v3 platforms band: a full-width hairline-bounded strip under
// the hero — kicker, a 24s marquee of neutral platform chips, and the
// honest footnote. Replaces the old in-hero brand-tinted PlatformMarquee.
// Pure CSS loop (marketing.css's .mkt-marquee, two identical halves sliding
// -50%); aria-hidden with an sr-only list, and reduced motion wraps one
// static set — the marquee classes already handle both.

const PLATFORMS = ['Canvas', 'MyLab Math', 'Khan Academy', 'DeltaMath', 'IXL', 'WebAssign', 'a worksheet PDF']

function Chip({ name, dup }: { name: string; dup?: boolean }) {
  return (
    <span
      aria-hidden={dup}
      className={`${dup ? 'mkt-marquee-dup ' : ''}flex-none rounded-full border border-(--mkt-hairline-soft) bg-(--calyxa-board-bg) px-[15px] py-[7px] text-[13px] font-semibold text-(--mkt-strip-text)`}
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
        {PLATFORMS.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <div aria-hidden="true" className="mkt-marquee mkt-marquee-fast w-full max-w-[900px]">
        <div className="mkt-marquee-track gap-2.5">
          {PLATFORMS.map((name) => (
            <Chip key={name} name={name} />
          ))}
          {PLATFORMS.map((name) => (
            <Chip key={`dup-${name}`} name={name} dup />
          ))}
        </div>
      </div>
      <p className="m-0 text-[13px] text-(--mkt-faint)">if you can open it in chrome, calyxa can tutor on it.</p>
    </section>
  )
}
