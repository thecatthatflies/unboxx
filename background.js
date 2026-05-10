// unboxx background service worker
// Handles redirect following, metadata extraction, caching

const CACHE_DB_NAME = 'url_expander_cache';
const CACHE_STORE_NAME = 'url_cache';
const CACHE_EXPIRY_DAYS = 7;
const MAX_REDIRECT_HOPS = 5;
const REQUEST_TIMEOUT = 5000;

// Tracking parameters to detect and strip
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'msclkid', 'twclid', 'yclid', 'gfe_rd',
  'ga_id', 'gclsrc', 'aff_id', 'affiliate_id', 'ref', 'referrer', 'source'
];

// IndexedDB setup
let db = null;

async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        const store = db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'originalUrl' });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };
  });
}

// Cache functions
async function getCached(originalUrl) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
      const store = tx.objectStore(CACHE_STORE_NAME);
      const request = store.get(originalUrl);

      request.onsuccess = () => {
        const data = request.result;
        if (!data) {
          resolve(null);
          return;
        }

        // Check expiry
        if (Date.now() > data.expiresAt) {
          // Delete expired entry
          const delTx = db.transaction(CACHE_STORE_NAME, 'readwrite');
          delTx.objectStore(CACHE_STORE_NAME).delete(originalUrl);
          resolve(null);
        } else {
          resolve(data);
        }
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Cache get error:', err);
    return null;
  }
}

async function saveToCache(originalUrl, data) {
  try {
    const db = await initDB();
    const timestamp = Date.now();
    const expiresAt = timestamp + (CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const cacheEntry = {
      originalUrl,
      ...data,
      timestamp,
      expiresAt
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(CACHE_STORE_NAME);
      const request = store.put(cacheEntry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Cache save error:', err);
  }
}

function isExpired(cached) {
  return Date.now() > cached.expiresAt;
}

async function cleanExpiredCache() {
  try {
    const db = await initDB();
    const now = Date.now();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(CACHE_STORE_NAME);
      const index = store.index('expiresAt');
      const request = index.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          if (cursor.value.expiresAt < now) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Cache cleanup error:', err);
  }
}

// Detect tracking parameters in URL
function detectTrackingParams(url) {
  try {
    const urlObj = new URL(url);
    const foundParams = [];

    for (const param of TRACKING_PARAMS) {
      if (urlObj.searchParams.has(param)) {
        foundParams.push(param);
      }
    }

    return foundParams;
  } catch (err) {
    return [];
  }
}

// Strip tracking parameters from URL
function stripTrackingParams(url) {
  try {
    const urlObj = new URL(url);

    for (const param of TRACKING_PARAMS) {
      urlObj.searchParams.delete(param);
    }

    return urlObj.toString();
  } catch (err) {
    return url;
  }
}

// Follow redirect chain with timeout and max hops
async function resolveRedirects(url, maxHops = MAX_REDIRECT_HOPS) {
  const redirectChain = [url];
  let currentUrl = url;
  let hopCount = 0;
  let corsBlocked = false;

  try {
    while (hopCount < maxHops) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      try {
        // Try with redirect: 'follow' first - easier to track final URL
        const response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          mode: 'cors'
        });

        clearTimeout(timeoutId);

        // Check if URL changed (redirected)
        if (response.url && response.url !== currentUrl) {
          currentUrl = response.url;
          redirectChain.push(currentUrl);
          hopCount++;
        }

        // Successfully fetched, stop here
        break;
      } catch (err) {
        clearTimeout(timeoutId);

        // CORS or network error - can't follow redirects
        // This is expected for many sites
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
          corsBlocked = true;
          console.log(`[unboxx] CORS blocked: ${currentUrl}`);
        }

        break;
      }
    }

    return {
      finalUrl: currentUrl,
      redirectChain,
      redirectCount: redirectChain.length - 1,
      maxHopsReached: hopCount >= maxHops,
      corsBlocked,
      error: null
    };
  } catch (err) {
    console.error('Resolve redirects error:', err);
    return {
      finalUrl: url,
      redirectChain,
      redirectCount: 0,
      maxHopsReached: false,
      corsBlocked: false,
      error: err.message
    };
  }
}

