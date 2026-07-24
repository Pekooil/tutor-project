// Single source of the Chrome Web Store listing URL for the "Add to Chrome"
// CTAs. The new install flow sends visitors straight to the CWS (they install,
// then onboard INSIDE the extension), so the marketing CTAs link here instead of
// the old /start wizard.
//
// The id `gedmlagmmllpohdkdpeocpbnmofegnbm` is the real Calyxa CWS item; override
// with NEXT_PUBLIC_CALYXA_STORE_URL if the listing URL ever changes. Kept in sync
// with the fallback in web/app/welcome/page.tsx (which imports this).
export const STORE_URL =
  process.env.NEXT_PUBLIC_CALYXA_STORE_URL ??
  'https://chromewebstore.google.com/detail/gedmlagmmllpohdkdpeocpbnmofegnbm'
