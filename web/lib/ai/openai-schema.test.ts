import { describe, it, expect } from 'vitest'
import { ENVELOPE_TOOL, SESSION_START_TOOL } from './claude'
import { toOpenAIFunctionTool } from './openai-schema'
import { parseEnvelopeObject } from './envelope'

// Sprint 24 (ADR-038) — Task 6 parity test (no API keys; runs in the normal
// suite). Proves the Anthropic->OpenAI strict-schema translation is well-formed
// so OpenAI strict mode won't reject the tools at call time — the failure the
// nullable-enum flip exists to prevent — and that an envelope shaped by the
// OpenAI schema still validates through the shared parseEnvelopeObject.

type JsonSchema = Record<string, unknown>

// Walk every object node with `properties` and assert OpenAI-strict invariants.
function assertStrictObjects(node: unknown, path = '$'): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => assertStrictObjects(n, `${path}[${i}]`))
    return
  }
  if (typeof node !== 'object' || node === null) return
  const n = node as JsonSchema
  if (n.properties && typeof n.properties === 'object') {
    const props = n.properties as JsonSchema
    const keys = Object.keys(props)
    // 1) additionalProperties MUST be false
    expect(n.additionalProperties, `${path}.additionalProperties`).toBe(false)
    // 2) EVERY property must be listed in required (OpenAI strict rule)
    const required = (n.required as string[]) ?? []
    expect([...required].sort(), `${path}.required must list all properties`).toEqual([...keys].sort())
    for (const k of keys) assertStrictObjects(props[k], `${path}.${k}`)
  }
  if (n.items) assertStrictObjects(n.items, `${path}.items`)
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(n[key])) assertStrictObjects(n[key], `${path}.${key}`)
  }
}

function typeIncludes(node: JsonSchema, t: string): boolean {
  const ty = node.type
  return Array.isArray(ty) ? ty.includes(t) : ty === t
}

describe('toOpenAIFunctionTool — Anthropic → OpenAI strict schema', () => {
  const envelopeFn = toOpenAIFunctionTool(ENVELOPE_TOOL)
  const params = envelopeFn.function.parameters as JsonSchema

  it('produces a strict function tool', () => {
    expect(envelopeFn.type).toBe('function')
    expect(envelopeFn.function.name).toBe('submit_tutor_turn')
    expect(envelopeFn.function.strict).toBe(true)
  })

  it('every object node is all-required + additionalProperties:false', () => {
    assertStrictObjects(params)
  })

  it('nullable concept_key enum is flipped to type-union WITH null in the enum', () => {
    const props = params.properties as JsonSchema
    const conceptKey = (props.assessment as JsonSchema).properties as JsonSchema
    const ck = conceptKey.concept_key as JsonSchema
    // Anthropic form was anyOf:[{enum},{null}]; OpenAI form is type:['string','null'] + null in enum.
    expect(ck.anyOf).toBeUndefined()
    expect(typeIncludes(ck, 'string')).toBe(true)
    expect(typeIncludes(ck, 'null')).toBe(true)
    expect(Array.isArray(ck.enum)).toBe(true)
    expect((ck.enum as unknown[]).includes(null)).toBe(true)
    // the real curriculum keys survived the transform
    expect((ck.enum as unknown[]).includes('algebra.polynomials.expanding')).toBe(true)
  })

  it('Anthropic-optional fields (session, annotation.style/note/step) become nullable-required', () => {
    const props = params.properties as JsonSchema
    // session was optional on Anthropic -> now required + nullable
    expect((params.required as string[]).includes('session')).toBe(true)
    expect(typeIncludes(props.session as JsonSchema, 'null')).toBe(true)
    // annotation item: style/note/step were optional -> required + nullable
    const annItem = (props.annotations as JsonSchema).items as JsonSchema
    const annProps = annItem.properties as JsonSchema
    for (const opt of ['style', 'note', 'step']) {
      expect((annItem.required as string[]).includes(opt), `annotation.${opt} required`).toBe(true)
      expect(typeIncludes(annProps[opt] as JsonSchema, 'null'), `annotation.${opt} nullable`).toBe(true)
    }
  })

  it('SESSION_START_TOOL also translates to a valid strict tool', () => {
    const fn = toOpenAIFunctionTool(SESSION_START_TOOL)
    expect(fn.function.name).toBe('submit_session_start_turn')
    expect(fn.function.strict).toBe(true)
    assertStrictObjects(fn.function.parameters as JsonSchema)
  })

  it('an OpenAI-shaped tool output still parses through parseEnvelopeObject', () => {
    // The Anthropic worked example is a valid envelope payload; simulate the
    // OpenAI path (function args arrive as a JSON string) and confirm the shared
    // parser accepts it unchanged.
    const example = ENVELOPE_TOOL.input_examples?.[0]
    expect(example).toBeTruthy()
    const roundTripped = JSON.parse(JSON.stringify(example)) as Record<string, unknown>
    const env = parseEnvelopeObject(roundTripped)
    expect(env).toBeTruthy()
    expect(typeof env?.say).toBe('string')
    expect(env?.assessment).toBeTruthy()
  })
})
