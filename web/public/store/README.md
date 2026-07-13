# Chrome Web Store screenshots — drop the captured PNGs here

Sprint 19 / Task 7 (ADR-045). The Chrome Web Store listing screenshots live in
this folder and are served at `/store/<name>.png`. The listing copy + full shot
list + captions are in **`docs/store-listing.md`**.

## Why these aren't generated

The store requires screenshots of the **real product**, and CWS policy forbids
misleading/mockup imagery. Calyxa's UI is a shadow-DOM overlay that only renders
when the extension is loaded in Chrome — so these must be captured from the
**actual extension**, not from the marketing demo (which is a token-driven
recreation, ADR-031) and not fabricated. Claude cannot capture them: its in-app
browser can't load an unpacked extension. This is a manual capture step.

## How to capture (Darcy)

1. Build the extension: `npm run build` in `/extension` (→ `dist/chrome-mv3`).
2. In Chrome: `chrome://extensions` → Developer mode on → **Load unpacked** →
   select `extension/dist/chrome-mv3`.
3. Sign in, open a real math page (a homework/practice page or a PDF with an
   algebra problem), and open the overlay (**Alt+Shift+C**).
4. Run a short real session so annotations / check-in / recap appear.
5. Capture each shot at **exactly 1280×800 PNG** (resize the window or crop to
   1280×800). macOS: `⌘⇧4` for a region, or capture the window and crop.
6. Save into this folder with the names below.

## Expected files (see docs/store-listing.md for captions)

| File | Shot |
|---|---|
| `01-opening-scan.png` | Overlay open, opening scan reading an algebra problem |
| `02-annotation.png` | A turn with a Meadow annotation pointing at the step |
| `03-voice.png` | Mic active / spoken explanation in progress |
| `04-checkin-or-recap.png` | Check-in (prediction) card or end-of-session recap |
| `promo-tile.png` *(optional)* | 440×280 small promo tile |

All listing screenshots must be **1280×800**. 3 strong shots are enough; 5 max.

> Want help? If you load the extension in your own Chrome and get to a good
> session state, Claude can drive the capture via the Claude-in-Chrome browser
> (it's your real Chrome, where the unpacked extension can load) — just ask.