// Fallback metadata when CORS blocks
function getFallbackMetadata(url) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Use simpler favicon fallback (just domain)
    // Don't use Google API (too unreliable)
    // Instead, browsers will try /favicon.ico automatically

    return {
      title: domain,
      description: `Destination: ${domain}`,
      favicon: "", // Leave empty, browser handles it
      corsBlocked: true,
    };
  } catch (err) {
    return {
      title: "Website",
      description: "Unable to fetch page info",
      favicon: "",
      corsBlocked: true,
    };
  }
}

// Parse metadata from HTML
function parseMetadata(html, url) {
  try {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    const description = descMatch ? descMatch[1].trim() : "";

    // Extract favicon properly
    const faviconMatch = html.match(/<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i);
    let favicon = faviconMatch ? faviconMatch[1] : "";

    // Resolve relative favicon URLs
    if (favicon && !favicon.startsWith("http")) {
      try {
        favicon = new URL(favicon, url).toString();
      } catch (err) {
        favicon = "";
      }
    }

    return {
      title: title || url,
      description: description || "",
      favicon: favicon,
      corsBlocked: false,
    };
  } catch (err) {
    return getFallbackMetadata(url);
  }
}

// Fetch page metadata with multiple fallback strategies
async function fetchMetadata(url) {
  // Strategy 1: Try direct fetch
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const html = await response.text();
      return parseMetadata(html, url);
    }
  } catch (directErr) {
    console.log(`[unboxx] Direct fetch failed: ${directErr.message}`);
  }

  // Strategy 2: Try HEAD request for basic info
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const headResponse = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      mode: 'no-cors'
    });

    clearTimeout(timeoutId);

    // Got a response (even if opaque), URL is reachable
    console.log(`[unboxx] HEAD request succeeded, using enhanced fallback`);
    return getEnhancedFallback(url);
  } catch (headErr) {
    console.log(`[unboxx] HEAD request failed: ${headErr.message}`);
  }

  // Strategy 3: Enhanced fallback with URL analysis
  return getEnhancedFallback(url);
}

// Enhanced fallback with URL analysis
function getEnhancedFallback(url) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const path = urlObj.pathname;

    // Extract potential title from URL
    let title = domain;
    if (path && path !== '/' && path.length > 1) {
      // Clean up path to make a readable title
      const pathParts = path.split('/').filter(p => p.length > 0);
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart) {
        // Remove file extensions and clean up
        title = lastPart
          .replace(/\.[^.]+$/, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase());
      }
    }

    // Analyze domain for description
    let description = `Website: ${domain}`;
    if (domain.includes('github.com')) {
      description = 'GitHub repository or profile';
    } else if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
      description = 'YouTube video or channel';
    } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
      description = 'Twitter/X post or profile';
    } else if (domain.includes('linkedin.com')) {
      description = 'LinkedIn profile or post';
    }

    return {
      title: title,
      description: description,
      favicon: "", // Browser will handle favicon.ico
      corsBlocked: true,
    };
  } catch (err) {
    return getFallbackMetadata(url);
  }
}

// Google Safe Browsing API v4
// Requires API key - see README for setup instructions
const SAFE_BROWSING_API_KEY = 'YOUR_API_KEY_HERE';
const SAFE_BROWSING_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

