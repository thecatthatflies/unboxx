// unboxx settings, shared by every extension context.
// Stored as one object under chrome.storage.sync "settings" so it follows the user across devices.
(() => {
  const DEFAULTS = {
    paused: false,
    theme: "auto", // auto | light | dark
    trigger: "hover", // hover | modifier
    hoverDelay: 350,
    previewImages: "live", // live | page | screenshot | off
    showOnFocus: true,
    skipSameSite: false,
    keyboardShortcuts: true,
    cleanOnClick: true,
    unwrapRedirects: true,
    strictCleaning: false,
    keepHistory: true,
    showBadge: true,
    prefetchSmallPages: false,
    disabledSites: [],
  };

  function normalizeHost(value) {
    if (!value) return "";
    let host = String(value).trim().toLowerCase();
    try {
      if (host.includes("://")) host = new URL(host).hostname;
    } catch {
      return "";
    }
    return host.replace(/^www\./, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  }

  function merge(stored) {
    const next = { ...DEFAULTS, ...(stored || {}) };
    if (!Array.isArray(next.disabledSites)) next.disabledSites = [];
    return next;
  }

  async function load() {
    const result = await chrome.storage.sync.get(["settings"]);
    return merge(result.settings);
  }

  // Writes run one at a time so two quick changes can't read the same old state and drop each other.
  let queue = Promise.resolve();
  function serial(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  function save(patch) {
    return serial(async () => {
      const current = await load();
      const next = { ...current, ...patch };
      await chrome.storage.sync.set({ settings: next });
      return next;
    });
  }

  function reset() {
    return serial(async () => {
      await chrome.storage.sync.set({ settings: { ...DEFAULTS } });
      return { ...DEFAULTS };
    });
  }

  function onChange(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.settings) callback(merge(changes.settings.newValue));
    });
  }

  function isSiteDisabled(settings, host) {
    const h = normalizeHost(host);
    if (!h) return false;
    return settings.disabledSites.some((site) => h === site || h.endsWith("." + site));
  }

  function setSiteDisabled(host, disabled) {
    const h = normalizeHost(host);
    return serial(async () => {
      const current = await load();
      const list = current.disabledSites.filter((site) => site !== h);
      if (disabled && h) list.push(h);
      list.sort();
      const next = { ...current, disabledSites: list };
      await chrome.storage.sync.set({ settings: next });
      return next;
    });
  }

  globalThis.UnboxxSettings = { DEFAULTS, load, save, reset, onChange, isSiteDisabled, setSiteDisabled, normalizeHost };
})();
