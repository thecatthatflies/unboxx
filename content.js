// unboxx content script
// Detects links, shows tooltips, handles preload/lazy load

const LINK_THRESHOLD = 25;
const TOOLTIP_ID = "unboxx-tooltip-container";
const TOOLTIP_CLASS = "unboxx-tooltip";
const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "gclid", "msclkid", "twclid", "yclid", "gfe_rd",
  "ga_id", "gclsrc", "aff_id", "affiliate_id", "ref", "referrer", "source"
];

let cachedUrlData = {}; // { originalUrl: { ...data } }
let tooltipElement = null;
let currentHoveredLink = null;
let preloadingLinks = new Set();
let tooltipHoverTimeout = null;

// Run on page load
document.addEventListener("DOMContentLoaded", () => {
  initializeUnboxx();
});

// Also run immediately if DOM is already loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeUnboxx);
} else {
  initializeUnboxx();
}

async function initializeUnboxx() {
  console.log("[unboxx] ===== INIT START =====");
  console.log("[unboxx] Page URL:", window.location.href);
  console.log("[unboxx] Base URI:", document.baseURI);

  // Check if extension context is valid
  if (!chrome.runtime?.id) {
    console.error("[unboxx] Extension context invalidated - page reload required");
    console.error("[unboxx] Please reload this page after updating the extension");
    return;
  }

  // Check if disabled for this domain
  try {
    const domain = new URL(window.location.href).hostname;
    const result = await chrome.storage.sync.get([`disabled_${domain}`]);
    if (result[`disabled_${domain}`]) {
      console.log("[unboxx] Extension disabled for this domain:", domain);
      return;
    }
  } catch (err) {
    console.error("[unboxx] Failed to check disabled status:", err);
  }

  // Inject Phosphor Icons CDN (content scripts can't use @import for external CSS)
  // Add preconnect for faster font loading
  if (!document.getElementById('unboxx-phosphor-preconnect')) {
    const preconnect = document.createElement('link');
    preconnect.id = 'unboxx-phosphor-preconnect';
    preconnect.rel = 'preconnect';
    preconnect.href = 'https://unpkg.com';
    preconnect.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect);
  }

  if (!document.getElementById('unboxx-phosphor-icons')) {
    const link = document.createElement('link');
    link.id = 'unboxx-phosphor-icons';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/@phosphor-icons/web@2.0.3/src/duotone/style.css';
    document.head.appendChild(link);
    console.log("[unboxx] Phosphor Icons injected");

    // Wait for fonts to load
    link.onload = () => {
      console.log("[unboxx] Phosphor Icons loaded successfully");
    };
    link.onerror = () => {
      console.error("[unboxx] Failed to load Phosphor Icons - using text fallbacks");
    };
  }

  // Create tooltip container
  createTooltipContainer();
  console.log("[unboxx] Tooltip container created");

  // Get all links
  const links = getAllLinks();
  console.log(`[unboxx] Found ${links.length} links`);

  // Log first 5 links for debugging
  links.slice(0, 5).forEach((link, i) => {
    const href = link.getAttribute("href");
    console.log(`[unboxx] Link ${i}:`, href, "→", resolveRelativeUrl(href));
  });

  if (links.length === 0) {
    console.warn("[unboxx] No links found on page!");
    return;
  }

  if (links.length <= LINK_THRESHOLD) {
    console.log("[unboxx] Preloading all links (count ≤ 25)...");
    preloadAllLinks(links);
  } else {
    console.log("[unboxx] Lazy loading on hover (count > 25)...");
  }

  // Attach hover listeners to all links
  attachHoverListeners(links);
  console.log("[unboxx] Hover listeners attached");

  // Watch for dynamically added links
  observeNewLinks();
  console.log("[unboxx] ===== INIT COMPLETE =====");
}

