import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import type OpenAI from 'openai'

// Sprint 24 (ADR-038) — Task 3's central gotcha, solved once, structurally.
//
// Anthropic strict:true and OpenAI strict:true want OPPOSITE shapes for the
// same two things, and claude.ts is written for Anthropic:
//
//   nullable enum   Anthropic: { anyOf: [{ type:'string', enum:[...] }, { type:'null' }] }
//                   OpenAI:    { type: ['string','null'], enum: [...values, null] }
//
//   optional field  Anthropic: omit the key from `required` (e.g. session, style, note)
//                   OpenAI:    EVERY property MUST be in `required`; "optional" is
//                              expressed by making the property nullable instead.
//
// Rather than hand-maintain a second copy of the big ENVELOPE / SESSION_START
// schemas (the maintenance-tax risk Sprint 24 flags — "any envelope change must
// be made in BOTH"), we DERIVE the OpenAI schema from the Anthropic tool at
// runtime. One source of truth (claude.ts's ENVELOPE_TOOL / SESSION_START_TOOL);
// this file is the deterministic translation to OpenAI-strict function params.
//
// The transform, applied depth-first:
//   1. anyOf-nullable  -> type-union-nullable (both enum and plain-string forms)
//   2. every object    -> additionalProperties:false, required = ALL property keys
//   3. a property that was NOT in the original `required` -> made nullable
//      (adds 'null' to its type union), so OpenAI-strict "all required" keeps
//      Anthropic's optional semantics (absent === null downstream; the existing
//      parseEnvelopeObject already treats null/absent identically).

type JsonSchema = Record<string, unknown>

function isPlainObject(v: unknown): v is JsonSchema {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Rewrites the Anthropic `anyOf:[{string...},{null}]` nullable idiom into
// OpenAI's `type:['string','null']` union. Returns the rewritten node, or the
// node unchanged when it is not an anyOf-nullable.
function rewriteAnyOfNullable(node: JsonSchema): JsonSchema {
  const anyOf = node.anyOf
  if (!Array.isArray(anyOf)) return node
  const hasNull = anyOf.some((s) => isPlainObject(s) && s.type === 'null')
  const nonNull = anyOf.filter((s) => isPlainObject(s) && s.type !== 'null') as JsonSchema[]
  if (!hasNull || nonNull.length !== 1) return node // not the idiom we translate
  const base = nonNull[0]
  const out: JsonSchema = {}
  // preserve sibling metadata (description) that sat next to the anyOf
  for (const [k, v] of Object.entries(node)) {
    if (k !== 'anyOf') out[k] = v
  }
  out.type = ['string', 'null']
  if (Array.isArray(base.enum)) {
    // OpenAI strict needs null present in the enum for a nullable enum.
    out.enum = [...base.enum, null]
  }
  return out
}

// Adds 'null' to a node's declared type (idempotent), so an Anthropic-optional
// property survives OpenAI's "all keys required" rule as a nullable one.
function makeNullable(node: JsonSchema): JsonSchema {
  const t = node.type
  if (t === undefined) {
    // enum-only / union nodes already handled by rewriteAnyOfNullable; if a
    // bare enum slips through, express nullability via the type union.
    return { ...node, type: ['null'] }
  }
  if (Array.isArray(t)) {
    return t.includes('null') ? node : { ...node, type: [...t, 'null'] }
  }
  if (t === 'null') return node
  const out: JsonSchema = { ...node, type: [t, 'null'] }
  // a nullable enum must carry null among its values under OpenAI strict
  if (Array.isArray(out.enum) && !out.enum.includes(null)) {
    out.enum = [...(out.enum as unknown[]), null]
  }
  return out
}

function transform(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(transform)
  if (!isPlainObject(node)) return node

  // 1) nullable-idiom rewrite first (so the resulting node is then walked)
  let n = rewriteAnyOfNullable(node)

  // recurse into anyOf/oneOf/allOf that we did NOT collapse
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(n[key])) n = { ...n, [key]: (n[key] as unknown[]).map(transform) }
  }

  // arrays: recurse into items
  if (n.items !== undefined) n = { ...n, items: transform(n.items) }

  // 2) objects: all-required + additionalProperties:false + nullable optionals
  if (isPlainObject(n.properties)) {
    const props = n.properties as JsonSchema
    const originalRequired = new Set(Array.isArray(n.required) ? (n.required as string[]) : [])
    const newProps: JsonSchema = {}
    for (const [propName, propSchema] of Object.entries(props)) {
      let child = transform(propSchema) as JsonSchema
      if (!originalRequired.has(propName)) child = makeNullable(child)
      newProps[propName] = child
    }
    n = {
      ...n,
      properties: newProps,
      required: Object.keys(props), // OpenAI strict: every property required
      additionalProperties: false,
    }
  }

  return n
}

// Convert one Anthropic tool into an OpenAI strict function tool. `input_examples`
// has no OpenAI equivalent and is dropped (its guidance already lives in the
// per-field `description`s the schema carries).
export function toOpenAIFunctionTool(tool: Anthropic.Tool): OpenAI.Chat.Completions.ChatCompletionFunctionTool {
  const parameters = transform(tool.input_schema) as Record<string, unknown>
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? undefined,
      parameters,
      strict: true,
    },
  }
}
