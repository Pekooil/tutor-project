#!/usr/bin/env python3
# ruff: noqa: E501
"""
Calyxa — REAL per-session Claude cost, measured from production usage logs
==========================================================================

Companion to `cost_analysis.py`. Where that script *models* the cost from the
request shape, this one *measures* it from the actual `response.usage` numbers
the running server logs, now that ADR-037 prompt caching is live on Haiku 4.5.

INPUT — the CALYXA_LOG_USAGE stream
-----------------------------------
`web/lib/ai/claude.ts` and `web/app/api/ai/turn/route.ts` call

    logTurnUsage(label, response.usage)   // gated on CALYXA_LOG_USAGE

which prints, once per Claude call:

    [ADR-037 usage:LABEL] {"input_tokens":..,"cache_read_input_tokens":..,
                           "cache_creation_input_tokens":..,"output_tokens":..}

LABEL is one of: opening-scan | session-start | turn | voice-stream.

Capture a real sample:

    # in /web, with a real acceptance session driven through the extension:
    CALYXA_LOG_USAGE=1 npm run dev  2>&1 | tee /tmp/calyxa-usage.log

then feed the captured terminal output to this script:

    python3 cost_real.py < /tmp/calyxa-usage.log
    python3 cost_real.py /tmp/calyxa-usage.log
    pbpaste | python3 cost_real.py            # paste straight from clipboard

Only lines matching the `[ADR-037 usage:...]` shape are read; everything else
in the dev-server stream is ignored, so you can pipe the whole log in raw.

WHAT IT COMPUTES  (task deliverable)
------------------------------------
  - mean and p90 cost/session,
  - the cache hit rate  cache_read / (cache_read + cache_creation + input),
  - the real per-request-kind token distribution (mean/p50/p90/max input &
    output, mean cache_read / cache_creation) — the numbers the GPT-4o-mini
    estimate step consumes next,
and reconciles the measured mean against `cost_analysis.py`'s model estimate.

PRICING  (Claude Haiku 4.5, public list — per 1,000,000 tokens)
---------------------------------------------------------------
  input (uncached)      $1.00
  output                $5.00
  cache_read   0.1x in  $0.10
  cache_write  (see note) — cache_creation_input_tokens

  NOTE ON CACHE-WRITE COST: the task brief assumes cache_write ~= 1.25x input
  ($1.25/MTok), which is Anthropic's *5-minute* TTL rate. But the live code
  (system-prompt.ts: `cache_control: { type: 'ephemeral', ttl: '1h' }`) uses
  the *1-hour* TTL, which bills 2x input ($2.00/MTok). This script defaults to
  the real 1h rate (2.0x) and flags the difference in the reconciliation.
  Override with --cache-write-mult if the TTL changes.

SESSION SEGMENTATION
--------------------
`logTurnUsage` carries no session id, so calls are grouped into sessions by the
call flow (documented + printed so you can sanity-check it):
  - an `opening-scan` always starts a new session;
  - a `session-start` starts a new session unless it directly follows an
    opening-scan with no turns yet (scan -> start is the same session);
  - `turn` / `voice-stream` attach to the current session.
A blank line or a `---` / `===` separator line in the input FORCES a boundary,
so you can also paste sessions pre-split. Override the heuristic with
--split-on {flow,separator,session-start}.

    python3 cost_real.py --selftest    # parse+compute a SYNTHETIC fixture to
                                       # prove the tool works (clearly labelled
                                       # NOT real data)
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, field
from statistics import mean, median

# ---------------------------------------------------------------------------
# Pricing (Haiku 4.5, per MTok)
# ---------------------------------------------------------------------------
IN_PER_MTOK = 1.00
OUT_PER_MTOK = 5.00
CACHE_READ_MULT = 0.10          # cache_read bills 0.1x input
CACHE_WRITE_MULT_1H = 2.00      # ttl:'1h' (what the live code uses)
CACHE_WRITE_MULT_5M = 1.25      # ttl:'5m' (the task brief's assumption)

# ADR-037's own modelled figures, for reconciliation (see docs/adr/ADR-037).
ADR037_UNCACHED_SESSION_USD = 0.108   # pre-caching model
ADR037_CACHED_SESSION_USD = 0.040     # post-caching model target

# GPT-4o-mini (OpenAI public list, per MTok) — the migration candidate.
GPT_IN_PER_MTOK = 0.15
GPT_OUT_PER_MTOK = 0.60
# OpenAI automatic prompt caching: cached input tokens bill at 50% off, and
# there is NO write premium (a cold prefix is just normal input). This is the
# structural difference from Anthropic (write 1.25x / read 0.1x). We map
# Calyxa's SAME stable-prefix structure across: the tokens Anthropic reported
# as cache_write (a prefix's first sighting) bill full GPT input; the tokens it
# reported as cache_read (reuse) bill GPT input * 0.5.
GPT_CACHED_IN_MULT = 0.50

LABELS = ("opening-scan", "session-start", "turn", "voice-stream")
BOUNDARY_LABELS = ("opening-scan", "session-start")

USAGE_LINE = re.compile(r"\[ADR-037 usage:([a-z0-9-]+)\]\s*(\{.*\})")
SEPARATOR = re.compile(r"^\s*(?:[-=]{3,}|#\s*session\b.*)\s*$", re.I)


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
@dataclass
class Call:
    label: str
    input: int              # uncached input tokens (full price)
    cache_read: int         # served from cache (~0.1x)
    cache_write: int        # cache_creation total (write premium)
    output: int
    write_5m: int = 0       # cache_creation.ephemeral_5m_input_tokens (1.25x)
    write_1h: int = 0       # cache_creation.ephemeral_1h_input_tokens (2.0x)

    @property
    def prompt_tokens(self) -> int:
        return self.input + self.cache_read + self.cache_write

    def _write_cost_tok(self, cache_write_mult: float) -> float:
        """Cache-creation cost in token-price units. Prefer the per-TTL split
        the usage object reports (authoritative — 5m bills 1.25x, 1h bills
        2.0x); fall back to the flat total x cache_write_mult when the API
        response carries no breakdown."""
        if self.write_5m or self.write_1h:
            return self.write_5m * CACHE_WRITE_MULT_5M + self.write_1h * CACHE_WRITE_MULT_1H
        return self.cache_write * cache_write_mult

    def cost_usd(self, cache_write_mult: float) -> float:
        return (
            self.input * IN_PER_MTOK
            + self.cache_read * IN_PER_MTOK * CACHE_READ_MULT
            + self._write_cost_tok(cache_write_mult) * IN_PER_MTOK
            + self.output * OUT_PER_MTOK
        ) / 1_000_000

    def cost_gpt_usd(self, tok_mult: float = 1.0) -> float:
        """GPT-4o-mini cost for the same call, crediting OpenAI auto-caching.
        Anthropic cache_write tokens (a prefix's first sighting) -> full GPT
        input; cache_read tokens (reuse) -> GPT input * 0.5; volatile input ->
        full; output -> GPT output. tok_mult rescales Claude-tokenizer counts
        into o200k_base (default 1.0, within a few %)."""
        return (
            (self.input + self.cache_write) * GPT_IN_PER_MTOK
            + self.cache_read * GPT_IN_PER_MTOK * GPT_CACHED_IN_MULT
            + self.output * GPT_OUT_PER_MTOK
        ) * tok_mult / 1_000_000


@dataclass
class Session:
    calls: list[Call] = field(default_factory=list)

    def cost_usd(self, m: float) -> float:
        return sum(c.cost_usd(m) for c in self.calls)

    def cost_gpt_usd(self, tok_mult: float = 1.0) -> float:
        return sum(c.cost_gpt_usd(tok_mult) for c in self.calls)

    def totals(self) -> dict[str, int]:
        return {
            "calls": len(self.calls),
            "input": sum(c.input for c in self.calls),
            "cache_read": sum(c.cache_read for c in self.calls),
            "cache_write": sum(c.cache_write for c in self.calls),
            "output": sum(c.output for c in self.calls),
        }


# ---------------------------------------------------------------------------
# Parsing + segmentation
# ---------------------------------------------------------------------------
def parse_calls(text: str) -> list[list[Call] | None]:
    """Return a token stream: Call objects plus None markers for explicit
    separators (used only in separator/flow split modes)."""
    stream: list = []
    for line in text.splitlines():
        if SEPARATOR.match(line):
            stream.append(None)
            continue
        m = USAGE_LINE.search(line)
        if not m:
            continue
        label = m.group(1)
        try:
            u = json.loads(m.group(2))
        except json.JSONDecodeError:
            print(f"WARNING: could not parse usage JSON on line: {line.strip()[:120]}", file=sys.stderr)
            continue
        cc = u.get("cache_creation") or {}
        stream.append(
            Call(
                label=label,
                input=int(u.get("input_tokens", 0) or 0),
                cache_read=int(u.get("cache_read_input_tokens", 0) or 0),
                cache_write=int(u.get("cache_creation_input_tokens", 0) or 0),
                output=int(u.get("output_tokens", 0) or 0),
                write_5m=int(cc.get("ephemeral_5m_input_tokens", 0) or 0),
                write_1h=int(cc.get("ephemeral_1h_input_tokens", 0) or 0),
            )
        )
    return stream


def segment(stream: list, mode: str) -> list[Session]:
    sessions: list[Session] = []
    cur: Session | None = None
    force_boundary = False

    def new() -> Session:
        s = Session()
        sessions.append(s)
        return s

    for tok in stream:
        if tok is None:  # explicit separator
            force_boundary = True
            continue
        call: Call = tok

        start_new = False
        if cur is None or force_boundary:
            start_new = True
        elif mode == "session-start":
            start_new = call.label in BOUNDARY_LABELS
        elif mode == "flow":
            if call.label == "opening-scan":
                start_new = True
            elif call.label == "session-start":
                seen = {c.label for c in cur.calls}
                # scan -> start is the SAME session; otherwise a new one.
                start_new = bool(seen - {"opening-scan"}) or "session-start" in seen
            # turn / voice-stream always attach
        # mode == "separator": only the explicit separators split (handled above)

        if start_new:
            cur = new()
        elif cur is None:
            cur = new()
        cur.calls.append(call)
        force_boundary = False

    return [s for s in sessions if s.calls]


# ---------------------------------------------------------------------------
# Stats helpers
# ---------------------------------------------------------------------------
def p90(xs: list[float]) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    # nearest-rank
    k = max(1, math.ceil(0.90 * len(s)))
    return s[k - 1]


def dist(xs: list[int]) -> dict[str, float]:
    if not xs:
        return {"n": 0, "mean": 0, "p50": 0, "p90": 0, "max": 0}
    return {
        "n": len(xs),
        "mean": mean(xs),
        "p50": median(xs),
        "p90": p90([float(x) for x in xs]),
        "max": max(xs),
    }


def money(x: float) -> str:
    if x < 0.01:
        return f"${x:.6f}"
    if x < 1:
        return f"${x:.4f}"
    return f"${x:,.2f}"


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
BAR = "=" * 68


def model_baseline() -> dict | None:
    """Reuse cost_analysis.py (heuristic mode) to get the MODEL's own estimate,
    for reconciliation. Returns None if it can't be imported/run."""
    try:
        import cost_analysis as ca  # type: ignore
    except Exception as e:  # pragma: no cover
        print(f"(note: could not import cost_analysis.py for reconciliation: {e})", file=sys.stderr)
        return None
    cfg = ca.Config()
    cfg.token_mode = "heuristic"
    counter = ca.TokenCounter(cfg)
    sess = ca.model_session(cfg, counter)
    in_tok, out_tok = sess.total_input, sess.total_output
    uncached = (in_tok * IN_PER_MTOK + out_tok * OUT_PER_MTOK) / 1_000_000
    return {
        "calls": sess.total_calls,
        "input": in_tok,
        "output": out_tok,
        "uncached_usd": uncached,
        "responses": cfg.student_responses,
    }


def provider_comparison(sessions: list[Session], cache_write_mult: float, gpt_mult: float) -> None:
    n = len(sessions)
    haiku = [s.cost_usd(cache_write_mult) for s in sessions]
    gpt = [s.cost_gpt_usd(gpt_mult) for s in sessions]
    h_mean, g_mean = mean(haiku), mean(gpt)
    delta = h_mean - g_mean
    pct = (delta / h_mean * 100) if h_mean else 0.0

    print()
    print(BAR)
    print("PROVIDER COMPARISON  (cached Haiku 4.5  vs  cached GPT-4o-mini)")
    print(BAR)
    print(f"  priced on REAL measured tokens ({n} session{'s' if n != 1 else ''}); "
          f"o200k_base multiplier = {gpt_mult:.2f}x (Claude-token counts ~= o200k within a few %)")
    print(f"  GPT caching credited: cache_write tokens -> full input $0.15; "
          f"cache_read tokens -> $0.075 (50% off); NO write premium")
    print()
    print(f"  {'':<26}{'cached Haiku 4.5':>18}{'cached GPT-4o-mini':>20}")
    print(f"  {'-'*64}")
    print(f"  {'mean cost / session':<26}{money(h_mean):>18}{money(g_mean):>20}")
    print(f"  {'p90 cost / session':<26}{money(p90(haiku)):>18}{money(p90(gpt)):>20}")
    print(f"  {'absolute saving / session':<26}{'':>18}{money(delta):>20}")
    print(f"  {'% reduction (after caching)':<26}{'':>18}{pct:>18.1f} %")

    print()
    print("  Scaled (mean x N sessions):")
    print(f"    {'sessions':>10} | {'cached Haiku':>14} | {'cached GPT-4o-mini':>18} | {'saving':>14} | {'reduction':>9}")
    print("    " + "-" * 78)
    for N in (100, 1_000, 10_000, 100_000):
        h, g = h_mean * N, g_mean * N
        print(f"    {N:>10,} | {money(h):>14} | {money(g):>18} | {money(h - g):>14} | {pct:>7.1f} %")

    # per-kind provider split, so the driver is visible
    print()
    print("  Where the delta comes from (all calls, USD):")
    all_calls = [c for s in sessions for c in s.calls]
    h_in = sum(c.input for c in all_calls) * IN_PER_MTOK / 1e6
    h_rd = sum(c.cache_read for c in all_calls) * IN_PER_MTOK * CACHE_READ_MULT / 1e6
    h_wr = sum(c._write_cost_tok(cache_write_mult) for c in all_calls) * IN_PER_MTOK / 1e6
    h_out = sum(c.output for c in all_calls) * OUT_PER_MTOK / 1e6
    g_in = sum(c.input + c.cache_write for c in all_calls) * GPT_IN_PER_MTOK * gpt_mult / 1e6
    g_rd = sum(c.cache_read for c in all_calls) * GPT_IN_PER_MTOK * GPT_CACHED_IN_MULT * gpt_mult / 1e6
    g_out = sum(c.output for c in all_calls) * GPT_OUT_PER_MTOK * gpt_mult / 1e6
    print(f"    {'component':<24}{'Haiku':>12}{'GPT-4o-mini':>14}")
    print(f"    {'uncached input':<24}{money(h_in):>12}{money(g_in):>14}  (GPT folds cache_write here, no premium)")
    print(f"    {'cache_read':<24}{money(h_rd):>12}{money(g_rd):>14}")
    print(f"    {'cache_write':<24}{money(h_wr):>12}{'(in input)':>14}")
    print(f"    {'output':<24}{money(h_out):>12}{money(g_out):>14}")


def report(sessions: list[Session], cache_write_mult: float, mode: str, synthetic: bool, gpt_mult: float = 1.0) -> None:
    all_calls = [c for s in sessions for c in s.calls]
    if not all_calls:
        print("No `[ADR-037 usage:...]` lines found in the input.\n"
              "Capture with: CALYXA_LOG_USAGE=1 npm run dev 2>&1 | tee /tmp/calyxa-usage.log\n"
              "then: python3 cost_real.py /tmp/calyxa-usage.log", file=sys.stderr)
        sys.exit(2)

    print()
    print(BAR)
    print("CALYXA — REAL cached-Haiku 4.5 cost, measured from usage logs")
    if synthetic:
        print("  ⚠️  SYNTHETIC SELF-TEST FIXTURE — NOT REAL DATA  ⚠️")
    print(BAR)
    print(f"Sessions parsed     : {len(sessions)}")
    print(f"Total Claude calls  : {len(all_calls)}")
    print(f"Segmentation mode   : {mode}")
    has_split = any(c.write_5m or c.write_1h for c in all_calls)
    if has_split:
        print("Cache-write pricing : per-call TTL from usage (5m=1.25x, 1h=2.0x); "
              f"flat fallback {cache_write_mult:.2f}x where absent")
    else:
        print(f"Cache-write pricing : {cache_write_mult:.2f}x input  "
              f"({'1h TTL' if cache_write_mult == CACHE_WRITE_MULT_1H else '5m TTL' if cache_write_mult == CACHE_WRITE_MULT_5M else 'custom'}) — no per-call breakdown in logs")

    # ---- Per-session cost -------------------------------------------------
    costs = [s.cost_usd(cache_write_mult) for s in sessions]
    print()
    print(BAR)
    print("PER-SESSION COST  (mean, p90)")
    print(BAR)
    print(f"  {'metric':<26}{'value':>14}")
    print(f"  {'-'*40}")
    print(f"  {'sessions (n)':<26}{len(sessions):>14}")
    print(f"  {'mean cost / session':<26}{money(mean(costs)):>14}")
    print(f"  {'median cost / session':<26}{money(median(costs)):>14}")
    print(f"  {'p90 cost / session':<26}{money(p90(costs)):>14}")
    print(f"  {'min / max':<26}{money(min(costs)) + ' / ' + money(max(costs)):>14}")

    # ---- Cache hit rate ---------------------------------------------------
    tot_in = sum(c.input for c in all_calls)
    tot_read = sum(c.cache_read for c in all_calls)
    tot_write = sum(c.cache_write for c in all_calls)
    tot_out = sum(c.output for c in all_calls)
    denom = tot_read + tot_write + tot_in
    hit_rate = tot_read / denom if denom else 0.0
    print()
    print(BAR)
    print("CACHE PERFORMANCE")
    print(BAR)
    print(f"  cache hit rate  = cache_read / (cache_read + cache_write + input)")
    print(f"                  = {tot_read:,} / ({tot_read:,} + {tot_write:,} + {tot_in:,})")
    print(f"                  = {hit_rate*100:.1f} %")
    print(f"  prompt tokens (all calls): input {tot_in:,} | cache_read {tot_read:,} | "
          f"cache_write {tot_write:,}")
    print(f"  output tokens (all calls): {tot_out:,}")
    w5 = sum(c.write_5m for c in all_calls)
    w1 = sum(c.write_1h for c in all_calls)
    if w5 or w1:
        ttl = ("5m only" if w1 == 0 else "1h only" if w5 == 0 else "mixed")
        print(f"  cache-write TTL (from usage): 5m {w5:,} (1.25x) | 1h {w1:,} (2.0x)  -> {ttl}")
        if w5 and w1 == 0:
            print(f"  ⚠️  live build writes 5m-TTL cache, but system-prompt.ts sets ttl:'1h'")
            print(f"      (uncommitted edit not in the running server) — priced at the real 5m 1.25x.")

    # ---- Per-request-kind token distribution ------------------------------
    print()
    print(BAR)
    print("PER-REQUEST-KIND TOKEN DISTRIBUTION  (feeds the GPT-4o-mini estimate)")
    print(BAR)
    for label in LABELS:
        cs = [c for c in all_calls if c.label == label]
        if not cs:
            continue
        di = dist([c.input for c in cs])
        do = dist([c.output for c in cs])
        mr = mean([c.cache_read for c in cs])
        mw = mean([c.cache_write for c in cs])
        mc = mean([c.cost_usd(cache_write_mult) for c in cs])
        print(f"\n  {label}   (n={len(cs)})")
        print(f"    input tokens   mean {di['mean']:>8,.0f}  p50 {di['p50']:>8,.0f}  p90 {di['p90']:>8,.0f}  max {di['max']:>8,.0f}")
        print(f"    output tokens  mean {do['mean']:>8,.0f}  p50 {do['p50']:>8,.0f}  p90 {do['p90']:>8,.0f}  max {do['max']:>8,.0f}")
        print(f"    cache_read     mean {mr:>8,.0f}   cache_write mean {mw:>8,.0f}")
        print(f"    mean cost/call {money(mc):>10}")

    # ---- Per-session breakdown (sanity-check segmentation) ----------------
    print()
    print(BAR)
    print("PER-SESSION BREAKDOWN  (verify segmentation looks right)")
    print(BAR)
    print(f"  {'#':>3} {'calls':>5} {'kinds':<34} {'in':>8} {'read':>8} {'write':>7} {'out':>6} {'cost':>10}")
    for i, s in enumerate(sessions, 1):
        t = s.totals()
        kinds = ",".join(c.label.replace("opening-scan", "scan").replace("session-start", "start")
                         .replace("voice-stream", "voice") for c in s.calls)
        kinds = (kinds[:32] + "..") if len(kinds) > 34 else kinds
        print(f"  {i:>3} {t['calls']:>5} {kinds:<34} {t['input']:>8,} {t['cache_read']:>8,} "
              f"{t['cache_write']:>7,} {t['output']:>6,} {money(s.cost_usd(cache_write_mult)):>10}")

    # ---- Reconciliation vs the model estimate -----------------------------
    print()
    print(BAR)
    print("RECONCILIATION  vs cost_analysis.py's estimate")
    print(BAR)
    real_mean = mean(costs)
    base = model_baseline()
    if base:
        print(f"  cost_analysis.py model (heuristic, NO caching):")
        print(f"    {base['calls']} calls, {base['input']:,} in + {base['output']:,} out  ->  {money(base['uncached_usd'])}/session")
    print(f"  ADR-037 modelled figures:  uncached {money(ADR037_UNCACHED_SESSION_USD)}  ->  cached target {money(ADR037_CACHED_SESSION_USD)}")
    print(f"  REAL measured mean:        {money(real_mean)}/session")
    print()
    # 5m-vs-1h sensitivity, computed on the raw write tokens (independent of
    # whatever TTL the usage object reported).
    n_sess = len(sessions)
    add_5m = (tot_write * IN_PER_MTOK * CACHE_WRITE_MULT_5M) / 1_000_000 / n_sess
    add_1h = (tot_write * IN_PER_MTOK * CACHE_WRITE_MULT_1H) / 1_000_000 / n_sess
    print(f"  Cache-write TTL sensitivity (per session, {tot_write:,} write tokens across sample):")
    print(f"    at 5m (1.25x, what the live build actually does): {money(add_5m)} of the mean")
    print(f"    at 1h (2.0x, what system-prompt.ts intends):      {money(add_1h)} of the mean "
          f"(+{money(add_1h - add_5m)})")
    print()
    print("  Gap drivers to check (why REAL may differ from the model):")
    print(f"    - cache hit rate {hit_rate*100:.1f}%: writes (cold starts / >TTL gaps / prefix")
    print( "      invalidation) bill 2x, reads bill 0.1x — the model assumed a clean cached prefix.")
    print( "    - history length: real transcripts may be longer/shorter than the modelled window,")
    print( "      changing the uncached (volatile-tail + history) tokens billed at full 1.00/MTok.")
    print( "    - output length: real `say`/tool JSON vs the model's worked-example-sized output.")
    print( "    - page-context frequency: PAGE CONTEXT sits in the volatile tail (uncached); how often")
    print( "      it is present and how large it is moves the full-price input per turn.")
    print( "    - opening-scan / session-start mix: 300-cap scan + one-shot start vs N regular turns.")

    # ---- Provider comparison ---------------------------------------------
    provider_comparison(sessions, cache_write_mult, gpt_mult)
    print()


# ---------------------------------------------------------------------------
# Self-test fixture (synthetic — proves the tool runs; NOT real numbers)
# ---------------------------------------------------------------------------
SELFTEST = """
[next] ready on http://localhost:3000
[ADR-037 usage:opening-scan] {"input_tokens":3200,"cache_read_input_tokens":0,"cache_creation_input_tokens":4100,"output_tokens":60}
[ADR-037 usage:session-start] {"input_tokens":900,"cache_read_input_tokens":4100,"cache_creation_input_tokens":0,"output_tokens":85}
[ADR-037 usage:turn] {"input_tokens":1100,"cache_read_input_tokens":4100,"cache_creation_input_tokens":0,"output_tokens":140}
[ADR-037 usage:turn] {"input_tokens":1350,"cache_read_input_tokens":4100,"cache_creation_input_tokens":0,"output_tokens":210}
[ADR-037 usage:voice-stream] {"input_tokens":1500,"cache_read_input_tokens":4100,"cache_creation_input_tokens":0,"output_tokens":260}
--- next session ---
[ADR-037 usage:session-start] {"input_tokens":950,"cache_read_input_tokens":0,"cache_creation_input_tokens":4100,"output_tokens":90}
[ADR-037 usage:turn] {"input_tokens":1200,"cache_read_input_tokens":4100,"cache_creation_input_tokens":0,"output_tokens":160}
[ADR-037 usage:turn] {"input_tokens":1400,"cache_read_input_tokens":4100,"cache_creation_input_tokens":0,"output_tokens":300}
"""


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Measure real cached-Haiku cost/session from CALYXA_LOG_USAGE logs.")
    p.add_argument("path", nargs="?", help="usage log file (default: stdin)")
    p.add_argument("--cache-write-mult", type=float, default=CACHE_WRITE_MULT_1H,
                   help=f"cache_creation price multiple vs input (default {CACHE_WRITE_MULT_1H} = live 1h TTL; 1.25 = 5m TTL)")
    p.add_argument("--split-on", choices=["flow", "separator", "session-start"], default="flow",
                   help="session segmentation strategy (default: flow)")
    p.add_argument("--gpt-token-multiplier", type=float, default=1.0,
                   help="scale Claude-tokenizer counts to o200k_base for GPT-4o-mini (default 1.0)")
    p.add_argument("--selftest", action="store_true", help="run on a synthetic fixture (NOT real data)")
    args = p.parse_args(argv)

    if args.selftest:
        text = SELFTEST
    elif args.path:
        with open(args.path, encoding="utf-8", errors="replace") as f:
            text = f.read()
    else:
        text = sys.stdin.read()

    stream = parse_calls(text)
    sessions = segment(stream, args.split_on)
    report(sessions, args.cache_write_mult, args.split_on, synthetic=args.selftest,
           gpt_mult=args.gpt_token_multiplier)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
