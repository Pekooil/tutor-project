'use client'

// TEMPORARY — Sprint 22 Task 3 wiring gate (docs/sprint-22-plan.md). Proves a
// green-on-brand chart renders from the Task 2 `--chart-*` tokens
// (packages/ui/src/theme.css) before any real dashboard view depends on the
// combination. Delete this route once the gate is confirmed, or keep it as a
// reference if a later audit sprint wants a rendered-token reference page —
// decided at the gate, not before.
//
// KNOWN DEFECT, FLAGGED FOR DARCY (not resolved by this task — see the Task 3
// report): shadcn's installed `ChartContainer` (components/ui/chart.tsx,
// still present per the task's file list) AND this thinner direct-Recharts
// wrapper (ADR-048's recorded fallback: "if the combo fights, the fallback is
// a thinner direct-Recharts wrapper on the same tokens — a contained swap")
// BOTH show unreliable Bar height geometry with recharts@3.9.2 in this repo's
// stack (Next 16 + Turbopack + React 19 + Tailwind v4): bar `height` comes
// back non-proportional-to-value (compressed by a roughly constant but
// non-1.0 factor) on most loads, reproduced in BOTH `next dev` and a
// production `next build && next start` — so it is NOT a React Strict Mode
// dev-only artifact. Colors, token wiring, and relative proportions BETWEEN
// bars are all verified correct (see the Task 3 report for the numeric
// fiber/DOM measurements); only the absolute height scale is wrong.
// `recharts@3.8.0` (the version `npx shadcn add chart` originally resolved)
// has a more basic, ALWAYS-reproducing bug — every bar's height comes back
// exactly 0 regardless of value — fixed upstream by 3.9.2, which is why
// `web/package.json` pins `^3.9.2`, not the CLI's original resolution.
// `recharts@2.15.4` (the last pre-v3 line) failed to resolve at all in this
// dev server without a full process restart and is EOL upstream (deprecated
// in favor of v3), so wasn't pursued further as a fix.

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// Illustrative only — the real per-strand mastery numbers come from Task 4's
// loadDashboard(), not this throwaway gate.
const data = [
  { strand: 'algebra1', label: 'Algebra 1', mastery: 72 },
  { strand: 'geometry', label: 'Geometry', mastery: 58 },
  { strand: 'algebra2', label: 'Algebra 2', mastery: 41 },
  { strand: 'trigPrecalc', label: 'Trig / Precalc', mastery: 30 },
  { strand: 'calculus', label: 'Calculus', mastery: 18 },
  { strand: 'probStats', label: 'Prob & Stats', mastery: 25 },
] as const

// One `--chart-N` token per strand (Task 2) — read directly, no shadcn
// ChartStyle indirection needed.
const STRAND_COLOR: Record<(typeof data)[number]['strand'], string> = {
  algebra1: 'var(--chart-1)',
  geometry: 'var(--chart-2)',
  algebra2: 'var(--chart-3)',
  trigPrecalc: 'var(--chart-4)',
  calculus: 'var(--chart-5)',
  probStats: 'var(--chart-6)',
}

export default function ChartGatePage() {
  return (
    <Card>
      <CardHeader>
        <h1 className="text-xl leading-none font-semibold">Chart wiring gate</h1>
        <p className="text-sm text-muted-foreground">
          Temporary — Sprint 22 Task 3. One bar per strand, each color read from a
          Task 2 <code>--chart-*</code> token, nothing hard-coded.
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[...data]}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
              />
              <YAxis hide domain={[0, 100]} />
              <Bar dataKey="mastery" radius={4}>
                {data.map((entry) => (
                  <Cell key={entry.strand} fill={STRAND_COLOR[entry.strand]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