function resolveRelativeUrl(href) {
  try {
    // Handle special protocols (return as-is with label)
    if (href.startsWith("mailto:")) {
      return { url: href, type: "email", display: href.replace("mailto:", "") };
    }
    if (href.startsWith("tel:")) {
      return { url: href, type: "phone", display: href.replace("tel:", "") };
    }
    if (href.startsWith("sms:")) {
      return { url: href, type: "sms", display: href.replace("sms:", "") };
    }

    // If already absolute, return as-is
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return { url: href, type: "web", display: href };
    }

    // Resolve relative to current page
    const resolvedUrl = new URL(href, document.baseURI);
    return { url: resolvedUrl.toString(), type: "web", display: resolvedUrl.toString() };
  } catch (err) {
    console.error("[unboxx] Failed to resolve URL:", href, err);
    return { url: href, type: "unknown", display: href };
  }
}

function getAllLinks() {
  const links = [];

  // Get all anchor tags (primary target)
  const anchors = document.querySelectorAll("a[href]");
  anchors.forEach((link) => {
    const href = link.getAttribute("href");

    // Skip ONLY these special cases (we handle them differently)
    if (!href || href.trim() === "") {
      return;
    }

    // Skip pure anchors (same-page navigation)
    if (href === "#" || href.startsWith("#")) {
      return;
    }

    // Skip non-web protocols that can't be expanded
    const protocol = href.split(":")[0].toLowerCase();
    const skipProtocols = ["javascript", "data", "blob"];
    if (skipProtocols.includes(protocol)) {
      return;
    }

    // Include mailto, tel, etc - we'll show them in tooltip
    // Include ALL http/https/relative URLs
    links.push(link);
  });

  console.log(`[unboxx] Found ${links.length} clickable elements`);
  return links;
}

function createTooltipContainer() {
  // Remove if exists
  const existing = document.getElementById(TOOLTIP_ID);
  if (existing) existing.remove();

  // Create container (rely on CSS for display, not inline style)
  const container = document.createElement("div");
  container.id = TOOLTIP_ID;
  container.innerHTML = `
    <div class="${TOOLTIP_CLASS}" id="unboxx-tooltip-content">
      <div class="unboxx-loading">
        <div class="spinner"></div>
        <p>Loading...</p>
      </div>
    </div>
  `;

  document.body.appendChild(container);
  tooltipElement = container;
}

function attachTooltipHoverListeners() {
  if (!tooltipElement) return;

  // Keep tooltip visible when hovering over it
  tooltipElement.addEventListener("mouseenter", () => {
    clearTimeout(tooltipHoverTimeout);
  });

  // Hide only after leaving both link and tooltip
  tooltipElement.addEventListener("mouseleave", () => {
    hideTooltip();
  });
}

function attachHoverListeners(links) {
  links.forEach((link) => {
    link.addEventListener("mouseenter", (e) => {
      e.stopPropagation();
      onLinkHover(e, link);
    });

    link.addEventListener("mouseleave", (e) => {
      e.stopPropagation();
      hideTooltip();
    });
  });
}

async function onLinkHover(event, link) {
  clearTimeout(tooltipHoverTimeout);

  currentHoveredLink = link;
  const resolved = resolveRelativeUrl(link.getAttribute("href"));

  console.log("[unboxx] Hovering link:", resolved);

  // Handle non-web links immediately (no background request needed)
  if (resolved.type === "email" || resolved.type === "phone" || resolved.type === "sms") {
    renderSpecialLinkTooltip(link, resolved);
    attachTooltipHoverListeners();
    return;
  }

  // Check if extension context is valid
  if (!chrome.runtime?.id) {
    console.error("[unboxx] Extension context invalidated - please reload page");
    return;
  }

  // Show loading state
  showLoadingTooltip(link);

  // Check if already cached
  if (cachedUrlData[resolved.url]) {
    console.log("[unboxx] Using cached data");
    renderTooltip(link, cachedUrlData[resolved.url]);
    attachTooltipHoverListeners();
    return;
  }

  // Request from background
  try {
    chrome.runtime.sendMessage(
      { action: "resolveUrl", url: resolved.url },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("[unboxx] Runtime error:", chrome.runtime.lastError);
          // Show error tooltip instead of hiding
          renderErrorTooltip(link, resolved.url, chrome.runtime.lastError.message);
          attachTooltipHoverListeners();
          return;
        }

        if (!response) {
          console.error("[unboxx] No response from background");
          renderErrorTooltip(link, resolved.url, "No response");
          attachTooltipHoverListeners();
          return;
        }

        console.log("[unboxx] Got response:", response);

        // Cache it
        cachedUrlData[resolved.url] = response;

        // Render if still hovering same link
        if (currentHoveredLink === link) {
          renderTooltip(link, response);
          attachTooltipHoverListeners();
        }
      }
    );
  } catch (err) {
    console.error("[unboxx] Error sending message:", err);
    renderErrorTooltip(link, resolved.url, err.message);
    attachTooltipHoverListeners();
  }
}

