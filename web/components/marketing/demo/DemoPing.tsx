'use client'

import { AnimatePresence, motion } from 'motion/react'

// The event-ping toast, recreated from PingToasts.tsx: a transient
// frosted-glass pill anchored above the panel (never over the input row),
// green status dot with a soft glow ring, accent-emphasis label, rise-in
// entry. Auto-dismiss timing lives in the scene script, not here.
export function DemoPing({ label }: { label: string | null }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-0 right-0 z-30 mb-2.5 flex flex-col items-center gap-2">
      <AnimatePresence>
        {label && (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex items-center gap-2 rounded-full border border-(--cx-demo-hairline) bg-background/85 px-3.5 py-1.5 shadow-panel backdrop-blur-[18px] backdrop-saturate-[1.5]"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 flex-none rounded-full bg-accent-glow-strong shadow-[0_0_0_3px_rgba(134,239,172,0.35)]"
            />
            <span className="text-[12px] font-semibold text-accent-emphasis">{label}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
