import { describe, it, expect, vi } from 'vitest'

// claude.ts carries `import 'server-only'`; same mock pattern as
// claude-stream.test.ts so the exported forced-tool schemas can be inspected
// without a server. Reading the tool constants makes no network/SDK call.
vi.mock('server-only', () => ({}))

import { ENVELOPE_TOOL, OPENING_SCAN_TOOL, SESSION_START_TOOL } from '../lib/ai/claude'

// The strict:true tool invariant, pinned structurally (ADR: forced-tool
// schemas). Anthropic rejects a strict tool whose schema has ANY object node
// without `additionalProperties: false` -- a 400 at call time that 500s the
// turn ("Couldn't reach the tutor"). The fake-backend route tests can't catch
// it (they never validate the schema against the real API), so this walks
// every object node in each forced tool and asserts the flag is present. This
// is the guard that would have caught the design-8d answer_fields regression,
// where the nested field object was added inline without the flag.
type JsonSchemaNode = {
  type?: string
  additionalProperties?: unknown
  properties?: Record<string, JsonSchemaNode>
  items?: JsonSchemaNode
  [key: string]: unknown
}

// Every object node's dotted path, so a failure names the exact offender.
function objectNodePaths(node: JsonSchemaNode | undefined, path: string, out: Array<{ path: string; ok: boolean }>): void {
  if (!node || typeof node !== 'object') return
  if (node.type === 'object') {
    out.push({ path, ok: node.additionalProperties === false })
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      objectNodePaths(child, `${path}.${key}`, out)
    }
  }
  if (node.items) {
    objectNodePaths(node.items, `${path}[]`, out)
  }
}

describe('forced-tool schemas satisfy the strict:true invariant', () => {
  for (const tool of [ENVELOPE_TOOL, SESSION_START_TOOL, OPENING_SCAN_TOOL]) {
    it(`${tool.name}: every object node sets additionalProperties:false`, () => {
      expect(tool.strict).toBe(true)
      const nodes: Array<{ path: string; ok: boolean }> = []
      objectNodePaths(tool.input_schema as JsonSchemaNode, tool.name, nodes)
      // Sanity: we actually walked into nested objects, not just the root.
      expect(nodes.length).toBeGreaterThan(1)
      const offenders = nodes.filter((n) => !n.ok).map((n) => n.path)
      expect(offenders).toEqual([])
    })
  }

  it('reaches the design-8d answer_fields item object specifically (the regression site)', () => {
    const nodes: Array<{ path: string; ok: boolean }> = []
    objectNodePaths(ENVELOPE_TOOL.input_schema as JsonSchemaNode, ENVELOPE_TOOL.name, nodes)
    const fieldItem = nodes.find((n) => n.path.endsWith('answer_fields[]'))
    expect(fieldItem).toBeDefined()
    expect(fieldItem?.ok).toBe(true)
  })
})