function showLoadingTooltip(link) {
  if (!tooltipElement) return;

  const content = document.getElementById("unboxx-tooltip-content");
  content.innerHTML = `
    <div class="unboxx-loading">
      <div class="spinner"></div>
      <p>Loading...</p>
    </div>
  `;

  tooltipElement.setAttribute("data-visible", "true");
  tooltipElement.style.opacity = "0";
  tooltipElement.style.transition = "opacity 200ms ease-in-out";

  positionTooltip(link);

  setTimeout(() => {
    tooltipElement.style.opacity = "1";
  }, 10);
}

function renderTooltip(link, data) {
  if (!tooltipElement) return;

  const content = document.getElementById("unboxx-tooltip-content");

  const isUnsafe = data.safetyStatus === 'unsafe';

  let warnings = "";

  // CRITICAL: Unsafe warning first (most important)
  if (isUnsafe) {
    const threatList = data.threatTypes && data.threatTypes.length > 0
      ? data.threatTypes.join(', ')
      : 'Security threat detected';
    warnings += `<div class="unsafe-warning"><i class="ph-duotone ph-warning-octagon"></i> ${threatList} — Do not enter personal information or download files from this site.</div>`;
  }

  if (data.corsBlocked) {
    warnings += `<div class="warning warning-cors"><i class="ph-duotone ph-info"></i> Basic info only (privacy protection)</div>`;
  }
  if (data.hasTracking) {
    warnings += `<div class="warning warning-tracking"><i class="ph-duotone ph-warning"></i> Tracking parameters</div>`;
  }
  if (data.redirectCount >= 5) {
    warnings += `<div class="warning warning-redirects"><i class="ph-duotone ph-warning"></i> Too many redirects</div>`;
  }

  let buttons = `
    <button class="unboxx-btn unboxx-btn-open" data-url="${escapeHtml(data.finalUrl)}">
      <i class="ph-duotone ph-arrow-square-out"></i> Open
    </button>
    <button class="unboxx-btn unboxx-btn-copy" data-url="${escapeHtml(data.finalUrl)}">
      <i class="ph-duotone ph-copy"></i> Copy
    </button>
  `;

  if (data.hasTracking) {
    buttons += `
      <button class="unboxx-btn unboxx-btn-clean" data-url="${escapeHtml(data.cleanUrl)}">
        <i class="ph-duotone ph-broom"></i> No Tracking
      </button>
    `;
  }

  const headerClass = isUnsafe ? 'unsafe' : '';

  content.innerHTML = `
    <div class="unboxx-tooltip-inner">
      <div class="unboxx-header ${headerClass}">
        ${isUnsafe ? `<div class="unsafe-icon"><i class="ph-duotone ph-warning-octagon"></i></div>` : ''}
        ${!isUnsafe && data.faviconUrl ? `<img class="unboxx-favicon" src="${escapeHtml(data.faviconUrl)}" alt="" onerror="this.style.display='none'">` : ""}
        <div class="unboxx-title">${isUnsafe ? 'DANGEROUS WEBSITE' : escapeHtml(data.title || "Unknown")}</div>
      </div>
      ${data.description && !isUnsafe ? `<div class="unboxx-description">${escapeHtml(data.description)}</div>` : ""}
      <div class="unboxx-url">${escapeHtml(data.finalUrl)}</div>
      ${warnings}
      <div class="unboxx-actions">
        ${buttons}
      </div>
    </div>
  `;

  // Reattach listeners
  content.querySelectorAll(".unboxx-btn-open").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      window.open(btn.dataset.url, "_blank");
    };
  });

  content.querySelectorAll(".unboxx-btn-copy").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.url).then(() => {
        const original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = original; }, 1500);
      });
    };
  });

  content.querySelectorAll(".unboxx-btn-clean").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      window.open(btn.dataset.url, "_blank");
    };
  });

  tooltipElement.setAttribute("data-visible", "true");
  tooltipElement.style.opacity = "1";
  positionTooltip(link);
}

