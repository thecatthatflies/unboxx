# 🔗 unboxx

**See where links really go before you click.**

unboxx is a browser extension that reveals the true destination of any link on the web. Hover over any link to instantly see where it leads, detect tracking parameters, and avoid dangerous websites—all before you click.

## ✨ Features

### 🎯 Instant Link Preview
Hover over any link to see its final destination in a beautiful tooltip. No more mystery about where you're headed.

### 🛡️ Security Warnings
Get real-time alerts about dangerous websites, malware, and phishing attempts before you accidentally visit them.

### 🚫 Tracking Detection
Instantly spot tracking parameters (UTM codes, Facebook click IDs, and more) and remove them with one click to protect your privacy.

### 🔄 Redirect Resolution
Automatically follows redirect chains to show you the real final URL behind shortened links and redirects.

### ⚡ Lightning Fast
Smart caching means you get instant results without slowing down your browsing. Links are preloaded intelligently based on page size.

### 🌙 Beautiful Design
Clean, modern interface with dark mode support and smooth animations. Tooltips adapt to your screen and never get cut off.

## 🚀 Get Started

1. **Install the Extension**
   - Download from Chrome Web Store (coming soon)
   - Or install manually: Clone this repo → Open `chrome://extensions` → Enable Developer mode → Load unpacked

2. **Start Hovering**
   - That's it! Just hover over any link to see where it goes
   - Click buttons in the tooltip to open, copy, or visit without tracking

3. **Optional: Enable Safe Browsing**
   - For malware detection, add your free Google Safe Browsing API key
   - See [Safe Browsing Setup](#safe-browsing-setup) below

## 🎨 What You'll See

- **📧 Email Links**: Special purple badges for mailto: links
- **📱 Phone Links**: Quick-dial indicators for tel: links
- **⚠️ Tracking Detected**: Yellow warnings when tracking parameters are found
- **🔗 Redirects**: See the full redirect chain and final destination
- **🚨 Dangerous Sites**: Bright red alerts for known malware and phishing sites

## 🔒 Privacy First

- **Your data stays yours**: All link processing happens locally in your browser
- **No tracking**: We don't collect or store any information about your browsing
- **Optional features**: Safe Browsing API is opt-in and only used when you provide an API key
- **CORS-aware**: When websites block our preview, we show what we can and explain why

## ⚙️ Safe Browsing Setup

To enable dangerous site detection:

1. **Get a free API key** from [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project
   - Enable "Safe Browsing API"
   - Create credentials → API Key
   - Free tier: 10,000 checks per day

2. **Add your key**
   - Open browser console on any page
   - Run: `chrome.storage.sync.set({ safeBrowsingApiKey: 'YOUR_KEY_HERE' });`
   - Or edit `background.js` line 4 to hardcode your key

3. **You're protected!**
   - Dangerous sites will show red warnings automatically
   - No setup required after adding your key

## 🎯 Use Cases

- **Research & Journalism**: Verify sources without visiting suspicious sites
- **Social Media**: Check where shortened URLs lead before clicking
- **Email Safety**: Preview links in emails to avoid phishing
- **Privacy Conscious**: Strip tracking parameters from links
- **Productivity**: See destination faster than waiting for page loads

## 🛠️ Technical Details

- Built with **Manifest V3** (latest Chrome extension standard)
- **IndexedDB caching** with 7-day expiration
- **Smart batching**: Preloads ≤25 links, lazy loads for larger pages
- **Redirect resolution** with timeout and hop limits
- **Tracking parameter detection** for 15+ common trackers
- **Google Safe Browsing API v4** integration (optional)

## 📦 What's Included

- **Content Script**: Detects links and shows tooltips
- **Background Worker**: Resolves redirects and fetches metadata
- **Popup UI**: Quick stats and site-specific toggle
- **Test Pages**: Try it out on included demo pages

## 🌟 Why unboxx?

Most link expanders require you to copy-paste URLs or open new tabs. **unboxx shows you instantly** — just hover, no extra steps. Plus, it works on *every* link on *every* page, automatically.

## 🤝 Contributing

Found a bug? Have an idea? We'd love to hear from you!

- [Report issues](https://github.com/yourusername/unboxx/issues)
- [Request features](https://github.com/yourusername/unboxx/issues/new)
- Fork and submit pull requests

## 📄 License

MIT License - see LICENSE.md for details

## 🔗 Links

- [Chrome Web Store](#) (coming soon)
- [Report a Bug](https://github.com/yourusername/unboxx/issues)
- [Request a Feature](https://github.com/yourusername/unboxx/issues/new)

---

**Made with ❤️ for safer, smarter browsing**
