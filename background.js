// unboxx background service worker
// Resolves links (one request per link, cookies never sent), parses page metadata,
// tracks the real redirect chain, fetches preview images, and keeps cache, history and stats.

import "./lib/rules.js";
import "./lib/settings.js";

const Rules = globalThis.UnboxxRules;
const Settings = globalThis.UnboxxSettings;

const SCHEMA = 2;
const CACHE_DB_NAME = "unboxx_cache";
const CACHE_STORE_NAME = "previews";
const LEGACY_DB_NAME = "url_expander_cache";
const CACHE_TTL = 3 * 24 * 60 * 60 * 1000;
const ERROR_TTL = 10 * 60 * 1000;
const SAFETY_TTL = 30 * 60 * 1000;
const REQUEST_TIMEOUT = 6500;
const HTML_LIMIT = 768 * 1024;
const IMAGE_LIMIT = 6 * 1024 * 1024;
const HISTORY_LIMIT = 50;
const MAX_META_REFRESH = 2;
const SAFE_BROWSING_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find";
const EXT_ORIGIN = new URL(chrome.runtime.getURL("")).origin;
const VERSION = chrome.runtime.getManifest().version;

// ---------------------------------------------------------------------------
// Cache (IndexedDB, plus a small in-memory layer for the life of the worker)
// ---------------------------------------------------------------------------

let dbPromise = null;
const memCache = new Map();
const inflight = new Map();

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        const store = db.createObjectStore(CACHE_STORE_NAME, { keyPath: "key" });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      }
    };
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function cacheGet(key) {
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > Date.now()) return mem;
  try {
    const db = await openDB();
    const entry = await new Promise((resolve, reject) => {
      const request = db.transaction(CACHE_STORE_NAME, "readonly").objectStore(CACHE_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    if (!entry || entry.expiresAt < Date.now() || entry.model?.v !== SCHEMA) return null;
    rememberInMemory(key, entry);
    return entry;
  } catch {
    return null;
  }
}

function rememberInMemory(key, entry) {
  memCache.delete(key);
  memCache.set(key, entry);
  if (memCache.size > 300) memCache.delete(memCache.keys().next().value);
}

async function cachePut(key, model) {
  const ttl = model.error || model.status >= 400 ? ERROR_TTL : CACHE_TTL;
  const entry = { key, model, expiresAt: Date.now() + ttl };
  rememberInMemory(key, entry);
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const request = db.transaction(CACHE_STORE_NAME, "readwrite").objectStore(CACHE_STORE_NAME).put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // The in-memory copy is enough to keep things fast if IndexedDB is unavailable.
  }
}

async function cacheClear() {
  memCache.clear();
  imageCache.clear();
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const request = db.transaction(CACHE_STORE_NAME, "readwrite").objectStore(CACHE_STORE_NAME).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Nothing else to clear.
  }
}

async function cachePrune() {
  try {
    const db = await openDB();
    const now = Date.now();
    await new Promise((resolve, reject) => {
      const request = db.transaction(CACHE_STORE_NAME, "readwrite").objectStore(CACHE_STORE_NAME).index("expiresAt").openCursor(IDBKeyRange.upperBound(now));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Pruning is best effort.
  }
}

// ---------------------------------------------------------------------------
// Redirect chain tracking via webRequest (observe only, never blocks)
// ---------------------------------------------------------------------------

const chains = new Map();
const CHAIN_FILTER = { urls: ["<all_urls>"], types: ["xmlhttprequest", "other"] };

function isOwnRequest(details) {
  return details.tabId === -1 && details.initiator === EXT_ORIGIN;
}

if (chrome.webRequest) {
  chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (!isOwnRequest(details) || chains.has(details.requestId)) return;
    chains.set(details.requestId, { urls: [details.url], at: Date.now() });
    if (chains.size > 200) chains.delete(chains.keys().next().value);
  }, CHAIN_FILTER);

  chrome.webRequest.onBeforeRedirect.addListener((details) => {
    const chain = chains.get(details.requestId);
    if (chain) chain.urls.push(details.redirectUrl);
  }, CHAIN_FILTER);
}

