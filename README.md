<img src="icons/logo.svg" width="72" alt="unboxx logo">

# unboxx

**See where a link really goes before you click it.**

Rest your pointer on any link, on any site. unboxx opens a small preview card with the destination, a picture of the page, and anything worth knowing: trackers it removed, redirects it followed, and warnings when something looks off.

## What it does

### Previews
- **Preview card on hover** with the site's share image (or an optional live screenshot), favicon, title and clean destination.
- **Keyboard friendly.** Tab to a link and the same preview opens. Single-key shortcuts while a preview is open.
- **Pin and drag.** Press `P` or drag the header to keep a preview on screen while you read.
- **Hold-to-preview mode.** Previews only appear while you hold Alt (Option on Mac), if you prefer them out of the way.
- **Email, phone and SMS links** get their own card with copy and open actions.

### Cleaning
- **Removes 250+ tracking parameters** (`utm_*`, `fbclid`, `gclid`, `mc_eid`, HubSpot, Matomo and more) plus site-specific junk on Amazon, YouTube, X, Instagram, TikTok, LinkedIn, Spotify, Reddit, eBay, AliExpress, Etsy and others.
- **Skips redirect wrappers locally**: Google, Facebook, Instagram, Threads, Outlook Safe Links, Proofpoint, Slack, Reddit, YouTube, Steam, DuckDuckGo, Bing, VK, LinkedIn, Pinterest and more. Decoded on your device, so the wrapper never sees the click.
- **Expands short links** (bit.ly, t.co, tinyurl and 50+ others) by following the real redirect chain, including meta-refresh hops.
- **Cleans on click.** Normal clicks, middle clicks and "Copy link address" all get the clean URL.
- **Clean all links on a page** from the toolbar popup.
- **Strict mode** for `ref`, `source`, affiliate tags and other parameters that are usually, but not always, tracking.

### Safety
- **Link text that lies**: warns when a link says `paypal.com` but goes somewhere else.
- **Look-alike domains** (punycode), hidden hosts (`user@host` tricks), raw IP addresses and unusual domain endings.
- **App downloads** (`.exe`, `.dmg`, `.apk` and more) with file type and size.
- **Broken links** (404/410) and sign-in walls.
- **Google Safe Browsing** (optional, your own free API key) for known malware and phishing. Dangerous previews are blurred and need a second click to open.
- **Action links** like logout or unsubscribe are never loaded in the background.

### Everything else
- **Toolbar popup**: per-site switch, link stats for the current page, "Unbox a link" box for pasting any URL, recent history, lifetime stats.
- **Toolbar badge** counts tracked links on the current page.
- **Right-click menu**: copy clean link, open clean link, copy as Markdown, copy clean page address, pause on this site.
- **Global shortcuts**: `Alt+Shift+C` copies the clean address of the current page, `Alt+Shift+U` pauses unboxx on the current site. Change them at `chrome://extensions/shortcuts`.
- **Copy as Markdown** from any preview.
- **Wayback Machine and VirusTotal** shortcuts in the details panel.
- **Light, dark or system theme.**

## Keyboard shortcuts in a preview

| Key | Action |
| --- | --- |
| `C` | Copy link |
| `Shift` `C` | Copy clean link |
| `M` | Copy as Markdown |
| `O` | Open in new tab |
| `B` | Open in background tab |
| `P` | Pin or unpin |
| `D` | Show details |
| `Esc` | Close |

## Privacy

- unboxx has no servers. Links are fetched straight from your browser **without cookies**, so previews never act as you on a site.
- History and stats live in local extension storage and are never kept in incognito.
- Two features send data elsewhere, and both are off until you turn them on: the screenshot preview (sends the link to WordPress mShots) and Safe Browsing (sends the link to Google).

## Install

1. Clone this repo.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and pick the repo folder.

A settings page opens with a short tour. To add a Safe Browsing key, open settings, go to **Safety**, paste the key and press **Save**. unboxx checks the key before saving it.

## How it's built

- Manifest V3, plain JavaScript, no build step.
- `lib/rules.js` holds all URL rules (tracking parameters, redirect wrappers, shorteners, risk checks) and runs everywhere.
- `lib/card.js` renders the preview card for both the page overlay and the popup.
- `content.js` uses one set of delegated listeners for the whole page and renders inside a closed shadow root, so site CSS can't break the card and the card can't leak styles into the site.
- `background.js` makes one streamed request per link, reads only as much HTML as it needs, tracks the redirect chain with `webRequest`, and caches results in IndexedDB for 3 days.
- Preview images are drawn onto a canvas, so they show up even on sites with strict image policies.
- Icons are [Phosphor](https://phosphoricons.com) (MIT), bundled locally in `lib/icons.js`.

## License

MIT. See LICENSE.md.