function positionTooltip(link) {
  if (!tooltipElement) return;

  const tooltipContent = document.getElementById("unboxx-tooltip-content");
  if (!tooltipContent) return;

  // Wait for content to render, then measure
  setTimeout(() => {
    const linkRect = link.getBoundingClientRect();
    const tooltipWidth = tooltipContent.offsetWidth || 380;
    const tooltipHeight = tooltipContent.offsetHeight || 200;

    console.log("[unboxx] Tooltip size:", tooltipWidth, "x", tooltipHeight);
    console.log("[unboxx] Link position:", linkRect);

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 10;

    // Calculate ideal centered position above link
    let top = linkRect.top - tooltipHeight - 12;
    let left = linkRect.left + (linkRect.width / 2) - (tooltipWidth / 2);

    // AGGRESSIVE viewport containment - prevent ANY overflow

    // Vertical positioning priority:
    // 1. Try above link
    // 2. If not enough space above, try below
    // 3. If not enough space below, position at top with scroll hint
    if (top < padding) {
      // Not enough space above, try below
      const belowTop = linkRect.bottom + 12;
      if (belowTop + tooltipHeight + padding <= viewportHeight) {
        top = belowTop;
        console.log("[unboxx] Positioned below link");
      } else {
        // Not enough space above OR below - position at top
        top = padding;
        console.log("[unboxx] Positioned at viewport top");
      }
    }

    // Horizontal containment - FORCE within viewport
    if (left < padding) {
      left = padding;
      console.log("[unboxx] Clamped to left edge");
    }
    if (left + tooltipWidth + padding > viewportWidth) {
      left = viewportWidth - tooltipWidth - padding;
      console.log("[unboxx] Clamped to right edge");
    }

    // Bottom containment - prevent going below viewport
    if (top + tooltipHeight + padding > viewportHeight) {
      top = viewportHeight - tooltipHeight - padding;
      console.log("[unboxx] Clamped to bottom edge");
    }

    // Final safety clamps
    top = Math.max(padding, Math.min(top, viewportHeight - tooltipHeight - padding));
    left = Math.max(padding, Math.min(left, viewportWidth - tooltipWidth - padding));

    // Apply positioning
    tooltipElement.style.top = top + "px";
    tooltipElement.style.left = left + "px";
    tooltipElement.style.position = "fixed";
    tooltipElement.style.maxHeight = (viewportHeight - (2 * padding)) + "px";
    tooltipElement.style.overflowY = "auto";

    console.log("[unboxx] Final position:", { top, left });
  }, 50);
}

function hideTooltip() {
  clearTimeout(tooltipHoverTimeout);

  if (!tooltipElement) return;

  tooltipHoverTimeout = setTimeout(() => {
    tooltipElement.setAttribute("data-visible", "false");
    tooltipElement.style.opacity = "0";
    tooltipElement.style.transition = "opacity 200ms ease-in-out";

    setTimeout(() => {
      tooltipElement.removeAttribute("data-visible");
    }, 200);
  }, 100);
}

