<p align="center">
  <img src="icons/logo.svg" width="96" alt="unboxx logo">
</p>

<h1 align="center">unboxx</h1>

<p align="center"><strong>See where a link really goes before you click it.</strong></p>

<p align="center">
  A free Chrome extension that previews links on hover, strips trackers, expands short links and flags risky destinations.<br>
  No servers. No account. Nothing leaves your browser unless you turn it on.
</p>

---

Rest your pointer on any link, on any site. unboxx opens a small preview card with the destination, a picture of the page, and anything worth knowing: the trackers it removed, the redirects it followed, and a warning when something looks off.

## Features

### Preview
- **Preview card on hover.** Shows the destination with a live view of the page (the default), the site's share image, or a screenshot, plus favicon, title and the clean link. You choose which in settings.
- **Keyboard friendly.** Tab to a link and the same card opens. Single-key shortcuts work while a card is open.
- **Pin and drag.** Press `P` or drag the header to keep a card on screen while you read.
- **Hold-to-preview mode.** Cards only appear while you hold Alt (Option on Mac), if you want them out of the way.
- **Email, phone and SMS links** get their own card with copy and open actions.

### Clean
- **Removes 250+ tracking parameters** (`utm_*`, `fbclid`, `gclid`, `mc_eid`, HubSpot, Matomo and more), plus site-specific junk on Amazon, YouTube, X, Instagram, TikTok, LinkedIn, Spotify, Reddit, eBay, AliExpress, Etsy and others.
- **Skips redirect wrappers locally.** Google, Facebook, Instagram, Threads, Outlook Safe Links, Proofpoint, Slack, Reddit, YouTube, Steam, DuckDuckGo, Bing, VK, LinkedIn, Pinterest and more are decoded on your device, so the wrapper never sees the click.
- **Expands short links** (bit.ly, t.co, tinyurl and 50+ others) by following the real redirect chain, including meta-refresh hops.
- **Cleans on click.** Normal clicks, middle clicks and "Copy link address" all get the clean URL.
- **Clean all links on a page** from the toolbar popup.
- **Strict mode** for `ref`, `source`, affiliate tags and other parameters that are usually, but not always, tracking.

### Protect
- **Link text that lies.** Warns when a link says one domain but goes to another.
- **Look-alike domains** (punycode), hidden hosts (`user@host` tricks), raw IP addresses and unusual domain endings.
- **App downloads** (`.exe`, `.dmg`, `.apk` and more) with file type and size.
- **Broken links** (404 or 410) and sign-in walls.
- **Google Safe Browsing** (optional, your own free API key) for known malware and phishing. Dangerous previews are blurred and need a second click to open.
- **Action links** like logout or unsubscribe are never loaded in the background.

### And more
- **Toolbar popup** with a per-site switch, link stats for the current page, an "Unbox a link" box for pasting any URL, recent history and lifetime stats.
- **Toolbar badge** counting the tracked links on the current page.
- **Right-click menu:** copy clean link, open clean link, copy as Markdown, copy clean page address, pause on this site.
- **Global shortcuts:** `Alt+Shift+C` copies the clean address of the current page, `Alt+Shift+U` pauses unboxx on the current site. Change them at `chrome://extensions/shortcuts`.
- **Wayback Machine and VirusTotal** shortcuts in the details panel.
- **Light, dark or system theme.**

## Keyboard shortcuts in a preview

| Key | Action |
| --- | --- |
| `C` | Copy clean link (without trackers) |
| `Shift` `C` | Copy original link |
| `M` | Copy as Markdown |
| `O` | Open in new tab |
| `B` | Open in background tab |
| `P` | Pin or unpin |
| `D` | Show details |
| `Esc` | Close |

## Install

**From the Chrome Web Store:** search for "unboxx" and click **Add to Chrome**.

**From source:**

1. Clone this repo.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and pick the repo folder.

A settings page opens with a short tour. To add a Safe Browsing key, open settings, go to **Safety**, paste the key and press **Save**. unboxx checks the key before saving it.

## Privacy

- unboxx has **no servers** and no analytics. Metadata requests (title, description, redirects) go straight from your browser to the destination **without cookies** or a referrer.
- **Live preview, the default, loads the page itself in a restricted frame**, much as if you visited it, so that page may receive cookies and make its normal requests. Choose **Site image** or **None** in settings to avoid that.
- History and stats live in local extension storage and are never kept in incognito.
- Two features send a link elsewhere, and both are **off until you turn them on**:
  - **Screenshot preview** sends the link to WordPress mShots.
  - **Safe Browsing** sends the link to Google.

## Why each permission is needed

| Permission | Why |
| --- | --- |
| Access to all sites (`<all_urls>`) | Previews and link cleaning have to work on whatever site you are reading, and each preview fetches the linked page directly. |
| `activeTab` | Reads the current page for the toolbar popup, the badge count and "Clean all links on this page". |
| `storage` | Saves your settings, history, stats and the optional Safe Browsing key on your device. |
| `contextMenus` | Adds the right-click actions for copying and opening clean links. |
| `webRequest` | Observes the redirect chain of a link so the real destination can be shown. It does not read or change page traffic. |
| `declarativeNetRequestWithHostAccess` | One session rule that removes framing headers only for frames opened by unboxx's own live preview page, never for normal browsing. |
| `offscreen` | Copies text to the clipboard when a tab has no unboxx content script. |
| `clipboardWrite` | Powers the copy actions. |

## How it's built

- Manifest V3, plain JavaScript, no build step.
- `lib/rules.js` holds all URL rules (tracking parameters, redirect wrappers, shorteners, risk checks) and runs everywhere.
- `lib/card.js` renders the preview card for both the page overlay and the popup.
- `content.js` uses one set of delegated listeners for the whole page and renders inside a closed shadow root, so site CSS can't break the card and the card can't leak styles into the site.
- `background.js` makes one streamed request per link, reads only as much HTML as it needs, tracks the redirect chain with `webRequest`, and caches results in IndexedDB for 3 days.
- Preview images are drawn onto a canvas, so they show up even on sites with strict image policies.
- Icons are [Phosphor](https://phosphoricons.com) (MIT), bundled locally in `lib/icons.js`.

## License

MIT. See [LICENSE.md](LICENSE.md).