function takeChain(start, finalUrl) {
  let found = null;
  const now = Date.now();
  for (const [id, chain] of chains) {
    if (now - chain.at > 60000) {
      chains.delete(id);
      continue;
    }
    if (!found && chain.urls[0] === start && chain.urls[chain.urls.length - 1] === finalUrl) {
      found = chain.urls.slice();
      chains.delete(id);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function sniffCharset(bytes, contentType) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || "");
  if (fromHeader) return fromHeader[1];
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return fromMeta ? fromMeta[1] : "utf-8";
}

async function readHtml(response, contentType) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let tail = "";
  let headDone = false;
  let sawOpenGraph = false;
  const ascii = new TextDecoder("latin1");
  try {
    // Stop at </head> once Open Graph tags have shown up. Some sites (YouTube) put them
    // in <body>, so keep reading a little further when they haven't.
    while (total < HTML_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      const text = tail + ascii.decode(value);
      if (!sawOpenGraph && /property=["']?og:/i.test(text)) sawOpenGraph = true;
      if (!headDone && /<\/head\s*>/i.test(text)) headDone = true;
      if (headDone && (sawOpenGraph || total > 96 * 1024)) break;
      tail = text.slice(-32);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder(sniffCharset(bytes, contentType)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
    });
    const finalUrl = response.url || url;
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const contentLength = Number(response.headers.get("content-length")) || 0;
    let html = "";
    if (!contentType || /text\/html|application\/xhtml/.test(contentType)) {
      html = await readHtml(response, contentType);
    } else if (response.body) {
      response.body.cancel().catch(() => {});
    }
    const chain = takeChain(url, finalUrl) || (finalUrl !== url ? [url, finalUrl] : [url]);
    return { ok: true, finalUrl, status: response.status, contentType, contentLength, html, chain };
  } catch (err) {
    return { ok: false, error: err.name === "AbortError" ? "timeout" : "unreachable", chain: [url] };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// HTML metadata
// ---------------------------------------------------------------------------

function decodeEntities(text) {
  return String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39|mdash|ndash|hellip|rsquo|lsquo|rdquo|ldquo|middot);/g, (_, name) => ({
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", mdash: "-", ndash: "-",
      hellip: "...", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', middot: "·",
    })[name]);
}

function safeFromCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function tidy(text, max = 300) {
  const value = decodeEntities(text).replace(/\s+/g, " ").trim();
  return value.length > max ? value.slice(0, max - 1).trimEnd() + "..." : value;
}

function parseAttributes(source) {
  const attrs = {};
  const re = /([^\s=/>"']+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(source))) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

function absolutize(href, base) {
  if (!href) return "";
  try {
    const u = new URL(decodeEntities(href.trim()), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

function parseHtml(html, baseUrl) {
  // Meta tags normally sit in <head>, but some sites render them in <body>.
  const head = html.slice(0, HTML_LIMIT);
  const meta = {};
  const icons = [];
  let canonical = "";
  let imageSrc = "";
  let base = baseUrl;

  const baseTag = /<base\b([^>]*)>/i.exec(head);
  if (baseTag) {
    const href = absolutize(parseAttributes(baseTag[1]).href, baseUrl);
    if (href) base = href;
  }

  const tagRe = /<(meta|link)\b([^>]*)>/gi;
  let m;
  while ((m = tagRe.exec(head))) {
    const attrs = parseAttributes(m[2]);
    if (m[1].toLowerCase() === "meta") {
      const key = (attrs.property || attrs.name || attrs.itemprop || attrs["http-equiv"] || "").toLowerCase();
      if (key && attrs.content !== undefined && meta[key] === undefined) meta[key] = attrs.content;
    } else {
      const rel = (attrs.rel || "").toLowerCase().split(/\s+/);
      if (rel.includes("icon") || rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) {
        const href = absolutize(attrs.href, base);
        const type = (attrs.type || "").toLowerCase();
        if (href && !type.includes("svg") && !/\.svg(\?|$)/i.test(href)) {
          const size = parseInt((attrs.sizes || "").split("x")[0], 10);
          icons.push({ href, size: rel.includes("icon") ? size || 16 : size || 180 });
        }
      }
      if (rel.includes("canonical") && !canonical) canonical = absolutize(attrs.href, base);
      if (rel.includes("image_src") && !imageSrc) imageSrc = absolutize(attrs.href, base);
    }
  }

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = tidy(meta["og:title"] || meta["twitter:title"] || (titleMatch ? titleMatch[1] : ""), 200);
  const description = tidy(meta["og:description"] || meta.description || meta["twitter:description"] || "", 280);
  const siteName = tidy(meta["og:site_name"] || meta["application-name"] || "", 80);
  const image = absolutize(
    meta["og:image:secure_url"] || meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || meta["twitter:image:src"] || meta.image || imageSrc,
    base
  );

  icons.sort((a, b) => Math.abs(64 - a.size) - Math.abs(64 - b.size));
  let favicon = icons.length ? icons[0].href : "";
  if (!favicon) {
    try {
      favicon = new URL("/favicon.ico", baseUrl).href;
    } catch {
      favicon = "";
    }
  }

  let refresh = "";
  const refreshValue = meta.refresh;
  if (refreshValue) {
    const r = /^\s*(\d+)?\s*[;,]?\s*url\s*=\s*['"]?([^'"]+)/i.exec(refreshValue);
    if (r && Number(r[1] || 0) <= 10) refresh = absolutize(r[2], base);
  }

  return { title, description, siteName, image, favicon, canonical, refresh };
}

// ---------------------------------------------------------------------------
// Google Safe Browsing (optional, needs the user's own API key)
// ---------------------------------------------------------------------------

async function checkSafety(urls) {
  const { safeBrowsingApiKey } = await chrome.storage.sync.get(["safeBrowsingApiKey"]);
  if (!safeBrowsingApiKey) return { status: "off", threats: [], checkedAt: Date.now() };

  const entries = [...new Set(urls.filter((u) => /^https?:/i.test(u)))].slice(0, 10).map((url) => ({ url }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(safeBrowsingApiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      signal: controller.signal,
      body: JSON.stringify({
        client: { clientId: "unboxx-extension", clientVersion: VERSION },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: entries,
        },
      }),
    });
    if (!response.ok) return { status: "unknown", threats: [], error: response.status, checkedAt: Date.now() };
    const data = await response.json();
    if (data.matches && data.matches.length) {
      return { status: "unsafe", threats: [...new Set(data.matches.map((m) => m.threatType))], checkedAt: Date.now() };
    }
    return { status: "safe", threats: [], checkedAt: Date.now() };
  } catch {
    return { status: "unknown", threats: [], checkedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

async function testSafeBrowsingKey(key) {
  try {
    const response = await fetch(`${SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        client: { clientId: "unboxx-extension", clientVersion: VERSION },
        threatInfo: {
          threatTypes: ["MALWARE"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url: "https://example.com/" }],
        },
      }),
    });
    if (response.ok) return { ok: true };
    const body = await response.json().catch(() => ({}));
    return { ok: false, message: body.error?.message || `Google returned ${response.status}` };
  } catch {
    return { ok: false, message: "Couldn't reach Google. Check your connection." };
  }
}

// ---------------------------------------------------------------------------
// Resolving a link into a preview model
// ---------------------------------------------------------------------------

const AUTH_WALL = /\/(login|log-in|signin|sign-in|sign_in|auth|sso|oauth2?|session\/new|accounts?\/login|users\/sign_in)(\/|\?|$)/i;

function comparable(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
  } catch {
    return url;
  }
}

function mergeRemoved(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const item of list || []) {
      const id = `${item.name}=${item.value}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }
  }
  return out;
}

function mergeFlags(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) out[k] = Boolean(out[k] || v);
  return out;
}

function baseModel(local) {
  const parts = Rules.displayParts(local.clean);
  return {
    v: SCHEMA,
    kind: "web",
    href: local.href,
    target: local.target,
    finalUrl: local.target,
    cleanUrl: local.clean,
    displayHost: parts.host,
    displayPath: parts.rest,
    removed: local.removed,
    unwrapped: local.unwrapped,
    chain: [local.target],
    flags: local.flags,
    fileType: local.fileType,
    contentType: "",
    contentLength: 0,
    status: 0,
    title: "",
    siteName: "",
    description: "",
    imageUrl: "",
    faviconUrl: "",
    safety: { status: "unknown", threats: [] },
    notFetched: null,
    authWall: false,
    error: null,
    fetchedAt: Date.now(),
  };
}

function youtubeVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host !== "youtube.com") return null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

// YouTube pages bury their metadata ~800 KB deep, so use its small oEmbed endpoint instead.
async function youtubeModel(model, id, local) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    // 401/403 mean the video exists but can't be embedded; 400/404 mean it doesn't exist.
    model.status = response.status === 400 ? 404 : response.status === 401 || response.status === 403 ? 200 : response.status;
    if (response.ok) {
      const data = await response.json();
      model.title = tidy(data.title || "", 200);
      model.description = data.author_name ? `Video by ${tidy(data.author_name, 80)}` : "";
    }
  } catch {
    model.error = "unreachable";
  } finally {
    clearTimeout(timer);
  }
  model.siteName = "YouTube";
  model.contentType = "text/html";
  model.imageUrl = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  model.faviconUrl = "https://www.youtube.com/favicon.ico";
  model.safety = await checkSafety([local.href, local.target]);
  return model;
}

async function buildModel(href, opts) {
  const local = Rules.analyze(href, opts);
  if (!local.ok) return { v: SCHEMA, kind: "other", href, address: href, error: "invalid" };
  if (local.kind !== "web") return { v: SCHEMA, ...local };

  const model = baseModel(local);

  if (local.isAction) {
    model.notFetched = "action";
    try {
      model.faviconUrl = new URL("/favicon.ico", local.target).href;
    } catch {
      model.faviconUrl = "";
    }
    model.safety = await checkSafety([local.href, local.target]);
    return model;
  }

  const videoId = youtubeVideoId(local.target);
  if (videoId) return youtubeModel(model, videoId, local);

  let page = await fetchPage(local.target);
  let chain = page.chain;
  let meta = page.ok && page.html ? parseHtml(page.html, page.finalUrl) : null;

  for (let hop = 0; hop < MAX_META_REFRESH && meta && meta.refresh && meta.refresh !== page.finalUrl; hop++) {
    const next = await fetchPage(meta.refresh);
    if (!next.ok) break;
    chain = [...chain, ...next.chain.slice(chain[chain.length - 1] === next.chain[0] ? 1 : 0)];
    page = next;
    meta = next.html ? parseHtml(next.html, next.finalUrl) : null;
  }

  if (!page.ok) {
    model.error = page.error;
    model.safety = await checkSafety([local.href, local.target]);
    return model;
  }

  const finalUrl = page.finalUrl;
  const final = Rules.analyze(finalUrl, opts);
  const authWall = finalUrl !== local.target && AUTH_WALL.test(new URL(finalUrl).pathname) && !AUTH_WALL.test(new URL(local.target).pathname);
  const crossSite = !Rules.sameSite(local.target, finalUrl);
  const trivial = comparable(local.target) === comparable(finalUrl);
  const followDestination = !authWall && (crossSite || trivial || local.flags.shortener);
  const cleanUrl = followDestination && final.ok ? final.clean : local.clean;
  const parts = Rules.displayParts(cleanUrl);

  Object.assign(model, {
    finalUrl,
    cleanUrl,
    displayHost: parts.host,
    displayPath: parts.rest,
    removed: mergeRemoved(local.removed, followDestination && final.ok ? final.removed : []),
    chain,
    flags: mergeFlags(local.flags, final.ok ? final.flags : {}),
    fileType: (final.ok && final.fileType) || local.fileType,
    contentType: page.contentType,
    contentLength: page.contentLength,
    status: page.status,
    authWall,
  });

  if (meta) {
    model.title = meta.title;
    model.description = meta.description;
    model.siteName = meta.siteName;
    model.imageUrl = meta.image;
    model.faviconUrl = meta.favicon;
  } else {
    try {
      model.faviconUrl = new URL("/favicon.ico", finalUrl).href;
    } catch {
      model.faviconUrl = "";
    }
  }

  model.safety = await checkSafety([local.href, local.target, finalUrl]);
  return model;
}

function cacheKey(href, opts) {
  return `${href}|${opts.strict ? 1 : 0}${opts.unwrap === false ? 0 : 1}`;
}

async function resolve(href, opts = {}, force = false) {
  const key = cacheKey(href, opts);

  if (!force) {
    const cached = await cacheGet(key);
    if (cached) {
      const model = cached.model;
      const safetyAge = Date.now() - (model.safety?.checkedAt || 0);
      if (model.kind === "web" && model.safety?.status !== "off" && safetyAge > SAFETY_TTL) {
        model.safety = await checkSafety([model.href, model.target, model.finalUrl]);
        cachePut(key, model);
      }
      return { ...model, cached: true };
    }
  }

  if (inflight.has(key)) return inflight.get(key);

  const job = buildModel(href, opts)
    .then((model) => {
      if (model.kind === "web") cachePut(key, model);
      return model;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// ---------------------------------------------------------------------------
// Images (returned as base64 so the content script can paint them onto a canvas)
// ---------------------------------------------------------------------------

const imageCache = new Map();

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}

async function fetchImageBlob(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (type && !type.startsWith("image/") && !type.includes("octet-stream")) return null;
    if (type.includes("svg")) return null;
    const blob = await response.blob();
    if (!blob.size || blob.size > IMAGE_LIMIT) return null;
    return { blob, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getImage(url, kind) {
  if (!url) return null;
  const key = `${kind}|${url}`;
  if (imageCache.has(key)) {
    const hit = imageCache.get(key);
    imageCache.delete(key);
    imageCache.set(key, hit);
    return hit;
  }

  const fetched = await fetchImageBlob(url);
  let result = null;

  if (fetched) {
    const isScreenshot = kind === "screenshot";
    // mShots answers with a GIF placeholder while it renders the page.
    if (isScreenshot && fetched.type.includes("gif")) return { pending: true };
    try {
      const bitmap = await createImageBitmap(fetched.blob);
      const maxWidth = kind === "favicon" ? 64 : 760;
      if (bitmap.width < 2 || bitmap.height < 2) {
        bitmap.close();
      } else {
        const scale = Math.min(1, maxWidth / bitmap.width);
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const mime = kind === "favicon" ? "image/png" : "image/webp";
        const out = await canvas.convertToBlob({ type: mime, quality: 0.84 });
        result = { mime, b64: await blobToBase64(out), width: w, height: h };
      }
    } catch {
      result = null;
    }
  }

  if (!result && kind === "favicon") {
    try {
      const fallback = new URL("/favicon.ico", url).href;
      if (fallback !== url) result = await getImage(fallback, kind);
    } catch {
      // No usable favicon.
    }
  }

  imageCache.set(key, result);
  if (imageCache.size > 80) imageCache.delete(imageCache.keys().next().value);
  return result;
}

// ---------------------------------------------------------------------------
// History and stats (chrome.storage.local, never leaves the device)
// ---------------------------------------------------------------------------

let storageQueue = Promise.resolve();
function serial(task) {
  storageQueue = storageQueue.then(task, task);
  return storageQueue;
}

function bumpStat(name, by = 1) {
  if (!by) return Promise.resolve();
  return serial(async () => {
    const { stats = {} } = await chrome.storage.local.get(["stats"]);
    stats[name] = (stats[name] || 0) + by;
    await chrome.storage.local.set({ stats });
  });
}

function recordHistory(entry) {
  return serial(async () => {
    const { history = [] } = await chrome.storage.local.get(["history"]);
    const next = [{ ...entry, ts: Date.now() }, ...history.filter((h) => h.url !== entry.url)].slice(0, HISTORY_LIMIT);
    const { stats = {} } = await chrome.storage.local.get(["stats"]);
    stats.previewed = (stats.previewed || 0) + 1;
    await chrome.storage.local.set({ history: next, stats });
  });
}

// ---------------------------------------------------------------------------
// Toolbar badge
// ---------------------------------------------------------------------------

function setBadge(tabId, count) {
  if (tabId === undefined) return;
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#4a5f3c" }).catch(() => {});
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ tabId, color: "#f4f5f1" }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: count > 0 ? (count > 99 ? "99+" : String(count)) : "" }).catch(() => {});
  chrome.action
    .setTitle({ tabId, title: count > 0 ? `unboxx: ${count} link${count === 1 ? "" : "s"} with trackers on this page` : "unboxx" })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------

async function cleaningOptions() {
  const settings = await Settings.load();
  return { strict: settings.strictCleaning, unwrap: settings.unwrapRedirects };
}

function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

// Copies through a hidden offscreen page. Used when the tab has no unboxx content script:
// tabs opened before install, chrome:// pages, the Web Store and PDFs.
async function copyViaOffscreen(text) {
  if (!chrome.offscreen) return false;
  try {
    const exists = chrome.offscreen.hasDocument ? await chrome.offscreen.hasDocument() : false;
    if (!exists) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["CLIPBOARD"],
        justification: "Copy clean links to the clipboard from the context menu and keyboard shortcut.",
      });
    }
  } catch (err) {
    if (!String(err && err.message).includes("single offscreen")) return false;
  }
  const res = await chrome.runtime.sendMessage({ target: "offscreen", action: "copy", text }).catch(() => null);
  return Boolean(res && res.ok);
}

function flashBadge(tabId, text, color) {
  if (tabId === undefined) return;
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {}), 1600);
}

// Copies with an in-page toast when possible, otherwise offscreen with a badge confirmation.
async function copyForTab(tabId, text, toastText) {
  const res = await sendToTab(tabId, { action: "copyText", text, toast: toastText });
  if (res && res.ok) return true;
  const ok = await copyViaOffscreen(text);
  flashBadge(tabId, ok ? "OK" : "!", ok ? "#4a5f3c" : "#a8231b");
  return ok;
}

async function resolveQuickly(url, opts, timeout = 3500) {
  const local = Rules.analyze(url, opts);
  const fallback = local.ok && local.kind === "web" ? { cleanUrl: local.clean, title: "", removed: local.removed } : { cleanUrl: url, title: "", removed: [] };
  return Promise.race([resolve(url, opts).catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), timeout))]);
}

// ---------------------------------------------------------------------------
// Context menus and keyboard commands
// ---------------------------------------------------------------------------

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "ubx-copy-clean", title: "Copy clean link", contexts: ["link"] });
    chrome.contextMenus.create({ id: "ubx-open-clean", title: "Open clean link in new tab", contexts: ["link"] });
    chrome.contextMenus.create({ id: "ubx-copy-md", title: "Copy link as Markdown", contexts: ["link"] });
    chrome.contextMenus.create({ id: "ubx-sep", type: "separator", contexts: ["link"] });
    chrome.contextMenus.create({ id: "ubx-copy-page", title: "Copy clean page address", contexts: ["page", "frame"] });
    chrome.contextMenus.create({ id: "ubx-toggle-site", title: "Pause unboxx on this site", contexts: ["page"] });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id === undefined) return;
  const opts = await cleaningOptions();

  switch (info.menuItemId) {
    case "ubx-copy-clean": {
      const model = await resolveQuickly(info.linkUrl, opts);
      const removed = (model.removed || []).length;
      const copied = await copyForTab(tab.id, model.cleanUrl || info.linkUrl, removed ? `Clean link copied, ${removed} tracker${removed === 1 ? "" : "s"} removed` : "Clean link copied");
      if (copied) bumpStat("trackersRemoved", removed);
      break;
    }
    case "ubx-open-clean": {
      const model = await resolveQuickly(info.linkUrl, opts);
      chrome.tabs.create({ url: model.cleanUrl || info.linkUrl, index: tab.index + 1, openerTabId: tab.id });
      bumpStat("trackersRemoved", (model.removed || []).length);
      break;
    }
    case "ubx-copy-md": {
      const model = await resolveQuickly(info.linkUrl, opts);
      const cleanUrl = model.cleanUrl || info.linkUrl;
      const res = await sendToTab(tab.id, { action: "copyMarkdown", url: info.linkUrl, cleanUrl, title: model.title || "" });
      if (!(res && res.ok)) {
        const title = (model.title || Rules.displayParts(cleanUrl).host).replace(/([\[\]\\])/g, "\\$1");
        const safeUrl = cleanUrl.replace(/[()\s]/g, (c) => ({ "(": "%28", ")": "%29" })[c] || encodeURIComponent(c));
        const ok = await copyViaOffscreen(`[${title}](${safeUrl})`);
        flashBadge(tab.id, ok ? "OK" : "!", ok ? "#4a5f3c" : "#a8231b");
      }
      break;
    }
    case "ubx-copy-page": {
      const url = info.frameUrl || info.pageUrl || tab.url;
      const local = Rules.analyze(url, opts);
      const clean = local.ok && local.kind === "web" ? local.clean : url;
      const removed = local.removed ? local.removed.length : 0;
      const copied = await copyForTab(tab.id, clean, removed ? `Clean address copied, ${removed} tracker${removed === 1 ? "" : "s"} removed` : "Address copied");
      if (copied) bumpStat("trackersRemoved", removed);
      break;
    }
    case "ubx-toggle-site":
      toggleSite(tab);
      break;
  }
});

