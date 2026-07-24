import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountOverlay, unmountOverlay } from '../overlay/mount';
import { buildScriptedTransports } from './script';
import { OnboardingChrome } from './OnboardingChrome';
import './main.css';

// In-extension onboarding entry (Option 1 interactive demo). Opened in a new tab
// on install (background/index.ts onInstalled) or from the signed-out popup.
//
// It renders the coach + mock worksheet (OnboardingChrome) and mounts the REAL
// Overlay pill via the same mountOverlay the content script uses — but with
// fully scripted transports (script.ts), so the student drives a real pill
// through a canned factoring lesson with no backend, no auth, no cost. When the
// demo lands, they're handed off to the website to create an account; the
// web→extension bridge (background onMessageExternal) then signs this extension
// in, which this page detects via chrome.storage and celebrates.

// The extension is never an auth surface (locked ADR) — account creation happens
// on the website's unified panel, and the bridge pushes the session back.
const SIGNUP_URL = 'https://calyxa.app/signup?src=onboarding';

// The background stores the bridged session under this key in chrome.storage.session.
const AUTH_KEY = 'calyxa_auth';

// The page only ever runs as an extension page, where chrome.* always exists.
// The guard is defensive hygiene (a stray non-extension load degrades to the
// visual demo instead of hard-crashing on an undefined chrome).
const hasChrome = typeof chrome !== 'undefined';

/** Marks onboarding done so neither this page nor the on-page first-run tour nags again. */
function markOnboarded(): void {
  if (hasChrome && chrome.storage?.local) void chrome.storage.local.set({ onboarded: true, tutorialSeen: true });
}

function Onboarding() {
  const [step, setStep] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);

  // Mount the real pill once, with scripted transports whose hooks advance the
  // coach as the student actually scans / sends a turn.
  useEffect(() => {
    const container = pillRef.current;
    if (!container) return;
    const root = mountOverlay(
      container,
      buildScriptedTransports({
        onScan: () => setStep((s) => Math.max(s, 1)),
        onTurn: () => {
          setStep((s) => Math.max(s, 2));
          markOnboarded();
        },
      }),
    );
    return () => unmountOverlay(root);
  }, []);

  // Reflect the bridged sign-in: read once, then watch for the background writing
  // the session (AUTH_SESSION) into chrome.storage.session while this tab is open.
  useEffect(() => {
    if (!hasChrome || !chrome.storage?.session) return;
    void chrome.storage.session.get(AUTH_KEY).then((stored) => {
      if (stored[AUTH_KEY]) setSignedIn(true);
    });
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'session' && AUTH_KEY in changes) {
        setSignedIn(Boolean(changes[AUTH_KEY].newValue));
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  function handleSignUp() {
    markOnboarded();
    // chrome.tabs in the extension; window.open as a plain-browser fallback.
    if (hasChrome && chrome.tabs?.create) void chrome.tabs.create({ url: SIGNUP_URL });
    else window.open(SIGNUP_URL, '_blank', 'noreferrer');
  }

  return (
    <>
      <OnboardingChrome step={step} signedIn={signedIn} onSignUp={handleSignUp} />
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
