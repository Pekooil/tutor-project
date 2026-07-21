import { writeFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'

// One-off backfill: regenerate a REAL user's concept notebook(s) for ONE session
// in the new v2 shape and upsert them to the DB, so the new "Must know" / "How
// to solve it" sections render on their actual dashboard (the notebook feature
// is uncommitted → prod has never generated any notebooks). Writes to prod via a
// service-role client, so it is double-gated: NOTEBOOK_BACKFILL=1 AND the target
// user/session passed by env. Never runs in a normal eval/test pass. Run:
//   NOTEBOOK_BACKFILL=1 NOTEBOOK_BACKFILL_USER=<uuid> NOTEBOOK_BACKFILL_SESSION=<uuid> \
//   OPENAI_API_KEY=… NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//   npx vitest run --config vitest.eval.config.ts eval/notebook-backfill.eval.ts
vi.mock('server-only', () => ({}))

import { createAdminClient } from '@/lib/supabase/admin'
import { updateSessionNotebooks } from '@/lib/notebook/update'

const USER_ID = process.env.NOTEBOOK_BACKFILL_USER ?? ''
const SESSION_ID = process.env.NOTEBOOK_BACKFILL_SESSION ?? ''
const RUN = process.env.NOTEBOOK_BACKFILL === '1' && !!USER_ID && !!SESSION_ID

describe('notebook-backfill (one-off, writes prod)', () => {
  it.skipIf(!RUN)(
    'regenerates the session concepts in the new shape and upserts them',
    async () => {
      const supabase = createAdminClient()

      const result = await updateSessionNotebooks(supabase, USER_ID, SESSION_ID)

      // Read back what was written so the run is inspectable.
      const { data: rows } = await supabase
        .from('concept_notebook')
        .select('concept_key, session_count, content, updated_at')
        .eq('user_id', USER_ID)

      const out = { result, rows }
      writeFileSync('eval/results/notebook-backfill.json', JSON.stringify(out, null, 2))

      expect(result.updated.length).toBeGreaterThan(0)
    },
    5 * 60 * 1000
  )

  it.skipIf(RUN)('is skipped without NOTEBOOK_BACKFILL=1 + user/session env', () => {
    expect(true).toBe(true)
  })
})