async function checkSafeBrowsing(url) {
  try {
    // Get API key from storage (fallback to hardcoded)
    const result = await chrome.storage.sync.get(['safeBrowsingApiKey']);
    const apiKey = result.safeBrowsingApiKey || SAFE_BROWSING_API_KEY;

    // Skip if no API key configured
    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
      console.log('[unboxx] Safe Browsing API key not configured - skipping safety check');
      return 'unknown';
    }

    const requestBody = {
      client: {
        clientId: 'unboxx-extension',
        clientVersion: '1.0.0'
      },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url: url }]
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${SAFE_BROWSING_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('[unboxx] Safe Browsing API error:', response.status);
      return 'unknown';
    }

    const data = await response.json();

    if (data.matches && data.matches.length > 0) {
      const threatTypes = data.matches.map(m => m.threatType);
      console.warn('[unboxx] UNSAFE SITE DETECTED:', url, threatTypes);
      return {
        status: 'unsafe',
        threats: threatTypes
      };
    }

    console.log('[unboxx] Site is safe:', url);
    return 'safe';
  } catch (err) {
    console.error('[unboxx] Safe Browsing check failed:', err);
    return 'unknown';
  }
}

// Main resolver function
async function resolveUrlAndCache(url) {
  try {
    // Check cache first
    const cached = await getCached(url);
    if (cached && !isExpired(cached)) {
      return { ...cached, cached: true };
    }

    // Resolve redirects
    const { finalUrl, redirectChain, redirectCount, corsBlocked: redirectCorsBlocked } = await resolveRedirects(url);

    // Fetch metadata (only if not CORS blocked during redirect)
    const metadata = await fetchMetadata(finalUrl);

    // Detect tracking params
    const trackingParams = detectTrackingParams(finalUrl);
    const hasTracking = trackingParams.length > 0;
    const cleanUrl = stripTrackingParams(finalUrl);

    // Extract domain for fallback title
    let displayTitle = metadata.title;
    if (!displayTitle) {
      try {
        const urlObj = new URL(finalUrl);
        displayTitle = urlObj.hostname;
      } catch {
        displayTitle = "Unknown";
      }
    }

    // Check safety with Google Safe Browsing
    const safetyCheck = await checkSafeBrowsing(finalUrl);
    let safetyStatus = 'unknown';
    let threatTypes = [];
    if (typeof safetyCheck === 'object' && safetyCheck.status === 'unsafe') {
      safetyStatus = 'unsafe';
      threatTypes = safetyCheck.threats || [];
    } else if (safetyCheck === 'safe') {
      safetyStatus = 'safe';
    }

    // Build response
    const result = {
      originalUrl: url,
      finalUrl: finalUrl,
      cleanUrl: cleanUrl,
      title: displayTitle || "",
      description: metadata.description || "",
      faviconUrl: metadata.favicon || "",
      hasTracking: hasTracking,
      trackingParams: trackingParams,
      safetyStatus,
      threatTypes,
      redirectChain: redirectChain,
      redirectCount: redirectCount,
      cached: false,
      corsBlocked: metadata.corsBlocked || redirectCorsBlocked,
      error: null,
    };

    // Cache result
    await saveToCache(url, result);
    return result;
  } catch (err) {
    console.error("Error resolving URL:", err);

    // Return basic URL analysis even on complete failure
    const trackingParams = detectTrackingParams(url);
    const hasTracking = trackingParams.length > 0;
    const cleanUrl = stripTrackingParams(url);

    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = "Invalid URL";
    }

    return {
      originalUrl: url,
      finalUrl: url,
      cleanUrl: cleanUrl,
      title: hostname,
      description: "",
      faviconUrl: "",
      hasTracking: hasTracking,
      trackingParams: trackingParams,
      safetyStatus: "unknown",
      threatTypes: [],
      redirectChain: [url],
      redirectCount: 0,
      cached: false,
      corsBlocked: true,
      error: "fetch_failed",
    };
  }
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "resolveUrl") {
    (async () => {
      const result = await resolveUrlAndCache(request.url);
      sendResponse(result);
    })();
    return true; // Keep channel open for async response
  }
});

// Export functions for testing
globalThis.resolveRedirects = resolveRedirects;
globalThis.fetchMetadata = fetchMetadata;
globalThis.stripTrackingParams = stripTrackingParams;
globalThis.detectTrackingParams = detectTrackingParams;
globalThis.getCached = getCached;
globalThis.saveToCache = saveToCache;

// Clean expired cache on startup
initDB().then(() => {
  cleanExpiredCache();
  console.log('[unboxx] Background worker initialized');
});
