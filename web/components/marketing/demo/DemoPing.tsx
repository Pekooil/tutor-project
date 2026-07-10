'use client'

import type { ScenePing } from './scene'

// The ping toast recreation (PingToast.tsx, design 8a/8b — Sprint 25 Task 3
// rebuild): a single tone-tinted capsule dropping into the top-center of
// the session header — glyph + label, one at a time, ~3s cycle (drop in
// from −18px, hold, fade up and out). The three tones read the product's
// --calyxa-ping-* tokens directly (reachable in /web via the @calyxa/ui
// theme import in globals.css); the cx-demo-ping keyframe lives in
// DemoStage's scoped <style>, gated to prefers-reduced-motion:
// no-preference — reduced motion renders the toast held in place (the base
// centering transform), and the scene reducer's duration window still
// removes it.
export function DemoPing({ ping }: { ping: ScenePing | null }) {
  if (!ping) return null
  return (
    <div
      // Keyed by label so back-to-back pings each re-run the cycle, the
      // same way the real queue keys the toast by entry id.
      key={ping.label}
      className="cx-demo-ping pointer-events-none absolute left-1/2 top-[9px] z-30 flex items-center gap-[7px] whitespace-nowrap rounded-full border py-[7px] pl-[11px] pr-3.5 text-[12.5px] font-semibold shadow-[0_8px_22px_rgba(15,23,42,0.16)]"
      style={{
        background: `var(--calyxa-ping-${ping.tone}-bg)`,
        borderColor: `var(--calyxa-ping-${ping.tone}-border)`,
        color: `var(--calyxa-ping-${ping.tone}-text)`,
      }}
    >
      {/* Pin the overlay system stack — web's Geist display font malforms
          the geometric ping glyphs (● ↺ ✓ …), same as the mode glyphs. */}
      <span aria-hidden="true" className="text-[13.5px] font-bold leading-none" style={{ fontFamily: 'var(--font-sans)' }}>
        {ping.glyph}
      </span>
      <span>{ping.label}</span>
    </div>
  )
}
