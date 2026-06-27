## ADR-012: Page context comes from read-only DOM extraction — stable; screen-capture/OCR is beta and deferred

**Status:** Decided

**Context:** The locked DOM policy lets the content script read the host page
but never mutate it, and the §2.5 prompt has held an empty `PAGE CONTEXT`
slot since Sprint 05. The brief is titled "screen capture + content
extraction," but PLAN §2.6 states the primary path is NOT screen capture —
it's read-only DOM extraction (text + MathML + LaTeX), which needs no
capture permission and yields clean structured math; `captureVisibleTab` →
Mathpix/Claude-vision is the beta image-equation path, flag-gated
(`features.image_capture`) and named only beta in PLAN §1's acceptance. A
shape decision was needed: build the beta capture/OCR path now (rejected —
it needs the `activeTab`/capture permission, a new backend OCR route,
Mathpix + vision, and a server feature flag, and PLAN ships it only as
beta), or ship the stable DOM path now and defer capture. Annotation
(element rects) was also in PLAN's content bundle but has no consumer
(output is plain text, ADR-008).

**Decision:** This sprint extracts page content via read-only DOM
extraction in the content script — MathML, LaTeX (KaTeX/MathJax), and
visible text, via per-renderer adapters, excluding the `<calyxa-overlay>`
shadow host, bounded to the §2.5 page-context budget. No screen capture, no
capture permission, no OCR, no vision, no annotation rects — those (the
beta image path and the annotation layer) are deferred to their own
sprints. The brief-vs-PLAN §2.6 divergence and the stable/beta line are
recorded here.

**Rationale:**
- The DOM path is the stable, high-confidence, zero-permission V1 content
  path (PLAN §2.6).
- It needs no manifest permission change and no backend OCR route, so it
  ships behind the existing read-only content script.
- Deferring capture keeps the acceptance crisp ("ask about the equation on
  your screen; the tutor references it") and matches PLAN's own beta
  designation for image equations.
- The annotation layer has no consumer yet (ADR-008), so reading rects now
  would be dead weight.
- Per-renderer adapters localise the known MathJax/KaTeX version-
  inconsistency risk (PLAN §2.10).

**Consequences:**
- Enables: a tutor that references the math on the student's screen, and a
  `PageContext` seam the annotation and beta-capture sprints extend without
  reshaping.
- Requires: the content script to read but never mutate the host page (DOM
  policy); the extractor to exclude the overlay's own shadow host; bounded
  extraction (no unbounded page text through messaging); this ADR revisited
  when the beta capture path is built (it adds `activeTab`/capture
  permission, `/extract/equation`, Mathpix + vision, and the
  `features.image_capture` flag).
- Forecloses: any host-page mutation; any screen capture / OCR / vision call
  this sprint; reading annotation rects with no consumer.
