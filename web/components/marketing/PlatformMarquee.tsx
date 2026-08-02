import type { Platform } from '@/components/marketing/CompatibleWith'

// Landing v6 §3, "Compatible with what platforms?": a rolling line of platform
// names on the page's green wash, closed by the honest "and any other page in
// Chrome" line.
//
// Same seven platforms in the same order as the hero's rotating pill, and the
// same name-only constraint — no third-party logos, so nothing here is a brand
// asset or a redrawn approximation.
//
// 2026-07-24 (Darcy): the design file's brand-tinted PILLS are gone — these are
// plain wordmarks in the page's own neutral, separated by a faint middot. The
// `Platform.color` field is intentionally unused now; it stays on the shared
// type because the hero's CompatibleWith still tints with it.
//
// The track uses marketing.css's shared .mkt-marquee primitives: two identical
// halves sliding -50% for a seamless loop, edges under a mask, reduced motion
// collapsing to a static wrapped set. The gap rides on each item's margin
// rather than the track's `gap` so both halves measure exactly 50% — a track
// gap would leave the loop one gap short and visibly jump on every wrap.

const PLATFORMS: Platform[] = [
  { name: 'Canvas', color: '#e2323b' },
  { name: 'Khan Academy', color: '#14a07a' },
  { name: 'MyLab Math', color: '#9a5cb4' },
  { name: 'DeltaMath', color: '#2f9e6f' },
  { name: 'WebAssign', color: '#c8102e' },
  { name: 'AP Classroom', color: '#0077c8' },
  { name: 'Google Classroom', color: '#0f9d58' },
]

const GAP = 28

// The separator rides INSIDE each item (trailing, not between) so every item
// measures the same — which is what keeps the two marquee halves identical.
function Name({ platform }: { platform: Platform }) {
  return (
    <span
      className="flex items-center gap-7 whitespace-nowrap text-[17px] font-semibold text-(--mkt-strip-text) sm:text-[22px]"
      style={{ marginRight: GAP }}
    >
      {platform.name}
      <span aria-hidden="true" className="text-(--mkt-faint)">
        ·
      </span>
    </span>
  )
}

export function PlatformMarquee() {
  return (
    <section className="px-[22px] py-14 sm:px-14 sm:pb-[84px] sm:pt-[76px]">
      <p className="m-0 mb-7 text-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:mb-10 sm:text-[15px]">
        Compatible with what platforms?
      </p>

      {/* The full list, once, for screen readers — the visual track duplicates
          every pill for the loop, which would otherwise be read out twice. */}
      <p className="sr-only">
        Calyxa works on {PLATFORMS.map((platform) => platform.name).join(', ')}, and any other page in Chrome.
      </p>

      <div className="mkt-marquee mx-auto max-w-[1300px]" aria-hidden="true">
        <div className="mkt-marquee-track" style={{ gap: 0, animationDuration: '40s' }}>
          {PLATFORMS.map((platform) => (
            <Name key={platform.name} platform={platform} />
          ))}
          <div className="mkt-marquee-dup flex">
            {PLATFORMS.map((platform) => (
              <Name key={`${platform.name}-dup`} platform={platform} />
            ))}
          </div>
        </div>
      </div>

      {/* Landing v7 trims this to the short form — the caveat it used to
          carry is now the FAQ's "Any page in Chrome" answer. */}
      <p className="mx-auto mb-0 mt-6 max-w-[46ch] text-center text-[15px] text-muted-foreground sm:mt-[34px] sm:max-w-none sm:text-[17px]">
        And any other page in Chrome.
      </p>
    </section>
  )
}
