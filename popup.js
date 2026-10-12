// unboxx popup
(() => {
  const Rules = globalThis.UnboxxRules;
  const Settings = globalThis.UnboxxSettings;
  const Card = globalThis.UnboxxCard;
  const { icon } = globalThis.UnboxxIcons;

  const $ = (selector) => document.querySelector(selector);
  const RECENT_LIMIT = 6;

  let settings = { ...Settings.DEFAULTS };
  let tab = null;
  let pageHost = "";
  let unboxModel = null;
  let unboxExpanded = false;

  document.head.insertAdjacentHTML("beforeend", `<style>${Card.CSS}</style>`);

  function hydrateIcons(scope = document) {
    scope.querySelectorAll("i[data-mark]").forEach((el) => {
      el.outerHTML = Card.MARK;
    });
    scope.querySelectorAll("i[data-icon]").forEach((el) => {
      el.outerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 16);
    });
  }

  function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => null);
  }

  function sendToTab(message) {
    if (!tab || tab.id === undefined) return Promise.resolve(null);
    return chrome.tabs.sendMessage(tab.id, message).catch(() => null);
  }

  function cleaningOptions() {
    return { strict: settings.strictCleaning, unwrap: settings.unwrapRedirects };
  }

  // Clipboard writes can fail (focus lost, permission). Report instead of throwing.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  }

  async function paintFavicon(canvas, url) {
    if (!canvas || !url) return;
    const image = await send({ action: "getImage", url, kind: "favicon" });
    if (image && !image.pending) Card.paint(canvas, image, "contain");
  }

  // -------------------------------------------------------------------------
  // Pause and current site
  // -------------------------------------------------------------------------

  function renderPause() {
    const button = $("#pause");
    button.setAttribute("aria-pressed", String(settings.paused));
    button.title = settings.paused ? "Resume everywhere" : "Pause everywhere";
    button.setAttribute("aria-label", button.title);
    $("#paused-banner").hidden = !settings.paused;
  }

  async function togglePause(paused) {
    settings = await Settings.save({ paused });
    renderPause();
    renderSite();
  }

  function renderSite() {
    const toggle = $("#site-toggle");
    const sub = $("#site-sub");
    const supported = Boolean(pageHost);

    $("#site-host").textContent = supported ? Settings.normalizeHost(pageHost) : "This page";
    $("#site-letter").textContent = supported ? Settings.normalizeHost(pageHost).charAt(0) : "?";
    $("#site-switch").hidden = !supported;
    $("#stats").hidden = !supported;
    $("#tools").hidden = !supported;

    // The switch shows on/off. Text appears only for states the switch can't express.
    if (!supported) {
      sub.textContent = "Not available";
      sub.title = "Browser pages, the Web Store and local files can't run extensions.";
      sub.hidden = false;
      return;
    }

    const disabled = Settings.isSiteDisabled(settings, pageHost);
    toggle.checked = !disabled;
    toggle.disabled = settings.paused;
    sub.hidden = !settings.paused;
    sub.textContent = settings.paused ? "Paused" : "";
    sub.removeAttribute("title");
  }

  async function loadStats() {
    if (!pageHost) return;
    const stats = await sendToTab({ action: "getStats" });
    const note = $("#site-note");
    if (!stats) {
      ["#stat-links", "#stat-trackers"].forEach((id) => ($(id).textContent = "-"));
      note.hidden = false;
      $("#clean-all").disabled = true;
      return;
    }
    $("#stat-links").textContent = stats.links.toLocaleString();
    $("#stat-trackers").textContent = stats.trackers.toLocaleString();
    $("#stat-trackers").dataset.tone = stats.trackers ? "warn" : "";
    $("#clean-all").disabled = stats.trackers === 0;
  }

  function setupPageTools() {
    const local = tab && tab.url ? Rules.analyze(tab.url, cleaningOptions()) : null;
    const copyButton = $("#copy-page");
    if (local && local.ok && local.kind === "web") {
      const count = local.removed.length;
      copyButton.title = count ? `Copies this page's address without its ${plural(count, "tracker")}.` : "Copies this page's address.";
    }

    copyButton.addEventListener("click", async () => {
      if (!local || !local.ok || local.kind !== "web") return;
      if (!(await copyText(local.clean))) {
        Card.flash(copyButton, "Couldn't copy", "warning");
        return;
      }
      Card.flash(copyButton, "Copied");
      if (local.removed.length) send({ action: "bumpStat", name: "trackersRemoved", by: local.removed.length });
    });

    $("#clean-all").addEventListener("click", async (e) => {
      const button = e.currentTarget;
      const result = await sendToTab({ action: "cleanAllLinks" });
      if (!result) return;
      Card.flash(button, result.links ? `${result.links} cleaned` : "None");
      loadStats();
      loadLifetime();
    });

    $("#site-toggle").addEventListener("change", async (e) => {
      settings = await Settings.setSiteDisabled(pageHost, !e.target.checked);
      renderSite();
    });

    $("#reload-tab").addEventListener("click", () => {
      if (tab) chrome.tabs.reload(tab.id);
      window.close();
    });
  }

  // -------------------------------------------------------------------------
  // Unbox a link
  // -------------------------------------------------------------------------

  function normalizeInput(value) {
    let text = value.trim();
    if (!text) return null;
    // Only real schemes count, so "localhost:3000" or "example.com:8080" still get https:// added.
    if (!/^(https?:\/\/|mailto:|tel:|sms:)/i.test(text)) text = "https://" + text;
    try {
      const u = new URL(text);
      if ((u.protocol === "http:" || u.protocol === "https:") && !u.hostname.includes(".") && u.hostname !== "localhost") return null;
      return u.href;
    } catch {
      return null;
    }
  }

  function renderUnbox() {
    const result = $("#unbox-result");
    if (!unboxModel) {
      result.innerHTML = "";
      return;
    }
    result.innerHTML = Card.render(unboxModel, {
      context: "popup",
      expanded: unboxExpanded,
      previews: settings.previewImages,
    });
    mountLive();
  }

  let liveFrame = null;
  function mountLive() {
    liveFrame = null;
    const slot = $("#unbox-result [data-ubx-live]");
    if (!slot || !unboxModel || unboxModel.loading) return;
    const frame = document.createElement("iframe");
    frame.title = "Live preview";
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    frame.src = `preview.html#${encodeURIComponent(Card.liveUrl(unboxModel))}`;
    slot.appendChild(frame);
    liveFrame = frame;
  }

  window.addEventListener("message", (e) => {
    if (!liveFrame || e.source !== liveFrame.contentWindow) return;
    if (e.data && e.data.source === "unboxx-preview" && e.data.state === "loaded") liveFrame.classList.add("is-loaded");
  });

  async function paintUnbox(model) {
    const result = $("#unbox-result");
    if (model.faviconUrl) {
      send({ action: "getImage", url: model.faviconUrl, kind: "favicon" }).then((image) => {
        if (unboxModel !== model || !image || image.pending) return;
        result.querySelectorAll('[data-ubx-paint^="favicon"]').forEach((c) => Card.paint(c, image, "contain"));
      });
    }
    if (settings.previewImages === "off" || (model.safety && model.safety.status === "unsafe")) return;
    let image = null;
    let align = "center";
    if (settings.previewImages === "screenshot") {
      image = await send({ action: "getImage", url: Card.screenshotUrl(model.cleanUrl || model.finalUrl), kind: "screenshot" });
      if (image && image.pending) image = null;
      else if (image) align = "top";
    }
    if (!image && model.imageUrl) image = await send({ action: "getImage", url: model.imageUrl, kind: "preview" });
    if (unboxModel !== model) return;
    const canvas = result.querySelector('[data-ubx-paint="preview"]');
    if (image && !image.pending) Card.paint(canvas, image, "cover", align);
    else if (canvas) canvas.remove();
  }

  async function unbox(href) {
    const help = $("#unbox-help");
    const input = $("#unbox-input");
    const local = Rules.analyze(href, cleaningOptions());
    if (!local.ok) return;

    input.removeAttribute("aria-invalid");
    help.dataset.tone = "";
    help.textContent = "";
    unboxExpanded = false;

    if (local.kind !== "web") {
      unboxModel = { ...local, displayHost: local.address };
      renderUnbox();
      return;
    }

    const instant = Card.localModel(local);
    unboxModel = instant;
    renderUnbox();

    const res = await send({ action: "resolve", url: href, opts: cleaningOptions() });
    if (unboxModel !== instant) return;
    unboxModel = res && res.kind ? { ...res, loading: false } : { ...instant, loading: false, error: "unreachable" };
    renderUnbox();
    paintUnbox(unboxModel);
    if (settings.keepHistory && unboxModel.kind === "web" && !unboxModel.error) {
      await send({
        action: "recordHistory",
        entry: {
          url: unboxModel.href,
          cleanUrl: unboxModel.cleanUrl,
          title: unboxModel.title || unboxModel.displayHost,
          host: unboxModel.displayHost,
          faviconUrl: unboxModel.faviconUrl || "",
          trackers: (unboxModel.removed || []).length,
          from: "popup",
        },
      });
      loadRecent();
      loadLifetime();
    }
  }

  function setupUnbox() {
    const form = $("#unbox-form");
    const input = $("#unbox-input");
    const help = $("#unbox-help");

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const href = normalizeInput(input.value);
      if (!href) {
        input.setAttribute("aria-invalid", "true");
        help.dataset.tone = "danger";
        help.textContent = input.value.trim() ? "Not a link" : "Empty";
        input.focus();
        return;
      }
      unbox(href);
    });

    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid")) {
        input.removeAttribute("aria-invalid");
        help.dataset.tone = "";
        help.textContent = "";
      }
    });

    input.addEventListener("paste", () => {
      setTimeout(() => {
        const href = normalizeInput(input.value);
        if (href) unbox(href);
      }, 0);
    });

    $("#unbox-result").addEventListener("click", async (e) => {
      const el = e.target.closest("[data-act]");
      if (!el || !unboxModel) return;
      e.preventDefault();
      const m = unboxModel;
      const open = (url) => chrome.tabs.create({ url, index: tab ? tab.index + 1 : undefined });
      switch (el.dataset.act) {
        case "copy":
          if (!(await copyText(m.href))) {
            Card.flash(el, "Couldn't copy", "warning");
            break;
          }
          Card.flash(el, "Copied");
          break;
        case "copy-clean":
          if (!(await copyText(m.cleanUrl || m.href))) {
            Card.flash(el, "Couldn't copy", "warning");
            break;
          }
          Card.flash(el, "Copied");
          send({ action: "bumpStat", name: "trackersRemoved", by: (m.removed || []).length });
          break;
        case "copy-md":
          if (!(await copyText(Card.markdown(m)))) {
            Card.flash(el, "Couldn't copy", "warning");
            break;
          }
          Card.flash(el, "Copied");
          break;
        case "copy-address":
          if (!(await copyText(m.address))) {
            Card.flash(el, "Couldn't copy", "warning");
            break;
          }
          Card.flash(el, "Copied");
          break;
        case "open":
          open(settings.cleanOnClick ? m.cleanUrl || m.href : m.href);
          break;
        case "open-native":
          open(m.href);
          break;
        case "details": {
          unboxExpanded = !unboxExpanded;
          const details = $("#unbox-result .ubx-details");
          if (details) details.hidden = !unboxExpanded;
          el.setAttribute("aria-expanded", String(unboxExpanded));
          break;
        }
        case "wayback":
          open(`https://web.archive.org/web/2/${m.cleanUrl || m.href}`);
          break;
        case "virustotal":
          open(`https://www.virustotal.com/gui/search/${encodeURIComponent(m.finalUrl || m.href)}`);
          break;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Recent and lifetime stats
  // -------------------------------------------------------------------------

  async function loadRecent() {
    const list = $("#recent-list");
    const clear = $("#clear-history");
    const { history = [] } = await chrome.storage.local.get(["history"]);

    if (!settings.keepHistory) {
      clear.hidden = !history.length;
      list.innerHTML = `<li class="pp-empty" title="Turn on Keep recent history in settings.">History off</li>`;
      return;
    }

    clear.hidden = history.length === 0;
    if (!history.length) {
      list.innerHTML = `<li class="pp-empty" title="Links you preview are listed here. Stored on this device only.">No links yet</li>`;
      return;
    }

    list.innerHTML = history
      .slice(0, RECENT_LIMIT)
      .map((item, index) => {
        const host = Card.esc(item.host || Rules.displayParts(item.cleanUrl || item.url).host);
        const trackers = item.trackers ? ` · <b>${item.trackers} removed</b>` : "";
        return `
          <li class="pp-recent-item">
            <button class="pp-recent-open" type="button" data-index="${index}" title="${Card.esc(item.cleanUrl || item.url)}">
              <span class="ubx-favslot">
                <canvas class="ubx-fav" data-fav="${index}" width="32" height="32" aria-hidden="true"></canvas>
                <span class="ubx-monogram" aria-hidden="true">${Card.esc(Rules.registrableDomain(item.host || "").charAt(0) || "?")}</span>
              </span>
              <span class="pp-recent-text">
                <span class="pp-recent-title">${Card.esc(item.title || host)}</span>
                <span class="pp-recent-meta">${host}, ${Card.esc(Card.timeAgo(item.ts))}${trackers}</span>
              </span>
            </button>
            <button class="ubx-iconbtn" type="button" data-copy="${index}" aria-label="Copy clean link" title="Copy clean link">${icon("copy", 15)}</button>
          </li>`;
      })
      .join("");

    history.slice(0, RECENT_LIMIT).forEach((item, index) => {
      if (item.faviconUrl) paintFavicon(list.querySelector(`[data-fav="${index}"]`), item.faviconUrl);
    });

    list.onclick = async (e) => {
      const copyButton = e.target.closest("[data-copy]");
      if (copyButton) {
        const item = history[Number(copyButton.dataset.copy)];
        if (!(await copyText(item.cleanUrl || item.url))) {
          Card.flash(copyButton, "Couldn't copy", "warning");
          return;
        }
        Card.flash(copyButton, "Copied");
        return;
      }
      const openButton = e.target.closest("[data-index]");
      if (openButton) {
        const item = history[Number(openButton.dataset.index)];
        chrome.tabs.create({ url: settings.cleanOnClick ? item.cleanUrl || item.url : item.url, index: tab ? tab.index + 1 : undefined });
      }
    };
  }

  async function loadLifetime() {
    const { stats = {} } = await chrome.storage.local.get(["stats"]);
    const removed = stats.trackersRemoved || 0;
    $("#lifetime").textContent = `${removed.toLocaleString()} tracker${removed === 1 ? "" : "s"} removed`;
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  async function init() {
    hydrateIcons();
    settings = await Settings.load();
    document.documentElement.dataset.theme = settings.theme;

    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      const u = new URL(tab && tab.url ? tab.url : "");
      pageHost = u.protocol === "http:" || u.protocol === "https:" ? u.hostname : "";
    } catch {
      pageHost = "";
    }

    renderPause();
    renderSite();
    setupPageTools();
    setupUnbox();
    loadStats();
    loadRecent();
    loadLifetime();
    if (pageHost) paintFavicon($("#site-fav"), `${new URL(tab.url).origin}/favicon.ico`);

    // Ready for Cmd/Ctrl+V the moment the popup opens; pasting unboxes right away.
    $("#unbox-input").focus({ preventScroll: true });

    $("#pause").addEventListener("click", () => togglePause(!settings.paused));
    $("#resume").addEventListener("click", () => togglePause(false));
    $("#open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
    $("#shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
    $("#clear-history").addEventListener("click", async () => {
      await chrome.storage.local.set({ history: [] });
      loadRecent();
    });
  }

  init();
})();
