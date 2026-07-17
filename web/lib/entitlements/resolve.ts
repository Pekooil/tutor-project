import 'server-only'

// Sprint 23 / Task 6 (ADR-051): the entitlements resolver — the ONE place that
// turns a user's billing state into the PLAN §2.8 feature-flag set. It is
// resolved server-side, ridden on the /api/session/start response for DISPLAY,
// and RE-DERIVED server-side on every Pro path via assertEntitlement
// (web/lib/tier/require-pro.ts) — the cached client value is a hint, never an
// authorization (the "client is a display hint only" discipline, extended from
// the free-tier gate to entitlements).
//
// Pure and server-only: no I/O, no request context — just (tier, status,
// overrides) → flags, so it is trivially unit-testable (entitlements.test.ts,
// Task 8) and cannot leak a Stripe secret. `server-only` is a defensive marker
// (Task 8 neutralizes it the same way the other server-only tests do).

// image_capture is a STAGED-rollout capability, not a plain on/off — PLAN §2.8
// calls it out explicitly (`image_capture='beta'`). 'off' = not available,
// 'beta' = available to opted-in rollout users, 'on' = generally available.
export type ImageCaptureStage = 'off' | 'beta' | 'on'

// The PLAN §2.8 flag set. This type is the SINGLE SOURCE for what an entitlement
// is — the session-start response, the extension's cached ActiveSession copy,
// and assertEntitlement all key off it.
export interface Entitlements {
  voice_premium: boolean
  misconception_graph: boolean
  spaced_reinforcement: boolean
  full_dashboard: boolean
  unlimited_history: boolean
  image_capture: ImageCaptureStage
}

// A flag name, for assertEntitlement(supabase, flag).
export type EntitlementFlag = keyof Entitlements

// The free-tier flag set: every Pro capability off, image_capture 'off'. Also
// the safe fallback when a billing read fails (display defaults to free — never
// accidentally grants Pro).
export const FREE_ENTITLEMENTS: Entitlements = {
  voice_premium: false,
  misconception_graph: false,
  spaced_reinforcement: false,
  full_dashboard: false,
  unlimited_history: false,
  image_capture: 'off',
}

// The default staged-rollout stage for image_capture for a Pro user. Kept
// conservative ('off') until image capture ships; flipping this to 'beta'/'on'
// is a one-line rollout change, and a per-user `overrides.image_capture` can
// stage specific rollout testers ahead of the global default (PLAN §2.8's
// "overridable per-user for staged rollouts").
const DEFAULT_IMAGE_CAPTURE_STAGE: ImageCaptureStage = 'off'

export interface EntitlementOverrides {
  // Per-user staged-rollout override for image_capture; when present it wins
  // over the tier-derived default. There is no per-user override column today
  // (a future additive add), so callers pass nothing and the defaults apply —
  // the parameter exists so the override plumbs through the moment it lands.
  image_capture?: ImageCaptureStage
}

// resolveEntitlements(tier, status, overrides?) → the flag set.
//
// PRO IS GATED ON `tier` — the single grace authority. The webhook (Task 4) and
// the reconcile cron (Task 5) keep `subscription_tier` consistent with the
// grace decision: `invoice.payment_failed` moves a user to past_due with tier
// RETAINED ('pro') for the grace window, and only a terminal
// customer.subscription.deleted or the reconcile cron's grace-expiry flips tier
// to 'free'. So `past_due` + tier 'pro' = in grace (Pro flags stay on), and a
// grace-expired / canceled row is already tier 'free' (flags off). Keying on
// tier here means the resolver and the start_session RPC — which gates the
// session cap on the SAME `subscription_tier = 'free'` predicate — can never
// disagree.
//
// `status` is accepted (the mandated signature; it mirrors the users billing
// columns and is available for a future refinement) but deliberately does NOT
// gate: deriving Pro from the raw Stripe status string would risk splitting the
// resolver from the RPC's tier gate. The grace decision lives in tier, by design.
export function resolveEntitlements(
  tier: string | null | undefined,
  status: string | null | undefined,
  overrides?: EntitlementOverrides
): Entitlements {
  const isPro = tier === 'pro'

  if (!isPro) {
    // Free (or grace-expired, or a not-yet-healed inconsistent row) → the free
    // set. A per-user override can still stage image_capture for a rollout
    // tester independent of tier.
    return {
      ...FREE_ENTITLEMENTS,
      image_capture: overrides?.image_capture ?? FREE_ENTITLEMENTS.image_capture,
    }
  }

  return {
    voice_premium: true,
    misconception_graph: true,
    spaced_reinforcement: true,
    full_dashboard: true,
    unlimited_history: true,
    image_capture: overrides?.image_capture ?? DEFAULT_IMAGE_CAPTURE_STAGE,
  }
}

// Whether a resolved flag value grants access. Boolean flags grant iff true;
// image_capture (staged) grants iff not 'off' ('beta'/'on' both confer access,
// with the caller deciding whether 'beta' gating is enough). The single place
// the flag-value → boolean-access mapping lives, shared by assertEntitlement.
export function isEntitlementGranted(value: Entitlements[EntitlementFlag]): boolean {
  return typeof value === 'boolean' ? value : value !== 'off'
}