async function toggleSite(tab) {
  let host = "";
  try {
    host = new URL(tab.url).hostname;
  } catch {
    return;
  }
  const settings = await Settings.load();
  const disabled = Settings.isSiteDisabled(settings, host);
  await Settings.setSiteDisabled(host, !disabled);
  sendToTab(tab.id, { action: "toast", text: disabled ? `unboxx is back on for ${Settings.normalizeHost(host)}` : `unboxx paused on ${Settings.normalizeHost(host)}` });
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  const active = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!active || active.id === undefined) return;
  if (command === "copy-clean-url") {
    const opts = await cleaningOptions();
    const local = Rules.analyze(active.url || "", opts);
    if (!local.ok || local.kind !== "web") return;
    const removed = local.removed.length;
    const copied = await copyForTab(active.id, local.clean, removed ? `Clean address copied, ${removed} tracker${removed === 1 ? "" : "s"} removed` : "Address copied");
    if (copied) bumpStat("trackersRemoved", removed);
  } else if (command === "toggle-site") {
    toggleSite(active);
  }
});

// ---------------------------------------------------------------------------
// Runtime messages
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const respond = (promise) => {
    promise.then(sendResponse, (err) => sendResponse({ error: String(err && err.message ? err.message : err) }));
    return true;
  };

  switch (request && request.action) {
    case "resolve":
      return respond(resolve(request.url, request.opts || {}, Boolean(request.force)));
    case "getImage":
      return respond(getImage(request.url, request.kind || "preview"));
    case "openTab": {
      const tab = sender.tab;
      const props = { url: request.url, active: Boolean(request.active) };
      if (tab) {
        props.index = tab.index + 1;
        props.openerTabId = tab.id;
      }
      return respond(chrome.tabs.create(props).then(() => ({ ok: true })));
    }
    case "recordHistory":
      return respond(recordHistory(request.entry).then(() => ({ ok: true })));
    case "bumpStat":
      return respond(bumpStat(request.name, request.by).then(() => ({ ok: true })));
    case "pageSummary":
      if (sender.tab) setBadge(sender.tab.id, request.showBadge === false ? 0 : request.trackers);
      return false;
    case "clearCache":
      return respond(cacheClear().then(() => ({ ok: true })));
    case "testSafeBrowsingKey":
      return respond(testSafeBrowsingKey(request.key));
    default:
      return false;
  }
});

