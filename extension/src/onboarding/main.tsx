import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountOverlay, unmountOverlay } from '../overlay/mount';
import { buildScriptedTransports } from './script';
import { OnboardingChrome } from './OnboardingChrome';
import './main.css';

// In-extension onboarding entry — the SECOND and only remaining onboarding
// workflow (two-workflow rule, 2026-07-25). Opened in a new tab by the
// background worker the first time the web→extension bridge signs this
// extension in (background/index.ts openOnboardingOnce), i.e. straight after
// the student finishes signing up on the website.
//
// It renders the coach + mock worksheet (OnboardingChrome) and mounts the REAL
// Overlay pill via the same mountOverlay the content script uses — but with
// fully scripted transports (script.ts), so the student drives a real pill
// through a canned factoring lesson with no backend, no auth, no cost.
//
// What changed when this became post-signup: the page no longer hands off to
// the website to create an account (that already happened — it is why this tab
// is open) and no longer watches chrome.storage for the bridge. It is now purely
// a lesson that ends by sending the student off to study. This page is also the
// ONLY teaching surface left: the in-pill first-run tour (overlay/Tutorial.tsx)
// was removed rather than left to re-teach the same four things on the first
// real page.

// The page only ever runs as an extension page, where chrome.* always exists.
// The guard is defensive hygiene (a stray non-extension load degrades to the
// visual demo instead of hard-crashing on an undefined chrome).
const hasChrome = typeof chrome !== 'undefined';

function Onboarding() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);

  // Mount the real pill once, with scripted transports whose hooks advance the
  // coach as the student actually scans / sends a turn.
  //
  // The turn number matters. Turn 1 is the tutor's OPENER, which the Overlay
  // auto-sends after the check-in — the student has not done anything yet, so
  // it advances the coach but must NOT end the lesson (celebrating there wipes
  // the coach off screen while the tutor is still mid-sentence). Turn 2 is the
  // student's own first answer, and seeing it coached rather than solved is
  // exactly what "taught" means here — that is the beat to land on.
  useEffect(() => {
    const container = pillRef.current;
    if (!container) return;
    const root = mountOverlay(
      container,
      buildScriptedTransports({
        onScan: () => setStep((s) => Math.max(s, 1)),
        onTurn: (turn) => {
          setStep((s) => Math.max(s, 2));
          if (turn >= 2) setDone(true);
        },
      }),
    );
    return () => unmountOverlay(root);
  }, []);

  // "Go study" simply closes this tab: the student is already signed in and the
  // pill is already live on every page, so there is nothing further to set up.
  function handleFinish() {
    if (hasChrome && chrome.tabs?.getCurrent) {
      void chrome.tabs.getCurrent().then((tab) => {
        if (tab?.id != null) void chrome.tabs.remove(tab.id);
      });
    } else {
      window.close();
    }
  }

  return (
    <>
      <OnboardingChrome step={step} done={done} onFinish={handleFinish} />
      {/* The real Overlay mounts here and floats fixed at the bottom-center. */}
      <div ref={pillRef} />
    </>
  );
}

// Theme the page tokens ([data-theme] activates the .dark block in theme.css)
// following the OS, mirroring how the overlay themes its own shadow root — so the
// page chrome and the pill are cohesively light or dark together.
const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  document.documentElement.dataset.theme = themeQuery.matches ? 'dark' : 'light';
}
applyTheme();
themeQuery.addEventListener('change', applyTheme);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Onboarding />
    </StrictMode>,
  );
}
