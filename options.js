// unboxx settings page
(() => {
  const Rules = globalThis.UnboxxRules;
  const Settings = globalThis.UnboxxSettings;
  const Card = globalThis.UnboxxCard;
  const { icon } = globalThis.UnboxxIcons;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  let settings = { ...Settings.DEFAULTS };
  let savedTimer = 0;

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

  function showSaved(text = "Saved") {
    const el = $("#saved");
    el.innerHTML = `${icon("check", 14)}${Card.esc(text)}`;
    el.classList.add("is-visible");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => el.classList.remove("is-visible"), 1600);
  }

  // -------------------------------------------------------------------------
  // Generic setting controls
  // -------------------------------------------------------------------------

  function syncControls() {
    document.documentElement.dataset.theme = settings.theme;

    $$("input[type=checkbox][data-setting]").forEach((input) => {
      input.checked = Boolean(settings[input.dataset.setting]);
    });

    $$("[role=radiogroup][data-setting]").forEach((group) => {
      const value = settings[group.dataset.setting];
      group.querySelectorAll("input[type=radio]").forEach((radio) => {
        radio.checked = radio.value === value;
      });
    });

    const range = $("#hoverDelay");
    range.value = settings.hoverDelay;
    setRangeFill(range);
    $("#hoverDelay-value").textContent = `${settings.hoverDelay} ms`;
    $("#delay-row").dataset.disabled = String(settings.trigger === "modifier");

    renderSites();
    renderSamples();
    const paused = settings.disabledSites.length;
    $("#nav-sites").textContent = paused ? `${paused} paused` : "";
  }

  // Drives the filled part of the slider track (CSS can't style the left side of a range natively in all engines).
  function setRangeFill(range) {
    const min = Number(range.min) || 0;
    const max = Number(range.max) || 100;
    const pct = ((Number(range.value) - min) / (max - min)) * 100;
    range.style.setProperty("--fill", `${pct}%`);
  }

  function setSafetyMeta(on) {
    const meta = $("#nav-safety");
    meta.textContent = on ? "On" : "";
    meta.dataset.tone = on ? "accent" : "";
  }

  function flashRow(el) {
    const row = el && el.closest ? el.closest(".op-row") : null;
    if (!row) return;
    row.classList.remove("is-saved");
    void row.offsetWidth;
    row.classList.add("is-saved");
  }

  // Apply locally first so quick successive changes never flicker back while saves are queued.
  let pendingSaves = 0;
  async function update(patch, source) {
    settings = { ...settings, ...patch };
    syncControls();
    flashRow(source);
    pendingSaves++;
    try {
      await Settings.save(patch);
      showSaved();
    } finally {
      pendingSaves--;
    }
  }

  function bindControls() {
    $$("input[type=checkbox][data-setting]").forEach((input) => {
      input.addEventListener("change", () => update({ [input.dataset.setting]: input.checked }, input));
    });

    $$("[role=radiogroup][data-setting]").forEach((group) => {
      group.addEventListener("change", (e) => {
        if (e.target.type === "radio") update({ [group.dataset.setting]: e.target.value }, group);
      });
    });

    const range = $("#hoverDelay");
    range.addEventListener("input", () => {
      setRangeFill(range);
      $("#hoverDelay-value").textContent = `${range.value} ms`;
    });
    range.addEventListener("change", () => update({ hoverDelay: Number(range.value) }, range));
  }

  // -------------------------------------------------------------------------
  // Sample cards
  // -------------------------------------------------------------------------

  const SAMPLE_TRACKED = {
    kind: "web",
    href: "https://bit.ly/4kQm2Ze",
    target: "https://bit.ly/4kQm2Ze",
    finalUrl: "https://store.example.com/headphones/studio-2?utm_source=newsletter&utm_medium=email&fbclid=IwAR0x9",
    cleanUrl: "https://store.example.com/headphones/studio-2",
    displayHost: "store.example.com",
    displayPath: "/headphones/studio-2",
    title: "Studio 2 wireless headphones",
    siteName: "Example Store",
    description: "Wireless over-ear headphones with a fold-flat design.",
    removed: [
      { name: "utm_source", value: "newsletter" },
      { name: "utm_medium", value: "email" },
      { name: "fbclid", value: "IwAR0x9" },
    ],
    unwrapped: [],
    chain: ["https://bit.ly/4kQm2Ze", "https://store.example.com/headphones/studio-2?utm_source=newsletter&utm_medium=email&fbclid=IwAR0x9"],
    flags: { shortener: true },
    safety: { status: "unknown", threats: [] },
  };

  function renderSamples() {
    const opts = { context: "popup", previews: "off" };
    $("#welcome-demo").innerHTML = Card.render(SAMPLE_TRACKED, opts);
  }

  // -------------------------------------------------------------------------
  // Cleaning tester
  // -------------------------------------------------------------------------

  function bindTester() {
    const input = $("#tester-input");
    const output = $("#tester-output");
    const run = () => {
      const value = input.value.trim();
      if (!value) {
        output.textContent = "";
        return;
      }
      let href = value;
      if (!/^https?:\/\//i.test(href)) href = "https://" + href;
      const result = Rules.analyze(href, { strict: settings.strictCleaning, unwrap: settings.unwrapRedirects });
      if (!result.ok || result.kind !== "web") {
        output.textContent = "Not a web link";
        return;
      }
      const lines = [];
      if (result.unwrapped.length) lines.push(`<div class="op-tester-line">${icon("path", 15)}${result.unwrapped.length} wrapper${result.unwrapped.length === 1 ? "" : "s"} decoded</div>`);
      if (result.removed.length) {
        lines.push(`<div class="op-tester-line">${icon("broom", 15)}${result.removed.length} tracker${result.removed.length === 1 ? "" : "s"} removed</div>`);
        lines.push(`<div class="ubx-params">${result.removed.map((p) => `<span class="ubx-param">${Card.esc(p.name === "path" ? p.value : `${p.name}=${p.value}`)}</span>`).join("")}</div>`);
      }
      if (!lines.length) lines.push(`<div class="op-tester-line">${icon("check", 15)}Already clean</div>`);
      lines.push(`<div class="ubx-url">${Card.esc(result.clean)}</div>`);
      output.innerHTML = lines.join("");
    };
    input.addEventListener("input", run);
  }

  // -------------------------------------------------------------------------
  // Safe Browsing key
  // -------------------------------------------------------------------------

  async function bindSafeBrowsing() {
    const input = $("#sb-key");
    const status = $("#sb-status");
    const reveal = $("#sb-reveal");
    const save = $("#sb-save");
    const remove = $("#sb-remove");
    const defaultHelp = status.textContent;

    const { safeBrowsingApiKey = "" } = await chrome.storage.sync.get(["safeBrowsingApiKey"]);
    input.value = safeBrowsingApiKey;
    remove.hidden = !safeBrowsingApiKey;
    setSafetyMeta(Boolean(safeBrowsingApiKey));
    if (safeBrowsingApiKey) {
      status.dataset.tone = "accent";
      status.textContent = "Active";
    }

    reveal.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      reveal.textContent = showing ? "Show" : "Hide";
      reveal.setAttribute("aria-pressed", String(!showing));
    });

    input.addEventListener("input", () => input.removeAttribute("aria-invalid"));

    save.addEventListener("click", async () => {
      const key = input.value.trim();
      if (!key) {
        input.setAttribute("aria-invalid", "true");
        status.dataset.tone = "danger";
        status.textContent = "Empty";
        input.focus();
        return;
      }
      save.disabled = true;
      save.textContent = "Checking";
      const result = await send({ action: "testSafeBrowsingKey", key });
      save.disabled = false;
      save.textContent = "Save";
      if (result && result.ok) {
        await chrome.storage.sync.set({ safeBrowsingApiKey: key });
        input.removeAttribute("aria-invalid");
        status.dataset.tone = "accent";
        status.textContent = "Active";
        status.removeAttribute("title");
        remove.hidden = false;
        setSafetyMeta(true);
        send({ action: "clearCache" });
        showSaved();
      } else {
        input.setAttribute("aria-invalid", "true");
        status.dataset.tone = "danger";
        status.textContent = "Key rejected";
        status.title = result && result.message ? result.message : "Google did not accept this key.";
      }
    });

    remove.addEventListener("click", async () => {
      await chrome.storage.sync.remove(["safeBrowsingApiKey"]);
      input.value = "";
      remove.hidden = true;
      setSafetyMeta(false);
      status.dataset.tone = "";
      status.textContent = defaultHelp;
      status.removeAttribute("title");
      send({ action: "clearCache" });
      showSaved("Key removed");
    });
  }

  // -------------------------------------------------------------------------
  // Paused sites
  // -------------------------------------------------------------------------

  function renderSites() {
    const list = $("#site-list");
    if (!settings.disabledSites.length) {
      list.innerHTML = `<li class="op-sites-empty">None</li>`;
      return;
    }
    list.innerHTML = settings.disabledSites
      .map(
        (site) => `
        <li class="op-site">
          <span class="ubx-monogram" aria-hidden="true">${Card.esc(site.charAt(0))}</span>
          <span title="${Card.esc(site)}">${Card.esc(site)}</span>
          <button class="ubx-iconbtn" type="button" data-remove="${Card.esc(site)}" aria-label="Resume previews on ${Card.esc(site)}" title="Remove">${icon("x", 15)}</button>
        </li>`
      )
      .join("");
  }

  function bindSites() {
    const form = $("#site-form");
    const input = $("#site-input");
    const error = $("#site-error");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const host = Settings.normalizeHost(input.value);
      if (!host || !(host.includes(".") || host === "localhost") || /[^a-z0-9.\-]/.test(host)) {
        input.setAttribute("aria-invalid", "true");
        error.dataset.tone = "danger";
        error.textContent = "Not a domain";
        return;
      }
      input.removeAttribute("aria-invalid");
      error.textContent = "";
      input.value = "";
      settings = await Settings.setSiteDisabled(host, true);
      renderSites();
      showSaved(`Paused on ${host}`);
    });

    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      error.textContent = "";
    });

    $("#site-list").addEventListener("click", async (e) => {
      const button = e.target.closest("[data-remove]");
      if (!button) return;
      settings = await Settings.setSiteDisabled(button.dataset.remove, false);
      renderSites();
      showSaved(`Resumed on ${button.dataset.remove}`);
    });
  }

  // -------------------------------------------------------------------------
  // History and data
  // -------------------------------------------------------------------------

  async function loadFigures() {
    const { stats = {}, history = [] } = await chrome.storage.local.get(["stats", "history"]);
    $("#fig-removed").textContent = (stats.trackersRemoved || 0).toLocaleString();
    $("#fig-previewed").textContent = (stats.previewed || 0).toLocaleString();
    $("#fig-history").textContent = history.length.toLocaleString();
  }

  function bindData() {
    $("#clear-history").addEventListener("click", async (e) => {
      await chrome.storage.local.set({ history: [] });
      Card.flash(e.currentTarget, "Cleared");
      loadFigures();
    });

    $("#clear-cache").addEventListener("click", async (e) => {
      const button = e.currentTarget;
      await send({ action: "clearCache" });
      Card.flash(button, "Cleared");
    });

    let armed = 0;
    $("#reset").addEventListener("click", async (e) => {
      const button = e.currentTarget;
      if (Date.now() > armed) {
        armed = Date.now() + 3500;
        button.textContent = "Confirm reset";
        setTimeout(() => {
          if (Date.now() > armed) button.textContent = "Reset settings";
        }, 3600);
        return;
      }
      armed = 0;
      const sites = settings.disabledSites;
      await Settings.reset();
      settings = await Settings.save({ disabledSites: sites });
      button.textContent = "Reset settings";
      syncControls();
      showSaved("Settings reset");
    });
  }

  // -------------------------------------------------------------------------
  // Keyboard section
  // -------------------------------------------------------------------------

  async function renderCommands() {
    if (!chrome.commands || !chrome.commands.getAll) return;
    const commands = await chrome.commands.getAll();
    const labels = { "copy-clean-url": "Copy clean page address", "toggle-site": "Pause on this site" };
    const rows = commands
      .filter((c) => labels[c.name])
      .map((c) => {
        const keys = c.shortcut
          ? (c.shortcut.includes("+") ? c.shortcut.split("+") : c.shortcut.match(/[⌘⌥⇧⌃]|[^⌘⌥⇧⌃]+/g) || [])
              .filter(Boolean)
              .map((k) => `<kbd class="ubx-kbd">${Card.esc(k)}</kbd>`)
              .join(" ")
          : `<span class="op-help">Not set</span>`;
        return `<div><dt>${keys}</dt><dd>${Card.esc(labels[c.name])}</dd></div>`;
      });
    if (rows.length) $("#global-shortcuts").innerHTML = rows.join("");
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  function bindSearch() {
    const input = $("#search");
    const sections = $$(".op-section");
    const noResults = $("#noresults");
    const words = (text) => text.toLowerCase().replace(/\s+/g, " ");

    const run = () => {
      const query = words(input.value.trim());
      let anyVisible = false;
      for (const section of sections) {
        const navLink = $(`.op-nav a[href="#${section.id}"]`);
        if (!query) {
          section.removeAttribute("data-search-hidden");
          section.querySelectorAll("[data-search-hidden]").forEach((el) => el.removeAttribute("data-search-hidden"));
          if (navLink) navLink.removeAttribute("data-filtered");
          continue;
        }
        const titleMatch = words(section.querySelector("h2").textContent).includes(query);
        const rows = section.querySelectorAll(".op-row");
        let sectionMatch = titleMatch;
        if (rows.length) {
          rows.forEach((row) => {
            const match = titleMatch || words(row.textContent).includes(query);
            row.toggleAttribute("data-search-hidden", !match);
            if (match) sectionMatch = true;
          });
          // Hide subgroups whose rows are all filtered out, with their subheading.
          section.querySelectorAll(".op-group").forEach((group) => {
            const visible = group.querySelector(".op-row:not([data-search-hidden])");
            const empty = group.querySelector(".op-row") && !visible;
            group.toggleAttribute("data-search-hidden", Boolean(empty));
            const head = group.previousElementSibling;
            if (head && head.classList.contains("op-subhead")) head.toggleAttribute("data-search-hidden", Boolean(empty));
          });
        } else {
          sectionMatch = sectionMatch || words(section.textContent).includes(query);
        }
        section.toggleAttribute("data-search-hidden", !sectionMatch);
        if (navLink) navLink.toggleAttribute("data-filtered", !sectionMatch);
        if (sectionMatch) anyVisible = true;
      }
      const welcome = $("#welcome");
      if (welcome && !welcome.hidden) welcome.toggleAttribute("data-search-hidden", Boolean(query));
      noResults.hidden = !query || anyVisible;
      $("#noresults-query").textContent = input.value.trim();
    };

    input.addEventListener("input", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        input.value = "";
        run();
        input.blur();
      }
    });
    $("#clear-search").addEventListener("click", () => {
      input.value = "";
      run();
      input.focus();
    });
    document.addEventListener("keydown", (e) => {
      const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        input.focus();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Navigation highlight
  // -------------------------------------------------------------------------

  function bindNav() {
    const links = $$(".op-nav a");
    const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!visible) return;
        links.forEach((a) => a.classList.remove("is-current"));
        const link = byId.get(visible.target.id);
        if (link) {
          link.classList.add("is-current");
          link.setAttribute("aria-current", "true");
        }
        links.filter((a) => a !== link).forEach((a) => a.removeAttribute("aria-current"));
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    $$(".op-section").forEach((section) => observer.observe(section));
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  async function init() {
    hydrateIcons();
    if (IS_MAC) $$(".op-alt-label").forEach((el) => (el.textContent = "Hold Option"));

    settings = await Settings.load();
    syncControls();
    bindControls();
    bindTester();
    bindSafeBrowsing();
    bindSites();
    bindData();
    bindNav();
    bindSearch();
    loadFigures();
    renderCommands();

    const params = new URLSearchParams(location.search);
    if (params.get("welcome")) $("#welcome").hidden = false;
    $("#welcome-done").addEventListener("click", () => {
      $("#welcome").hidden = true;
      history.replaceState(null, "", location.pathname);
    });

    $("#edit-shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

    Settings.onChange((next) => {
      // Our own queued saves report intermediate states; only sync from outside changes.
      if (pendingSaves) return;
      settings = next;
      syncControls();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.stats || changes.history)) loadFigures();
    });
  }

  init();
})();
