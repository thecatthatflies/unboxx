// unboxx content script
// One delegated listener set for the whole page, a shadow-DOM overlay that page CSS can't touch,
// and instant local analysis while the background worker fetches the rest.
(() => {
  if (window.__unboxxLoaded) return;
  window.__unboxxLoaded = true;
  if (!(document.documentElement instanceof HTMLElement)) return;

  const Rules = globalThis.UnboxxRules;
  const Card = globalThis.UnboxxCard;
  const Settings = globalThis.UnboxxSettings;

  const PAGE_HOST = location.hostname;
  const PAGE_SITE = Rules.registrableDomain(PAGE_HOST);
  const INCOGNITO = Boolean(chrome.extension && chrome.extension.inIncognitoContext);
  const FAST_SWITCH_DELAY = 90;
  const PREFETCH_DWELL = 120;
  const HIDE_GRACE = 260;
  const SKELETON_GRACE = 140;
  const SCROLL_QUIET = 350;
  const MARGIN = 12;
  const GAP = 10;

  const LAYER_CSS = `
    :host { all: initial; }
    .ubx-pos { position: fixed; top: 0; left: 0; pointer-events: auto; }
    .ubx-pos.is-gliding { transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1); }
    @media (prefers-reduced-motion: reduce) { .ubx-pos.is-gliding { transition: none; } }
    .ubx-pos:empty { display: none; }
    .ubx-toasts { position: fixed; inset: auto 0 0 0; pointer-events: none; }
  `;

  const state = {
    settings: { ...Settings.DEFAULTS },
    active: false,
    alive: true,
    hostEl: null,
    root: null,
    posEl: null,
    toastEl: null,
    cardEl: null,
    link: null,
    pendingLink: null,
    model: null,
    images: {},
    pinned: false,
    expanded: false,
    side: null,
    moved: false,
    pos: { left: 0, top: 0 },
    pointer: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    lastRealMove: 0,
    lastScroll: 0,
    suppressed: null,
    focusOrigin: false,
    overCard: false,
    modifierDown: false,
    armedUntil: 0,
    lastContextLink: null,
    requests: new Map(),
    results: new Map(),
    timers: { show: 0, prefetch: 0, hide: 0, history: 0, toast: 0, summary: 0, retry: 0 },
    drag: null,
    liveFrame: null,
  };

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  function alive() {
    if (state.alive && chrome.runtime && chrome.runtime.id) return true;
    state.alive = false;
    teardown();
    return false;
  }

  function send(message) {
    return new Promise((resolve) => {
      if (!alive()) return resolve(null);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(response === undefined ? null : response);
        });
      } catch {
        alive();
        resolve(null);
      }
    });
  }

  function cleaningOptions() {
    return { strict: state.settings.strictCleaning, unwrap: state.settings.unwrapRedirects };
  }

  // Busy pages re-count their links after every DOM change, so remember each href's analysis.
  const analysisCache = new Map();
  function analyzeCached(href) {
    const opts = cleaningOptions();
    const key = `${opts.strict ? 1 : 0}${opts.unwrap ? 1 : 0}${href}`;
    let result = analysisCache.get(key);
    if (!result) {
      result = Rules.analyze(href, opts);
      analysisCache.set(key, result);
      if (analysisCache.size > 8000) analysisCache.delete(analysisCache.keys().next().value);
    }
    return result;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function clearTimer(name) {
    clearTimeout(state.timers[name]);
    state.timers[name] = 0;
  }

  function isEditable(node) {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") return !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type);
    return false;
  }

  function linkText(a) {
    return (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200);
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  function applySettings(settings) {
    const wasActive = state.active;
    state.settings = settings;
    state.active = !settings.paused && !Settings.isSiteDisabled(settings, PAGE_HOST);
    if (state.root) state.root.dataset.theme = settings.theme;
    if (wasActive && !state.active) hide(true);
    state.requests.clear();
    state.results.clear();
    analysisCache.clear();
    scheduleSummary(300);
  }

  Settings.load()
    .then((settings) => {
      applySettings(settings);
      maybePrefetchSmallPage();
    })
    .catch(() => {});
  Settings.onChange(applySettings);

  // -------------------------------------------------------------------------
  // Link detection
  // -------------------------------------------------------------------------

  function previewable(node, { respectSameSite = true } = {}) {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el || !el.closest) return null;
    const a = el.closest("a[href], area[href]");
    if (!a || !(a instanceof HTMLAnchorElement || a instanceof HTMLAreaElement)) return null;
    const raw = (a.getAttribute("href") || "").trim();
    if (!raw || raw.startsWith("#")) return null;
    if (/^(javascript|data|blob|about|vbscript):/i.test(raw)) return null;
    const href = a.href;
    if (!href) return null;
    try {
      const u = new URL(href);
      if (u.hash && u.origin + u.pathname + u.search === location.origin + location.pathname + location.search) return null;
      if (respectSameSite && state.settings.skipSameSite && (u.protocol === "http:" || u.protocol === "https:") && Rules.registrableDomain(u.hostname) === PAGE_SITE) return null;
    } catch {
      return null;
    }
    return a;
  }

  function collectLinks() {
    const out = [];
    const all = document.querySelectorAll("a[href], area[href]");
    for (let i = 0; i < all.length && out.length < 5000; i++) {
      if (previewable(all[i], { respectSameSite: false })) out.push(all[i]);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Overlay layer (closed shadow root, attached lazily)
  // -------------------------------------------------------------------------

  function ensureLayer() {
    if (state.hostEl && state.hostEl.isConnected) return;
    const host = document.createElement("unboxx-layer");
    host.setAttribute("style", "all: initial; display: block; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;");
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>${Card.CSS}${LAYER_CSS}</style><div class="ubx-root" data-theme="${Card.esc(state.settings.theme)}"><div class="ubx-pos"></div><div class="ubx-toasts"></div></div>`;
    (document.body || document.documentElement).appendChild(host);

    state.hostEl = host;
    state.root = shadow.querySelector(".ubx-root");
    state.posEl = shadow.querySelector(".ubx-pos");
    state.toastEl = shadow.querySelector(".ubx-toasts");

    state.posEl.addEventListener("pointerenter", () => {
      state.overCard = true;
      clearTimer("hide");
    });
    state.posEl.addEventListener("pointerleave", () => {
      state.overCard = false;
      if (!state.pinned) scheduleHide();
    });
    state.posEl.addEventListener("click", onCardClick);
    state.posEl.addEventListener("auxclick", onCardClick);
    state.posEl.addEventListener("pointerdown", onDragStart);
    state.posEl.addEventListener("focusout", (e) => {
      if (state.focusOrigin && !state.pinned && !state.posEl.contains(e.relatedTarget) && e.relatedTarget !== state.link) scheduleHide(120);
    });
  }

  // -------------------------------------------------------------------------
  // Showing and hiding
  // -------------------------------------------------------------------------

  function scheduleShow(a, delay) {
    clearTimer("show");
    clearTimer("prefetch");
    state.pendingLink = a;
    const effective = state.cardEl && !state.pinned ? Math.min(delay, FAST_SWITCH_DELAY) : delay;
    if (effective > PREFETCH_DWELL) {
      state.timers.prefetch = setTimeout(() => {
        if (state.pendingLink === a) request(a.href);
      }, PREFETCH_DWELL);
    }
    state.timers.show = setTimeout(() => {
      if (state.pendingLink === a) show(a);
    }, effective);
  }

  function cancelPending(a) {
    if (a && state.pendingLink !== a) return;
    clearTimer("show");
    clearTimer("prefetch");
    state.pendingLink = null;
  }

  function scheduleHide(delay = HIDE_GRACE) {
    if (state.pinned) return;
    clearTimer("hide");
    state.timers.hide = setTimeout(() => {
      if (state.pinned || state.overCard || state.drag) return;
      if (state.link && !state.focusOrigin && state.link.matches(":hover")) return;
      hide();
    }, delay);
  }

  function enrich(res, a) {
    if (res.kind !== "web") return res;
    const text = linkText(a);
    // Only warn when the text matches neither the link itself nor where it ends up.
    const toFinal = Rules.textMismatch(text, res.finalUrl);
    const toTarget = Rules.textMismatch(text, res.target);
    return { ...res, linkText: text, mismatch: toFinal && toTarget ? toFinal : null, loading: false };
  }

  function request(href, force = false) {
    const opts = cleaningOptions();
    const key = `${href}|${opts.strict ? 1 : 0}${opts.unwrap ? 1 : 0}`;
    if (!force && state.requests.has(key)) return state.requests.get(key);
    const job = send({ action: "resolve", url: href, opts, force });
    state.requests.set(key, job);
    job.then((res) => {
      // A model carries `kind`; an error reply from the worker does not. Down sites are still models.
      if (!res || !res.kind || res.error) state.requests.delete(key);
      if (res && res.kind && !res.error) state.results.set(key, res);
      if (state.results.size > 400) state.results.delete(state.results.keys().next().value);
    });
    if (state.requests.size > 400) state.requests.delete(state.requests.keys().next().value);
    return job;
  }

  function settledResult(href) {
    const opts = cleaningOptions();
    return state.results.get(`${href}|${opts.strict ? 1 : 0}${opts.unwrap ? 1 : 0}`) || null;
  }

  async function show(a, { force = false } = {}) {
    if (!state.active || !alive() || !a.isConnected) return;
    ensureLayer();
    clearTimer("hide");
    clearTimer("history");
    clearTimer("retry");

    const switching = state.link !== a;
    // Glide between neighbouring links instead of jumping.
    state.posEl.classList.toggle("is-gliding", Boolean(switching && state.cardEl && !state.moved));
    state.link = a;
    state.pendingLink = null;
    if (switching) {
      state.expanded = false;
      state.side = null;
      state.moved = false;
      state.images = {};
    }

    const local = analyzeCached(a.href);
    if (!local.ok) return;

    if (local.kind !== "web") {
      state.model = { ...local, displayHost: local.address };
      renderCard();
      return;
    }

    const instant = Card.localModel(local, linkText(a));
    state.model = instant;

    // Skip the loading skeleton when the answer is already here or arrives within a blink.
    const cached = force ? null : settledResult(a.href);
    const job = cached ? Promise.resolve(cached) : request(a.href, force);
    const quick = cached || (await Promise.race([job, new Promise((r) => setTimeout(() => r(null), SKELETON_GRACE))]));
    if (state.link !== a || state.model !== instant) return;
    if (!quick) renderCard();

    const res = quick || (await job);
    if (state.link !== a || state.model !== instant) return;

    state.model = res && res.kind ? enrich(res, a) : { ...instant, loading: false, error: "unreachable" };
    renderCard();
    paintImages(state.model);
    scheduleHistory(state.model);
  }

  // Keeps a link from reopening its preview until the pointer leaves it.
  function suppress(a) {
    state.suppressed = a || null;
  }

  function hide(immediate = false) {
    if (state.link && !state.pinned && state.link.matches(":hover")) suppress(state.link);
    clearTimer("show");
    clearTimer("prefetch");
    clearTimer("hide");
    clearTimer("history");
    clearTimer("retry");
    state.link = null;
    state.pendingLink = null;
    state.model = null;
    state.images = {};
    state.pinned = false;
    state.expanded = false;
    state.overCard = false;
    state.focusOrigin = false;
    state.moved = false;
    state.drag = null;
    state.liveFrame = null;
    if (state.posEl) state.posEl.classList.remove("is-gliding");

    const card = state.cardEl;
    state.cardEl = null;
    if (!card) return;
    if (immediate || reducedMotion()) {
      card.remove();
      return;
    }
    card.classList.remove("ubx-enter");
    card.classList.add("ubx-leave");
    setTimeout(() => {
      if (state.cardEl !== card) card.remove();
    }, 150);
  }

  function renderCard() {
    if (!state.model || !state.posEl) return;
    const entering = !state.cardEl;
    state.posEl.innerHTML = Card.render(state.model, {
      context: "page",
      pinned: state.pinned,
      expanded: state.expanded,
      previews: state.settings.previewImages,
      shortcuts: state.settings.keyboardShortcuts,
    });
    state.cardEl = state.posEl.firstElementChild;
    if (state.moved) state.cardEl.dataset.moved = "true";
    place();
    if (entering && !reducedMotion()) state.cardEl.classList.add("ubx-enter");
    repaintCached();
    mountLive();
  }

  // Loads the real page into the card through the extension's sandboxed preview frame.
  function mountLive() {
    state.liveFrame = null;
    const slot = state.cardEl && state.cardEl.querySelector("[data-ubx-live]");
    if (!slot || !state.model || state.model.loading || !alive()) return;
    const frame = document.createElement("iframe");
    frame.title = "Live preview";
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.src = `${chrome.runtime.getURL("preview.html")}#${encodeURIComponent(Card.liveUrl(state.model))}`;
    slot.appendChild(frame);
    state.liveFrame = frame;
  }

  function onPreviewMessage(e) {
    const frame = state.liveFrame;
    if (!frame || e.source !== frame.contentWindow) return;
    if (e.data && e.data.source === "unboxx-preview" && e.data.state === "loaded") frame.classList.add("is-loaded");
  }

  // -------------------------------------------------------------------------
  // Positioning
  // -------------------------------------------------------------------------

  function anchorRect() {
    const a = state.link;
    if (!a || !a.isConnected) return null;
    const rects = Array.from(a.getClientRects()).filter((r) => r.width || r.height);
    if (!rects.length) return null;
    if (rects.length === 1 || state.focusOrigin) return rects[0];
    const y = state.pointer.y;
    let best = rects[0];
    let bestDistance = Infinity;
    for (const r of rects) {
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bestDistance) {
        bestDistance = d;
        best = r;
      }
    }
    return best;
  }

  function place() {
    const card = state.cardEl;
    if (!card || !state.posEl) return;
    if (state.moved) return;

    const r = anchorRect();
    if (!r) {
      if (!state.pinned) hide(true);
      return;
    }

    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const ax = state.focusOrigin ? r.left + r.width / 2 : clamp(state.pointer.x, r.left, r.right);

    if (!state.side) {
      const below = vh - r.bottom - GAP - MARGIN;
      const above = r.top - GAP - MARGIN;
      state.side = below >= h || below >= above ? "bottom" : "top";
    }

    const ideal = state.side === "bottom" ? r.bottom + GAP : r.top - GAP - h;
    const top = clamp(ideal, MARGIN, Math.max(MARGIN, vh - h - MARGIN));
    card.dataset.detached = String(Math.abs(top - ideal) > 2);
    const left = clamp(ax - w / 2, MARGIN, Math.max(MARGIN, vw - w - MARGIN));
    state.pos = { left, top };
    state.posEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    card.dataset.side = state.side;
    card.style.setProperty("--ubx-arrow-x", `${clamp(ax - left, 26, w - 26)}px`);
    card.style.setProperty("--ubx-dy", state.side === "bottom" ? "-5px" : "5px");
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  function paintAll(selector, image, fit, align) {
    if (!state.cardEl || !image) return;
    state.cardEl.querySelectorAll(selector).forEach((canvas) => Card.paint(canvas, image, fit, align));
  }

  function dropPreviewCanvas() {
    const canvas = state.cardEl && state.cardEl.querySelector('[data-ubx-paint="preview"]');
    if (canvas) canvas.remove();
  }

  function repaintCached() {
    if (state.images.favicon) paintAll('[data-ubx-paint^="favicon"]', state.images.favicon, "contain");
    if (state.images.preview) paintAll('[data-ubx-paint="preview"]', state.images.preview, "cover", state.images.previewAlign);
    else if (state.images.previewMissing) dropPreviewCanvas();
  }

  async function paintImages(model, attempt = 0) {
    if (!model || model.kind !== "web" || model.loading) return;
    const settings = state.settings;

    if (model.faviconUrl && !state.images.favicon && attempt === 0) {
      send({ action: "getImage", url: model.faviconUrl, kind: "favicon" }).then((image) => {
        if (state.model !== model || !image || image.pending) return;
        state.images.favicon = image;
        paintAll('[data-ubx-paint^="favicon"]', image, "contain");
      });
    }

    if (settings.previewImages === "off" || (model.safety && model.safety.status === "unsafe")) return;

    let image = null;
    let align = "center";
    if (settings.previewImages === "screenshot") {
      image = await send({ action: "getImage", url: Card.screenshotUrl(model.cleanUrl || model.finalUrl), kind: "screenshot" });
      if (state.model !== model) return;
      if (image && image.pending) {
        image = null;
        if (attempt < 2) {
          clearTimer("retry");
          state.timers.retry = setTimeout(() => {
            state.timers.retry = 0;
            paintImages(model, attempt + 1);
          }, 3500);
        }
      } else if (image) {
        align = "top";
      }
    }
    if (!image && model.imageUrl && !state.images.preview) {
      image = await send({ action: "getImage", url: model.imageUrl, kind: "preview" });
    }
    if (state.model !== model) return;

    if (image && !image.pending) {
      state.images.preview = image;
      state.images.previewAlign = align;
      state.images.previewMissing = false;
      paintAll('[data-ubx-paint="preview"]', image, "cover", align);
    } else if (!state.images.preview && !state.timers.retry) {
      state.images.previewMissing = true;
      dropPreviewCanvas();
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function copy(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to a temporary textarea when the async clipboard is unavailable.
    }
    const active = document.activeElement;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("style", "position:fixed;top:-9999px;left:-9999px;opacity:0;");
    document.documentElement.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    if (active && active.focus) active.focus({ preventScroll: true });
    return ok;
  }

  function toast(text) {
    if (!text) return;
    ensureLayer();
    clearTimer("toast");
    state.toastEl.innerHTML = `<div class="ubx-toast" role="status">${Card.MARK}${Card.esc(text)}</div>`;
    state.timers.toast = setTimeout(() => {
      state.toastEl.innerHTML = "";
    }, 2500);
  }

  function trackerTotal(model) {
    return (model.removed || []).length + (model.unwrapped && model.unwrapped.length ? 1 : 0);
  }

  function openUrl(model) {
    return state.settings.cleanOnClick ? model.cleanUrl || model.finalUrl || model.href : model.href;
  }

  function onCardClick(e) {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    if (e.type === "auxclick" && e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    let act = el.dataset.act;
    if (act === "open" && (e.type === "auxclick" || e.metaKey || e.ctrlKey)) act = "open-bg";
    runAction(act, el);
  }

  async function runAction(act, button) {
    const m = state.model;
    if (!m) return;
    const danger = m.safety && m.safety.status === "unsafe";

    switch (act) {
      case "copy": {
        const url = m.cleanUrl || m.href;
        if (await copy(url)) {
          Card.flash(button, "Copied");
          if (url !== m.href) send({ action: "bumpStat", name: "trackersRemoved", by: trackerTotal(m) });
        } else {
          toast("Copy failed");
        }
        break;
      }
      case "copy-original":
        if (await copy(m.href)) {
          Card.flash(button, "Copied");
          toast("Original link copied");
        } else {
          toast("Copy failed");
        }
        break;
      case "copy-md":
        if (await copy(Card.markdown({ ...m, title: m.title || m.linkText }))) {
          Card.flash(button, "Copied");
          toast("Markdown link copied");
        }
        break;
      case "copy-address":
        if (await copy(m.address)) Card.flash(button, "Copied");
        break;
      case "open":
      case "open-bg": {
        if (danger && Date.now() > state.armedUntil) {
          state.armedUntil = Date.now() + 4000;
          toast("Flagged as dangerous. Open again to continue.");
          return;
        }
        const url = openUrl(m);
        if (url !== m.href) send({ action: "bumpStat", name: "trackersRemoved", by: trackerTotal(m) });
        if (act === "open") {
          window.open(url, "_blank", "noopener,noreferrer");
        } else {
          send({ action: "openTab", url, active: false });
          toast("Opened in a background tab");
        }
        if (!state.pinned) hide();
        break;
      }
      case "open-native":
        window.location.href = m.href;
        hide();
        break;
      case "pin":
        togglePin();
        break;
      case "close":
        hide();
        break;
      case "details":
        toggleDetails();
        break;
      case "wayback":
        window.open(`https://web.archive.org/web/2/${m.cleanUrl || m.href}`, "_blank", "noopener,noreferrer");
        break;
      case "virustotal":
        window.open(`https://www.virustotal.com/gui/search/${encodeURIComponent(m.finalUrl || m.href)}`, "_blank", "noopener,noreferrer");
        break;
      case "refresh":
        if (state.link) show(state.link, { force: true });
        break;
    }
  }

  function setPinned(pinned) {
    if (!state.cardEl || !state.model) return;
    state.pinned = pinned;
    if (!pinned) {
      state.moved = false;
      delete state.cardEl.dataset.moved;
    }
    state.cardEl.dataset.pinned = String(pinned);
    const head = state.cardEl.querySelector(".ubx-head");
    if (head) head.outerHTML = Card.renderHeader(state.model, { context: "page", pinned });
    place();
  }

  function togglePin() {
    setPinned(!state.pinned);
    if (!state.pinned && !state.overCard) scheduleHide();
  }

  function toggleDetails() {
    if (!state.cardEl) return;
    state.expanded = !state.expanded;
    const details = state.cardEl.querySelector(".ubx-details");
    const button = state.cardEl.querySelector('[data-act="details"]');
    if (details) details.hidden = !state.expanded;
    if (button) {
      button.setAttribute("aria-expanded", String(state.expanded));
      button.setAttribute("aria-label", state.expanded ? "Hide details" : "Show details");
    }
    place();
  }

  // -------------------------------------------------------------------------
  // Drag to move (dragging the header pins the card)
  // -------------------------------------------------------------------------

  function onDragStart(e) {
    if (e.button !== 0 || !state.cardEl) return;
    const handle = e.target.closest("[data-drag-handle]");
    if (!handle || e.target.closest("button, a")) return;
    e.preventDefault();
    state.posEl.classList.remove("is-gliding");
    // Capture on the container: the header is re-rendered when dragging auto-pins the card.
    const surface = state.posEl;
    state.drag = { x: e.clientX, y: e.clientY, left: state.pos.left, top: state.pos.top, started: false, id: e.pointerId, surface };
    surface.setPointerCapture(e.pointerId);
    surface.addEventListener("pointermove", onDragMove);
    surface.addEventListener("pointerup", onDragEnd);
    surface.addEventListener("pointercancel", onDragEnd);
  }

  function onDragMove(e) {
    const d = state.drag;
    if (!d || !state.cardEl) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.started) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      d.started = true;
      if (!state.pinned) setPinned(true);
      state.moved = true;
      state.cardEl.dataset.moved = "true";
      state.cardEl.dataset.dragging = "true";
    }
    const w = state.cardEl.offsetWidth;
    const h = state.cardEl.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const left = clamp(d.left + dx, 4, vw - w - 4);
    const top = clamp(d.top + dy, 4, window.innerHeight - Math.min(h, 60));
    state.pos = { left, top };
    state.posEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function onDragEnd() {
    const d = state.drag;
    if (!d) return;
    d.surface.removeEventListener("pointermove", onDragMove);
    d.surface.removeEventListener("pointerup", onDragEnd);
    d.surface.removeEventListener("pointercancel", onDragEnd);
    if (d.surface.hasPointerCapture(d.id)) d.surface.releasePointerCapture(d.id);
    if (state.cardEl) delete state.cardEl.dataset.dragging;
    state.drag = null;
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  function scheduleHistory(model) {
    clearTimer("history");
    if (!state.settings.keepHistory || INCOGNITO || !model || model.kind !== "web" || model.error) return;
    state.timers.history = setTimeout(() => {
      if (state.model !== model) return;
      send({
        action: "recordHistory",
        entry: {
          url: model.href,
          cleanUrl: model.cleanUrl,
          title: model.title || model.linkText || model.displayHost,
          host: model.displayHost,
          faviconUrl: model.faviconUrl || "",
          trackers: trackerTotal(model),
          from: PAGE_HOST,
        },
      });
    }, 900);
  }

  // -------------------------------------------------------------------------
  // Cleaning links on the page
  // -------------------------------------------------------------------------

  function cleanAnchor(a) {
    if (!a || a.isContentEditable) return 0;
    const local = analyzeCached(a.href);
    if (!local.ok || local.kind !== "web" || !local.changed) return 0;
    a.href = local.clean;
    return local.removed.length + (local.unwrapped.length ? 1 : 0);
  }

  // -------------------------------------------------------------------------
  // Page summary (toolbar badge and popup stats)
  // -------------------------------------------------------------------------

  function summarize() {
    const links = collectLinks();
    const summary = { links: links.length, trackers: 0, external: 0, insecure: 0, shorteners: 0, special: 0 };
    for (const a of links) {
      const r = analyzeCached(a.href);
      if (!r.ok) continue;
      if (r.kind !== "web") {
        summary.special++;
        continue;
      }
      if (r.removed.length || r.unwrapped.length) summary.trackers++;
      if (r.registrable && r.registrable !== PAGE_SITE) summary.external++;
      if (r.flags.insecure) summary.insecure++;
      if (r.flags.shortener) summary.shorteners++;
    }
    return summary;
  }

  function scheduleSummary(delay = 1200) {
    clearTimer("summary");
    state.timers.summary = setTimeout(() => {
      const run = () => {
        if (!alive()) return;
        const summary = state.active ? summarize() : { trackers: 0 };
        send({ action: "pageSummary", trackers: summary.trackers, showBadge: state.settings.showBadge && state.active });
      };
      if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 2500 });
      else run();
    }, delay);
  }

  function maybePrefetchSmallPage() {
    if (!state.settings.prefetchSmallPages || !state.active) return;
    const start = () => {
      const links = collectLinks();
      if (links.length > 25) return;
      const queue = links.filter((a) => {
        const r = analyzeCached(a.href);
        return r.ok && r.kind === "web" && !r.isAction && r.registrable !== PAGE_SITE;
      });
      let index = 0;
      const next = () => {
        if (index >= queue.length || !alive()) return;
        request(queue[index++].href).then(next);
      };
      for (let i = 0; i < 3; i++) next();
    };
    if (document.readyState === "complete") setTimeout(start, 800);
    else window.addEventListener("load", () => setTimeout(start, 800), { once: true });
  }

  // -------------------------------------------------------------------------
  // DOM events
  // -------------------------------------------------------------------------

  // True when the pointer is heading for the open card, so links crossed on the way don't steal it.
  function aimingAtCard() {
    if (!state.cardEl || state.moved) return false;
    const { x: vx, y: vy } = state.velocity;
    const speed = Math.hypot(vx, vy);
    if (speed < 0.5) return false;
    const w = state.cardEl.offsetWidth;
    const h = state.cardEl.offsetHeight;
    const pad = 12;
    const left = state.pos.left - pad;
    const top = state.pos.top - pad;
    const right = state.pos.left + w + pad;
    const bottom = state.pos.top + h + pad;
    for (let step = 1; step <= 24; step++) {
      const px = state.pointer.x + (vx / speed) * step * 12;
      const py = state.pointer.y + (vy / speed) * step * 12;
      if (px >= left && px <= right && py >= top && py <= bottom) return true;
    }
    return false;
  }

  function onPointerOver(e) {
    if (!state.active) return;
    if (e.pointerType === "touch" || e.buttons) return;
    if (state.hostEl && e.target === state.hostEl) {
      clearTimer("hide");
      return;
    }
    const a = previewable(e.target);
    if (!a) return;
    state.pointer = { x: e.clientX, y: e.clientY };
    if (a === state.link) {
      clearTimer("hide");
      return;
    }
    if (state.pinned || a === state.pendingLink || a === state.suppressed) return;
    // Content scrolling under a still pointer fires pointerover too. Only real movement counts.
    if (state.lastScroll > state.lastRealMove && Date.now() - state.lastScroll < SCROLL_QUIET) return;
    state.focusOrigin = false;
    if (state.settings.trigger === "modifier" && !(state.modifierDown || e.altKey)) {
      state.pendingLink = a;
      return;
    }
    const delay = state.settings.trigger === "modifier" ? 0 : state.settings.hoverDelay;
    if (aimingAtCard()) {
      // Wait the full delay: if the pointer is just passing through, pointerout cancels it.
      clearTimer("show");
      clearTimer("prefetch");
      state.pendingLink = a;
      state.timers.show = setTimeout(() => {
        if (state.pendingLink === a && !state.overCard) show(a);
      }, Math.max(delay, 300));
      return;
    }
    scheduleShow(a, delay);
  }

  function onPointerOut(e) {
    if (!state.active) return;
    const from = e.target && e.target.closest ? e.target.closest("a[href], area[href]") : null;
    if (!from) return;
    const to = e.relatedTarget;
    if (to && (from.contains(to) || (state.hostEl && to === state.hostEl && from === state.link))) return;
    if (from === state.suppressed) suppress(null);
    cancelPending(from);
    if (from === state.link && !state.focusOrigin) scheduleHide();
  }

  function onPointerMove(e) {
    const dx = e.clientX - state.pointer.x;
    const dy = e.clientY - state.pointer.y;
    if (dx || dy) {
      state.lastRealMove = Date.now();
      // Smoothed direction of travel, used to tell when the pointer is heading for the card.
      state.velocity.x = state.velocity.x * 0.6 + dx * 0.4;
      state.velocity.y = state.velocity.y * 0.6 + dy * 0.4;
    }
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
  }

  function onFocusIn(e) {
    if (!state.active || !state.settings.showOnFocus) return;
    if (state.hostEl && e.target === state.hostEl) {
      clearTimer("hide");
      return;
    }
    const a = previewable(e.target);
    if (!a || a === state.link || state.pinned) return;
    let keyboard = false;
    try {
      keyboard = a.matches(":focus-visible");
    } catch {
      keyboard = false;
    }
    if (!keyboard) return;
    state.focusOrigin = true;
    scheduleShow(a, Math.max(220, state.settings.hoverDelay));
  }

  function onFocusOut(e) {
    if (!state.active || !state.focusOrigin) return;
    const a = previewable(e.target);
    if (!a) return;
    cancelPending(a);
    if (a === state.link && e.relatedTarget !== state.hostEl) scheduleHide(120);
  }

  function onKeyDown(e) {
    if (e.key === "Alt") {
      state.modifierDown = true;
      if (state.active && state.settings.trigger === "modifier" && state.pendingLink && state.pendingLink.matches(":hover") && !state.cardEl) {
        show(state.pendingLink);
      }
      return;
    }
    if (!state.cardEl || !state.model) return;

    if (e.key === "Escape") {
      e.stopPropagation();
      hide();
      return;
    }

    const origin = e.composedPath ? e.composedPath()[0] : e.target;
    if (isEditable(origin)) {
      // Get out of the way as soon as someone starts typing.
      if (!state.pinned && origin !== state.hostEl) hide();
      return;
    }
    if (!state.settings.keyboardShortcuts || e.ctrlKey || e.metaKey || e.altKey) return;
    const engaged = state.pinned || state.overCard || state.focusOrigin || (state.link && state.link.matches(":hover"));
    if (!engaged) return;

    const key = e.key.toLowerCase();
    const special = state.model.kind !== "web";
    let act = { c: e.shiftKey ? "copy-original" : "copy", m: "copy-md", o: "open", b: "open-bg", p: "pin", d: "details" }[key];
    if (!act) return;
    if (special) {
      if (key === "c") act = "copy-address";
      else if (key === "o") act = "open-native";
      else if (key !== "p") return;
    }
    if (act === "copy-original" && !state.cardEl.querySelector('[data-act="copy-original"]')) act = "copy";
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    runAction(act, state.cardEl.querySelector(`[data-act="${act}"]`));
  }

  function onKeyUp(e) {
    if (e.key === "Alt") state.modifierDown = false;
  }

  function onActivate(e) {
    if (!state.active || !state.settings.cleanOnClick) return;
    if (e.type === "click" && e.button !== 0) return;
    if (e.type === "auxclick" && e.button !== 1) return;
    if (state.hostEl && e.target === state.hostEl) return;
    const a = previewable(e.target, { respectSameSite: false });
    const removed = cleanAnchor(a);
    if (removed) send({ action: "bumpStat", name: "trackersRemoved", by: removed });
  }

  function onContextMenu(e) {
    const a = previewable(e.target, { respectSameSite: false });
    state.lastContextLink = a;
    if (a && state.active && state.settings.cleanOnClick) {
      const removed = cleanAnchor(a);
      if (removed) send({ action: "bumpStat", name: "trackersRemoved", by: removed });
    }
  }

  function onPointerDown(e) {
    if (state.hostEl && e.target === state.hostEl) return;
    cancelPending();
    // A click means the person already decided. Don't pop a preview for that link now.
    const a = previewable(e.target, { respectSameSite: false });
    if (state.cardEl && !state.pinned) hide();
    if (a) suppress(a);
  }

  function onScroll(e) {
    if (state.hostEl && e.target === state.hostEl) return;
    state.lastScroll = Date.now();
    if (state.pendingLink) cancelPending();
    if (!state.cardEl || state.pinned || state.overCard) return;
    hide();
  }

  function onResize() {
    if (state.cardEl && !state.moved) place();
  }

  function onBlur() {
    state.modifierDown = false;
    if (state.cardEl && !state.pinned) hide(true);
  }

  const listeners = [
    [document, "pointerover", onPointerOver, true],
    [document, "pointerout", onPointerOut, true],
    [document, "pointermove", onPointerMove, { capture: true, passive: true }],
    [document, "pointerdown", onPointerDown, true],
    [document, "focusin", onFocusIn, true],
    [document, "focusout", onFocusOut, true],
    [document, "keydown", onKeyDown, true],
    [document, "keyup", onKeyUp, true],
    [document, "click", onActivate, true],
    [document, "auxclick", onActivate, true],
    [document, "contextmenu", onContextMenu, true],
    [window, "scroll", onScroll, { capture: true, passive: true }],
    [window, "resize", onResize, { passive: true }],
    [window, "blur", onBlur, false],
    [window, "message", onPreviewMessage, false],
  ];
  for (const [target, type, fn, opts] of listeners) target.addEventListener(type, fn, opts);

  let observer = null;
  function observeMutations() {
    if (!document.body) return;
    observer = new MutationObserver(() => scheduleSummary(1500));
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleSummary(600);
  }
  if (document.body) observeMutations();
  else document.addEventListener("DOMContentLoaded", observeMutations, { once: true });

  function teardown() {
    for (const [target, type, fn, opts] of listeners) target.removeEventListener(type, fn, opts);
    if (observer) observer.disconnect();
    for (const name of Object.keys(state.timers)) clearTimer(name);
    if (state.hostEl) state.hostEl.remove();
    state.hostEl = null;
    state.cardEl = null;
  }

  // -------------------------------------------------------------------------
  // Messages from the popup and background
  // -------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request && request.action) {
      case "getStats":
        sendResponse({ ...summarize(), active: state.active, host: PAGE_HOST });
        return false;
      case "cleanAllLinks": {
        let links = 0;
        let trackers = 0;
        for (const a of collectLinks()) {
          const removed = cleanAnchor(a);
          if (removed) {
            links++;
            trackers += removed;
          }
        }
        if (trackers) send({ action: "bumpStat", name: "trackersRemoved", by: trackers });
        toast(links ? `${links} link${links === 1 ? "" : "s"} cleaned` : "No tracked links");
        scheduleSummary(200);
        sendResponse({ links, trackers });
        return false;
      }
      case "copyText":
        copy(request.text).then((ok) => {
          toast(ok ? request.toast || "Copied" : "Copy failed");
          sendResponse({ ok });
        });
        return true;
      case "copyMarkdown": {
        const a = state.lastContextLink;
        const title = (a && linkText(a)) || request.title || Rules.displayParts(request.cleanUrl).host;
        copy(Card.markdown({ title, cleanUrl: request.cleanUrl, href: request.url })).then((ok) => {
          toast(ok ? "Markdown link copied" : "Copy failed");
          sendResponse({ ok });
        });
        return true;
      }
      case "toast":
        toast(request.text);
        return false;
      default:
        return false;
    }
  });
})();
