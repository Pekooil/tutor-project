import type { ReactNode } from 'react';
import { CalyxaMark } from '@calyxa/ui';

// Presentational chrome around the demo pill (Option 1 interactive onboarding).
// The pill itself (the real Overlay) is mounted separately by main.tsx and floats
// fixed at the bottom; this renders the narration, the mock worksheet the pill
// reads, and the sign-up hand-off. Pure — all state lives in main.tsx.

const COACH: { kicker: string; title: string; hint: ReactNode }[] = [
  {
    kicker: 'Try it',
    title: 'Meet your tutor',
    hint: (
      <>
        Calyxa lives at the bottom of any page you study on. Hover the pill below and tap its{' '}
        <strong>scan</strong> button to read this problem.
      </>
    ),
  },
  {
    kicker: 'Nice',
    title: 'It read your problem',
    hint: (
      <>
        Calyxa spotted the factoring problem and checked in. Confirm the check-in on the pill, then
        answer its question — tap a chip or type with the <strong>Aa</strong> button.
      </>
    ),
  },
  {
    kicker: "That's the idea",
    title: 'It coaches — never spoils',
    hint: (
      <>
        See how it points you at the next step instead of dumping the answer? That&rsquo;s every session.
        Ready to make it yours?
      </>
    ),
  },
];

export function OnboardingChrome({
  step,
  signedIn,
  onSignUp,
}: {
  step: number;
  signedIn: boolean;
  onSignUp: () => void;
}) {
  const coach = COACH[Math.min(step, COACH.length - 1)];

  return (
    <div className="cx-ob">
      <div className="cx-ob__wrap">
        <div className="cx-ob__brand">
          <CalyxaMark style={{ height: 22, width: 22 }} />
          <span className="cx-ob__brand-name">Calyxa</span>
        </div>

        {signedIn ? (
          <div className="cx-ob__success" role="status">
            <p className="cx-ob__success-h">You&rsquo;re all set 🎉</p>
            <p className="cx-ob__success-b">
              Your account is linked to this extension — no sign-in needed here. Open any homework page and
              press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> (⌥⇧C on Mac) to summon Calyxa.
            </p>
          </div>
        ) : (
          <div className="cx-ob__coach" aria-live="polite">
            <span className="cx-ob__kicker">{coach.kicker}</span>
            <h1 className="cx-ob__title">{coach.title}</h1>
            <p className="cx-ob__hint">{coach.hint}</p>
            <div className="cx-ob__steps" aria-hidden="true">
              {COACH.map((_, i) => (
                <span key={i} className={`cx-ob__dot${i <= step ? ' cx-ob__dot--on' : ''}`} />
              ))}
            </div>
          </div>
        )}

        {/* The mock worksheet the pill reads — serif, to read as real homework. */}
        <div className="cx-ob__sheet">
          <span className="cx-ob__eyebrow">Algebra II · Unit 4</span>
          <h2 className="cx-ob__sheet-h">Factoring practice — quadratic equations</h2>
          <div className="cx-ob__prob">
            <span className="cx-ob__prob-num">1</span>
            <span>x² + 7x + 12 = 0</span>
          </div>
          <div className="cx-ob__prob cx-ob__prob--focus">
            <span className="cx-ob__prob-num">2</span>
            <div style={{ flex: 1 }}>
              <span>x² − 5x + 6 = 0</span>
              <div className="cx-ob__blank" />
            </div>
          </div>
          <div className="cx-ob__prob">
            <span className="cx-ob__prob-num">3</span>
            <span>2x² − 8x = 0</span>
          </div>
        </div>

        {!signedIn && (
          <div className="cx-ob__cta-row">
            <button type="button" className="cx-ob__cta" onClick={onSignUp}>
              Create your free account →
            </button>
            <span className="cx-ob__cta-note">Free — takes about 20 seconds.</span>
          </div>
        )}
      </div>
    </div>
  );
}
