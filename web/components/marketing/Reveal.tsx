'use client'

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'

type RevealProps = {
  children: ReactNode
  className?: string
  /** Seconds. Callers compose their own stagger by passing e.g. `index * 0.08`. */
  delay?: number
}

// The one entrance primitive for the marketing tree (ADR-031): every section
// composes this rather than hand-rolling its own in-view logic. Reduced
// motion renders the fully-composed end state with zero movement, never a
// slower version of the same animation.
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, ease: [0, 0, 0.2, 1], delay }}
    >
      {children}
    </motion.div>
  )
}
