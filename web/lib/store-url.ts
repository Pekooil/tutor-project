// Single source of the Chrome Web Store listing URL.
//
// Who links here, as of the two-workflow onboarding (2026-07-25): the
// post-login empty states, which need to say "you have no sessions because the
// extension isn't installed yet". The marketing CTAs deliberately do NOT — they
// go to /start, the three-question wizard that opens workflow 1 (sign up on the
// web), and the extension is installed from there.
//
// The id `gedmlagmmllpohdkdpeocpbnmofegnbm` is the real Calyxa CWS item; override
// with NEXT_PUBLIC_CALYXA_STORE_URL if the listing URL ever changes. This is now
// the SINGLE definition (the duplicate fallback in the retired /welcome page went
// with it).
export const STORE_URL =
  process.env.NEXT_PUBLIC_CALYXA_STORE_URL ??
  'https://chromewebstore.google.com/detail/gedmlagmmllpohdkdpeocpbnmofegnbm'