async function preloadAllLinks(links) {
  // Check if extension context is valid
  if (!chrome.runtime?.id) {
    console.error("[unboxx] Extension context invalidated - cannot preload");
    return;
  }

  // Batch preload: max 5 concurrent
  const batchSize = 5;

  for (let i = 0; i < links.length; i += batchSize) {
    const batch = links.slice(i, i + batchSize);
    const promises = batch.map((link) => {
      const resolved = resolveRelativeUrl(link.getAttribute("href"));

      // Skip non-web links for preload
      if (resolved.type !== "web") {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { action: "resolveUrl", url: resolved.url },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error("[unboxx] Preload error:", chrome.runtime.lastError);
                resolve();
                return;
              }
              if (response) {
                cachedUrlData[resolved.url] = response;
              }
              resolve();
            }
          );
        } catch (err) {
          console.error("[unboxx] Preload exception:", err);
          resolve();
        }
      });
    });

    await Promise.all(promises);
  }

  console.log("[unboxx] Preloading complete");
}

function observeNewLinks() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          const newLinks = node.querySelectorAll("a[href]");
          if (newLinks.length > 0) {
            console.log("[unboxx] Found new links, attaching listeners");
            attachHoverListeners(Array.from(newLinks));
          }
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Render special link types (email, phone, sms)
function renderSpecialLinkTooltip(link, resolved) {
  if (!tooltipElement) return;

  const content = document.getElementById("unboxx-tooltip-content");

  let icon = "ph-envelope";
  let label = "Email";
  if (resolved.type === "phone") {
    icon = "ph-phone";
    label = "Phone";
  } else if (resolved.type === "sms") {
    icon = "ph-chat-circle-text";
    label = "SMS";
  }

  content.innerHTML = `
    <div class="unboxx-tooltip-inner">
      <div class="unboxx-header special">
        <div class="special-icon"><i class="ph-duotone ${icon}"></i></div>
        <div class="unboxx-title">${label} Link</div>
      </div>
      <div class="unboxx-url">${escapeHtml(resolved.display)}</div>
      <div class="unboxx-actions">
        <button class="unboxx-btn unboxx-btn-copy" data-url="${escapeHtml(resolved.display)}">
          <i class="ph-duotone ph-copy"></i> Copy ${label}
        </button>
      </div>
    </div>
  `;

  content.querySelectorAll(".unboxx-btn-copy").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.url).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = `Copy ${label}`; }, 1500);
      });
    };
  });

  tooltipElement.setAttribute("data-visible", "true");
  tooltipElement.style.opacity = "1";
  positionTooltip(link);
}

// Render error tooltip when something fails
function renderErrorTooltip(link, url, errorMsg) {
  if (!tooltipElement) return;

  const content = document.getElementById("unboxx-tooltip-content");

  content.innerHTML = `
    <div class="unboxx-tooltip-inner">
      <div class="unboxx-header error">
        <div class="error-icon"><i class="ph-duotone ph-warning-circle"></i></div>
        <div class="unboxx-title">Unable to Load</div>
      </div>
      <div class="unboxx-description">Extension error: ${escapeHtml(errorMsg)}</div>
      <div class="unboxx-url">${escapeHtml(url)}</div>
      <div class="unboxx-actions">
        <button class="unboxx-btn unboxx-btn-open" data-url="${escapeHtml(url)}">
          <i class="ph-duotone ph-arrow-square-out"></i> Open Anyway
        </button>
        <button class="unboxx-btn unboxx-btn-copy" data-url="${escapeHtml(url)}">
          <i class="ph-duotone ph-copy"></i> Copy URL
        </button>
      </div>
    </div>
  `;

  content.querySelectorAll(".unboxx-btn-open").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      window.open(btn.dataset.url, "_blank");
    };
  });

  content.querySelectorAll(".unboxx-btn-copy").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.url).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy URL"; }, 1500);
      });
    };
  });

  tooltipElement.setAttribute("data-visible", "true");
  tooltipElement.style.opacity = "1";
  positionTooltip(link);
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getStats") {
    try {
      const links = getAllLinks();
      const trackingCount = Object.values(cachedUrlData).filter(
        (data) => data && data.hasTracking === true
      ).length;

      console.log("[unboxx] Sending stats:", { linkCount: links.length, trackingCount });
      sendResponse({
        linkCount: links.length,
        trackingCount: trackingCount,
      });
    } catch (err) {
      console.error("[unboxx] Error getting stats:", err);
      sendResponse({ linkCount: 0, trackingCount: 0 });
    }
    return true;
  }
});