// ---------------------------------------------------------------------------
// Live preview frames
// ---------------------------------------------------------------------------

// Most sites refuse to be framed. This session rule strips the framing headers only for frames
// that unboxx's own preview page opens (initiator is this extension), never for normal browsing.
const LIVE_FRAME_RULE_ID = 1;

async function installLiveFrameRule() {
  if (!chrome.declarativeNetRequest) return;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [LIVE_FRAME_RULE_ID],
      addRules: [
        {
          id: LIVE_FRAME_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            responseHeaders: [
              { header: "x-frame-options", operation: "remove" },
              { header: "content-security-policy", operation: "remove" },
            ],
          },
          condition: {
            resourceTypes: ["sub_frame"],
            initiatorDomains: [chrome.runtime.id],
          },
        },
      ],
    });
  } catch {
    // Without the rule, sites that forbid framing fall back to their share image.
  }
}

installLiveFrameRule();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// Version 2 makes the live page the default preview. Older installs saved "page" as the default.
async function migrateSettingsVersion() {
  const { settingsVersion = 1 } = await chrome.storage.local.get(["settingsVersion"]);
  if (settingsVersion >= 2) return;
  const settings = await Settings.load();
  if (settings.previewImages === "page") await Settings.save({ previewImages: "live" });
  await chrome.storage.local.set({ settingsVersion: 2 });
}

async function migrateLegacySettings() {
  const all = await chrome.storage.sync.get(null);
  const legacy = Object.keys(all).filter((k) => k.startsWith("disabled_") && all[k]);
  if (!legacy.length) return;
  const settings = await Settings.load();
  const hosts = new Set(settings.disabledSites);
  for (const key of legacy) hosts.add(Settings.normalizeHost(key.slice("disabled_".length)));
  await Settings.save({ disabledSites: [...hosts].filter(Boolean).sort() });
  await chrome.storage.sync.remove(legacy);
}

chrome.runtime.onInstalled.addListener(async (details) => {
  createMenus();
  try {
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch {
    // Old cache already gone.
  }
  await migrateLegacySettings().catch(() => {});
  await migrateSettingsVersion().catch(() => {});
  installLiveFrameRule();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html?welcome=1") });
  }
});

chrome.runtime.onStartup.addListener(() => {
  cachePrune();
});

cachePrune();
