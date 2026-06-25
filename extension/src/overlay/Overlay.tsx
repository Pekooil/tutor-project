import './Overlay.css';

// MathMentor overlay — Sprint 02 placeholder.
//
// Presentational only. This component knows nothing about chrome.* APIs,
// messaging, or the keyboard shortcut — those live in the content and
// background scripts and are wired up in Tasks 3–4. It renders a single fixed
// panel so the host page stays visible behind it.
//
// All styling lives in Overlay.css, which the content script injects INTO the
// shadow root (cssInjectionMode: 'ui', Task 3) so nothing bleeds onto — or in
// from — the host page. See /docs/adr/ADR-002-overlay-shadow-dom.md.
export function Overlay() {
  return <div className="mm-overlay">MathMentor</div>;
}
